import type { Ingredient } from "@/types/database"

export interface ParsedRecipe {
  name: string
  ingredients: Ingredient[]
  instructions: string[]
  servings?: number
}

/**
 * Parse a recipe from plain text
 * Handles various formats:
 * - Recipe name at the top
 * - Ingredients section (with or without header)
 * - Instructions/Directions section
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0)
  
  if (lines.length === 0) {
    return {
      name: "",
      ingredients: [],
      instructions: [],
    }
  }

  // Find sections
  let name = ""
  let ingredients: Ingredient[] = []
  let instructions: string[] = []
  let servings: number | undefined

  // Find recipe name (usually first line, or before "Ingredients" header)
  const ingredientsIndex = findSectionIndex(lines, ["ingredients", "ingredient"])
  const instructionsIndex = findSectionIndex(lines, [
    "instructions",
    "instruction",
    "directions",
    "direction",
    "method",
    "steps",
    "step",
  ])

  // Extract name (everything before ingredients section, or first line if no sections)
  if (ingredientsIndex > 0) {
    name = lines.slice(0, ingredientsIndex).join(" ").trim()
    // Clean up common prefixes
    name = name.replace(/^(recipe|title|name):\s*/i, "").trim()
  } else if (lines.length > 0) {
    name = lines[0]
  }

  // Extract servings if mentioned in name or first few lines
  const servingsMatch = name.match(/(\d+)\s*(servings?|people|portions?)/i)
  if (servingsMatch) {
    servings = parseInt(servingsMatch[1], 10)
    name = name.replace(/\s*\(?\d+\s*(servings?|people|portions?)\)?/i, "").trim()
  }

  // Extract ingredients
  const ingredientsStart = ingredientsIndex >= 0 ? ingredientsIndex + 1 : 0
  let ingredientsEnd = instructionsIndex >= 0 ? instructionsIndex : lines.length

  // Stop at other sections that aren't ingredients (like "Optional Add-ins", "Serve With", etc.)
  const otherSections = ["optional", "serve", "garnish", "topping", "note", "tips"]
  for (let i = ingredientsStart; i < ingredientsEnd; i++) {
    const lineLower = lines[i].toLowerCase()
    if (otherSections.some((section) => lineLower.includes(section) && lineLower.length < 30)) {
      ingredientsEnd = i
      break
    }
  }

  if (ingredientsStart < ingredientsEnd) {
    const ingredientLines = lines.slice(ingredientsStart, ingredientsEnd)
    ingredients = ingredientLines
      .map((line) => parseIngredientLine(line))
      .filter((ing) => ing.item.length > 0)
  }

  // Extract instructions
  if (instructionsIndex >= 0) {
    instructions = lines.slice(instructionsIndex + 1)
  } else if (ingredientsIndex >= 0) {
    // If we found ingredients but no instructions header, everything after ingredients is instructions
    instructions = lines.slice(ingredientsEnd)
  } else {
    // If no sections found, try to guess: lines with numbers or bullets are likely instructions
    const potentialInstructions = lines.slice(1).filter(
      (line) => /^[\d\-\*•\.]\s+/.test(line) || line.length > 50
    )
    if (potentialInstructions.length > 0) {
      instructions = potentialInstructions
    }
  }

  // Clean up instructions: remove numbering/bullets, trim
  instructions = instructions
    .map((line) => line.replace(/^[\d\-\*•\.\)]\s+/, "").trim())
    .filter((line) => line.length > 0)

  return {
    name: name || "Untitled Recipe",
    ingredients,
    instructions,
    servings,
  }
}

/**
 * Find the index of a section header (case-insensitive)
 */
function findSectionIndex(lines: string[], keywords: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase()
    if (keywords.some((keyword) => lineLower.includes(keyword))) {
      return i
    }
  }
  return -1
}

/**
 * Unicode fraction to decimal mapping
 */
const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1/3,
  "⅔": 2/3,
  "¼": 0.25,
  "¾": 0.75,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1/6,
  "⅚": 5/6,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
}

/**
 * Common unit abbreviations
 */
const UNIT_ABBREVIATIONS = [
  "tsp", "tbsp", "tablespoon", "teaspoon", "tablespoons", "teaspoons",
  "cup", "cups", "c",
  "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
  "g", "gram", "grams", "kg", "kilogram", "kilograms",
  "ml", "milliliter", "milliliters", "l", "liter", "liters",
  "fl oz", "fluid ounce", "fluid ounces",
  "pt", "pint", "pints", "qt", "quart", "quarts", "gal", "gallon", "gallons",
  "can", "cans", "package", "packages", "pkg", "pkgs",
  "clove", "cloves", "head", "heads",
  "piece", "pieces", "pc", "pcs",
  "slice", "slices", "strip", "strips",
]

/**
 * Parse a single ingredient line into Ingredient object
 * Handles formats like:
 * - "2 cups flour"
 * - "1/2 tsp salt"
 * - "½ tsp oregano"
 * - "3-4 cloves garlic"
 * - "1 yellow onion, diced"
 * - "1 bell pepper, diced (optional)"
 * - "1 (28 oz) can crushed tomatoes"
 * - "Salt & black pepper to taste"
 * - "½–1 cup chicken broth"
 */
function parseIngredientLine(line: string): Ingredient {
  let cleaned = line.trim()

  // Remove list markers (bullets, dashes, dots) at the start, but preserve numbers
  // This handles cases like "• 1 cup" or "- 2 tbsp" but keeps "1 cup" intact
  cleaned = cleaned.replace(/^[\-\*•\.]\s+/, "")
  cleaned = cleaned.trim()

  // Skip empty lines or section headers
  if (!cleaned || cleaned.toLowerCase().includes("ingredients")) {
    return { item: "", amount: null, unit: "" }
  }

  // Normalize Unicode fractions and en-dashes
  cleaned = normalizeUnicode(cleaned)

  // Try to match amount at the start
  // Pattern: optional number/fraction/range, optional unit, rest is item
  // Examples:
  // - "1 lb ground turkey" -> amount: 1, unit: "lb", item: "ground turkey"
  // - "½ tsp oregano" -> amount: 0.5, unit: "tsp", item: "oregano"
  // - "1 yellow onion, diced" -> amount: 1, unit: "", item: "yellow onion, diced"
  // - "1 (28 oz) can crushed tomatoes" -> amount: 1, unit: "can (28 oz)", item: "crushed tomatoes"
  // - "½–1 cup chicken broth" -> amount: 0.5, unit: "cup", item: "chicken broth"
  
  // Match amount (number, fraction, or decimal) optionally followed by range
  // The pattern requires whitespace or end of string after the amount
  const amountPattern = /^(\d+\/\d+|\d+\.\d+|\d+)(\s*[–-]\s*(\d+\/\d+|\d+\.\d+|\d+))?(\s+|$)/
  const amountMatch = cleaned.match(amountPattern)
  
  // Debug: log if no match for troubleshooting
  // if (!amountMatch && /^\d/.test(cleaned)) {
  //   console.log("No amount match for:", cleaned)
  // }
  
  if (amountMatch) {
    let amount: number | null = null
    let unit = ""
    let item = ""
    
    // Get the full matched amount portion (including trailing space if any)
    const amountEndIndex = amountMatch[0].length
    let remaining = cleaned.substring(amountEndIndex).trim()

    // Extract amount (use first number for ranges)
    amount = parseAmount(amountMatch[1])
    
    // Store original range text if present (for display in unit)
    const hasRange = !!amountMatch[3]
    const originalRangeText = hasRange 
      ? cleaned.substring(0, amountEndIndex).trim()
      : null
    
    // Try to extract unit from remaining text
    const unitMatch = extractUnit(remaining)
    if (unitMatch) {
      unit = unitMatch.unit
      remaining = remaining.substring(unitMatch.endIndex).trim()
      
      // If we have a range, prepend it to the unit
      if (hasRange && originalRangeText) {
        unit = `${originalRangeText} ${unit}`.trim()
      }
    } else if (hasRange && originalRangeText) {
      // Range but no unit found - put range in unit field
      unit = originalRangeText
    }
    
    // Everything remaining is the item name (preserves commas, parentheses, etc.)
    item = remaining

    return {
      item: item || cleaned,
      amount: amount,
      unit: unit,
    }
  }

  // No amount found, treat entire line as ingredient name
  return {
    item: cleaned,
    amount: null,
    unit: "",
  }
}

/**
 * Normalize Unicode characters (fractions, en-dashes, etc.)
 * Converts Unicode fractions to decimal strings for easier parsing
 */
function normalizeUnicode(text: string): string {
  let normalized = text
  
  // Replace Unicode fractions with decimal strings
  // We convert to decimal to make regex matching easier
  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    // Use a more precise replacement that preserves spacing
    normalized = normalized.replace(new RegExp(char, "g"), value.toString())
  }
  
  // Replace en-dash and em-dash with regular dash for consistency
  normalized = normalized.replace(/[–—]/g, "-")
  
  return normalized
}

/**
 * Parse amount string (handles fractions and decimals)
 */
function parseAmount(amountStr: string): number {
  // Handle fractions like "1/2"
  if (amountStr.includes("/")) {
    return parseFraction(amountStr)
  }
  
  // Handle decimals
  const num = parseFloat(amountStr)
  return isNaN(num) ? 0 : num
}

/**
 * Extract unit from the beginning of a string
 * Returns the unit and the end index
 * Handles formats like:
 * - "lb ground turkey" -> unit: "lb"
 * - "(28 oz) can crushed tomatoes" -> unit: "can (28 oz)"
 * - "tsp oregano" -> unit: "tsp"
 */
function extractUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null

  // Check for parenthetical unit info first: "(28 oz)"
  const parenMatch = text.match(/^(\([^)]+\))\s*/)
  if (parenMatch) {
    const parenUnit = parenMatch[1]
    const afterParen = text.substring(parenMatch[0].length).trim()
    
    // Check if there's a unit word after the parentheses (e.g., "can")
    const unitMatch = matchUnit(afterParen)
    if (unitMatch) {
      // Combine: "can (28 oz)" format
      return {
        unit: `${unitMatch.unit} ${parenUnit}`.trim(),
        endIndex: parenMatch[0].length + unitMatch.endIndex,
      }
    }
    
    // Just the parentheses - treat as unit info
    return {
      unit: parenUnit,
      endIndex: parenMatch[0].length,
    }
  }

  // Try to match a unit word directly
  return matchUnit(text)
}

/**
 * Match a unit word at the start of text
 * Requires a space or end of string after the unit to ensure it's a complete word
 */
function matchUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null
  
  // Try exact matches first (longer units first to match "fluid ounce" before "ounce")
  const sortedUnits = [...UNIT_ABBREVIATIONS].sort((a, b) => b.length - a.length)
  
  for (const unit of sortedUnits) {
    // Escape special regex characters in the unit
    const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // Match whole word (case-insensitive) followed by space or end of string
    // Use word boundary to ensure we match complete words
    const regex = new RegExp(`^(${escapedUnit})(\\s+|$)`, "i")
    const match = text.match(regex)
    if (match) {
      return {
        unit: match[1], // Return the matched unit (preserves original case from text)
        endIndex: match[0].length, // Include the trailing space if present
      }
    }
  }
  
  return null
}

/**
 * Parse a fraction string to a decimal number
 * Examples: "1/2" -> 0.5, "3/4" -> 0.75
 */
function parseFraction(fraction: string): number {
  const parts = fraction.split("/")
  if (parts.length === 2) {
    const numerator = parseFloat(parts[0])
    const denominator = parseFloat(parts[1])
    if (denominator !== 0) {
      return numerator / denominator
    }
  }
  return parseFloat(fraction) || 0
}
