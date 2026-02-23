import type { Ingredient } from "@/types/database"

export interface ParsedRecipe {
  name: string
  ingredients: Ingredient[]
  instructions: string[]
  servings?: number
  warnings: string[]
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
  const warnings: string[] = []

  if (lines.length === 0) {
    return {
      name: "",
      ingredients: [],
      instructions: [],
      warnings: ["No text to parse — paste recipe text above"],
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

  // Stop at other sections that aren't ingredients (like "Optional Add-ins:", "Serve With:", etc.)
  // Only treat likely headers as section breaks to avoid dropping ingredient lines like
  // "Sesame seeds (optional)" or "Green onions, sliced (optional)".
  for (let i = ingredientsStart; i < ingredientsEnd; i++) {
    if (isLikelyNonIngredientSectionHeader(lines[i])) {
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

  // Generate warnings for potential parsing issues
  if (!name || name === "Untitled Recipe") {
    warnings.push("No recipe name found — using \"Untitled Recipe\"")
  }

  if (ingredients.length === 0) {
    warnings.push("No ingredients found — add an \"Ingredients\" section")
  } else {
    // Check for ingredients without amounts
    const noAmountIngredients = ingredients.filter(i => i.amount === null && i.item.length > 0)
    if (noAmountIngredients.length > 0) {
      if (noAmountIngredients.length === 1) {
        warnings.push(`"${noAmountIngredients[0].item}" has no amount`)
      } else if (noAmountIngredients.length <= 3) {
        warnings.push(`${noAmountIngredients.length} ingredients have no amounts: ${noAmountIngredients.map(i => i.item).join(", ")}`)
      } else {
        warnings.push(`${noAmountIngredients.length} ingredients have no amounts`)
      }
    }
  }

  if (instructions.length === 0) {
    warnings.push("No instructions found — add a \"Directions\" or \"Instructions\" section")
  }

  return {
    name: name || "Untitled Recipe",
    ingredients,
    instructions,
    servings,
    warnings,
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

function isLikelyNonIngredientSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  // Section headers typically end with ":" and are short labels.
  if (!trimmed.endsWith(":")) return false

  const normalized = trimmed
    .toLowerCase()
    .replace(/[:\-\u2013\u2014]+$/, "")
    .trim()

  // Guard against false positives for ingredient lines.
  if (!normalized) return false
  if (/\d/.test(normalized)) return false
  if (/[(),]/.test(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length > 6) return false

  return /^(optional(\s+add-?ins?)?|serve(\s+with)?|garnish(es)?|toppings?|notes?|tips?)$/.test(normalized)
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
  "pinch", "dash", "sprinkle",
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
export function parseIngredientLine(line: string): Ingredient {
  let cleaned = line.trim()

  // Remove list markers (bullets, dashes, dots) at the start, but preserve numbers
  // This handles cases like "• 1 cup" or "- 2 tbsp" but keeps "1 cup" intact
  cleaned = cleaned.replace(/^[\-\*•\.]\s+/, "")
  cleaned = cleaned.trim()

  // Preserve the cleaned text before parsing
  const originalText = cleaned

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

    // Extract modifier if present (e.g., "lentils, rinsed" -> item: "lentils", modifier: "rinsed")
    const { item: baseItem, modifier } = extractModifier(item)

    // Extract alternatives if present (e.g., "yogurt or sour cream" -> item: "yogurt", alternatives: ["sour cream"])
    const { item: finalItem, alternatives } = extractAlternatives(baseItem)

    return {
      item: finalItem || cleaned,
      amount: amount,
      unit: unit,
      modifier: modifier || undefined,
      alternatives: alternatives,
      originalText,
    }
  }

  // No amount found, treat entire line as ingredient name
  // Still check for modifiers
  const { item: baseItem, modifier } = extractModifier(cleaned)

  // Extract alternatives if present
  const { item: finalItem, alternatives } = extractAlternatives(baseItem)

  return {
    item: finalItem,
    amount: null,
    unit: "",
    modifier: modifier || undefined,
    alternatives: alternatives,
    originalText,
  }
}

/**
 * Normalize Unicode characters (fractions, en-dashes, etc.)
 * Converts Unicode fractions to decimal strings for easier parsing
 */
function normalizeUnicode(text: string): string {
  let normalized = text

  // PASS 1: Handle mixed fractions FIRST (e.g., "1¾" → "1.75")
  // Match whole number + fraction with NO space between
  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    const mixedPattern = new RegExp(`(\\d+)${char}`, 'g')
    normalized = normalized.replace(mixedPattern, (match, whole) => {
      const wholeNum = parseFloat(whole)
      return (wholeNum + value).toString()
    })
  }

  // PASS 2: Handle standalone fractions (existing logic)
  // Replace Unicode fractions with decimal strings
  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replace(new RegExp(char, "g"), value.toString())
  }

  // PASS 3: Replace en-dash and em-dash with regular dash for consistency
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
 * Extract modifier from ingredient item name
 * Detects preparation instructions in multiple formats:
 * - Comma-separated: "lentils, rinsed" → item: "lentils", modifier: "rinsed"
 * - Parenthetical: "butter (softened)" → item: "butter", modifier: "softened"
 * - "for X" pattern: "sugar, for topping" → item: "sugar", modifier: "for topping"
 * - Combinations: "butter (softened), for greasing" → item: "butter", modifier: "softened, for greasing"
 */
function extractModifier(item: string): { item: string; modifier: string | null } {
  if (!item) return { item: "", modifier: null }

  let baseItem = item
  const modifiers: string[] = []

  // Step 1: Extract "for X" pattern at the end (must be after comma or be the whole suffix)
  // Examples: "for topping", "for garnish", "for serving"
  const forPattern = /,?\s*\bfor\s+[a-z\s]+$/i
  const forMatch = baseItem.match(forPattern)
  if (forMatch) {
    const forText = forMatch[0].replace(/^,\s*/, '').trim()
    // Only accept if it's short (likely a purpose, not a long note)
    if (forText.length < 30) {
      modifiers.push(forText)
      baseItem = baseItem.substring(0, baseItem.length - forMatch[0].length).trim()
    }
  }

  // Step 2: Extract parenthetical modifiers
  // Only extract if they're short and likely prep instructions, not long notes
  // Examples: "(optional)", "(softened)", "(to be browned)", "(raw)", "(medium)"
  const parenPattern = /\s*\(([^)]+)\)\s*/g
  const parenMatches: { text: string; fullMatch: string; index: number }[] = []
  let match: RegExpExecArray | null

  while ((match = parenPattern.exec(baseItem)) !== null) {
    const innerText = match[1].trim()
    parenMatches.push({
      text: innerText,
      fullMatch: match[0],
      index: match.index
    })
  }

  // Filter for short parentheticals that look like modifiers
  // Match if the entire text is a known modifier or starts with one
  const modifierKeywords = /^(optional|softened|melted|browned|chopped|minced|diced|sliced|peeled|grated|shredded|crushed|mashed|drained|dried|toasted|roasted|fresh|frozen|thawed|cooked|uncooked|raw|whole|halved|quartered|cubed|medium|large|small|extra\s+large|to\s+be|as\s+needed|or\s+to\s+taste|peeled\s+or|or\s+unpeeled)(\s|$)/i

  for (const parenMatch of parenMatches.reverse()) { // Reverse to remove from end first
    const innerText = parenMatch.text
    // Accept if it's short enough and starts with or is a known modifier
    // Max 30 chars to avoid long notes like "(use 0.75 if bananas are very large)"
    const isModifier = innerText.length <= 30 && modifierKeywords.test(innerText)

    if (isModifier) {
      modifiers.unshift(innerText) // Add to front to maintain order
      // Remove the parenthetical, preserving spaces around it
      const before = baseItem.substring(0, parenMatch.index)
      const after = baseItem.substring(parenMatch.index + parenMatch.fullMatch.length)
      baseItem = (before + ' ' + after).replace(/\s+/g, ' ').trim()
    }
  }
  baseItem = baseItem.trim()

  // Step 3: Extract comma-separated modifier (existing logic)
  // Find the last comma that's not inside parentheses
  let lastCommaIndex = -1
  let parenDepth = 0

  for (let i = baseItem.length - 1; i >= 0; i--) {
    if (baseItem[i] === ')') parenDepth++
    else if (baseItem[i] === '(') parenDepth--
    else if (baseItem[i] === ',' && parenDepth === 0) {
      lastCommaIndex = i
      break
    }
  }

  if (lastCommaIndex !== -1) {
    const potentialModifier = baseItem.substring(lastCommaIndex + 1).trim()
    const beforeComma = baseItem.substring(0, lastCommaIndex).trim()

    // Only treat as modifier if it's reasonably short (likely a prep instruction)
    const isLikelyModifier =
      potentialModifier.length > 0 &&
      potentialModifier.length < 60 && // Reasonable length for a modifier
      !potentialModifier.match(/^\d+/) && // Doesn't start with a number
      beforeComma.length > 0 &&
      (potentialModifier.length < 25 || // Short enough to likely be a modifier
       modifierKeywords.test(potentialModifier))

    if (isLikelyModifier) {
      modifiers.unshift(potentialModifier) // Add to front to maintain order
      baseItem = beforeComma
    }
  }

  // Combine all modifiers
  if (modifiers.length > 0) {
    return { item: baseItem, modifier: modifiers.join(', ') }
  }

  return { item: baseItem, modifier: null }
}

/**
 * Extract alternative ingredients from "X or Y" pattern
 * Only extracts if pattern is clear substitution, not modifier context
 *
 * Examples:
 * - "Greek yogurt or sour cream" → item: "Greek yogurt", alternatives: ["sour cream"]
 * - "salt or pepper to taste" → item: "salt or pepper to taste", alternatives: undefined (keep as is)
 * - "peeled or unpeeled potatoes" → item: "peeled or unpeeled potatoes" (modifier context)
 */
function extractAlternatives(item: string): {
  item: string;
  alternatives?: string[]
} {
  // Ignore if it's a modifier context (appears in common phrases)
  const modifierContextPatterns = [
    /to taste/i,
    /as needed/i,
    /or unpeeled/i,
    /or peeled/i,
    /more or less/i,
    /or more/i,
    /or less/i,
  ];

  for (const pattern of modifierContextPatterns) {
    if (pattern.test(item)) {
      return { item };
    }
  }

  // Match "X or Y" pattern (case-insensitive)
  // Requires "or" to be surrounded by word boundaries to avoid matching "orange" etc.
  const altPattern = /^(.+?)\s+\bor\b\s+(.+)$/i;
  const match = item.match(altPattern);

  if (match) {
    const [_, primary, alternative] = match;
    const trimmedPrimary = primary.trim();
    const trimmedAlt = alternative.trim();

    // Only extract if both parts are substantial (not just single letters)
    if (trimmedPrimary.length > 1 && trimmedAlt.length > 1) {
      return {
        item: trimmedPrimary,
        alternatives: [trimmedAlt]
      };
    }
  }

  return { item };
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
