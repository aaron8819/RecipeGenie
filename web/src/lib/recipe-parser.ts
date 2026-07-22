import type { Ingredient } from "@/types/database"
import {
  WHOLE_COUNT_UNIT,
  normalizeWholeCountUnit,
} from "@/lib/ingredient-units"

type SectionKind = "ingredients" | "instructions" | "notes"

interface RecipeLine {
  raw: string
  trimmed: string
}

interface SectionBlock {
  kind: SectionKind
  header: string
  lines: RecipeLine[]
}

export interface ParsedRecipeMetadata {
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
}

export interface ParsedIngredientGroup {
  label?: string
  ingredients: Ingredient[]
}

export interface ParsedInstructionGroup {
  label?: string
  steps: string[]
}

export interface ParsedRecipe {
  name: string
  ingredients: Ingredient[]
  instructions: string[]
  servings?: number
  notes?: string[]
  metadata?: ParsedRecipeMetadata
  ingredientGroups?: ParsedIngredientGroup[]
  instructionGroups?: ParsedInstructionGroup[]
  warnings: string[]
}

/**
 * Parse a recipe from plain text.
 *
 * The parser is intentionally staged:
 * 1. Normalize lines
 * 2. Extract top-of-file metadata
 * 3. Detect top-level sections
 * 4. Detect subgroup labels inside sections
 * 5. Parse ingredients, instructions, and notes
 * 6. Flatten to the current app model without dropping structure
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const warnings: string[] = []
  const lines = toRecipeLines(text)

  if (lines.every((line) => !line.trimmed)) {
    return {
      name: "",
      ingredients: [],
      instructions: [],
      warnings: ["No text to parse - paste recipe text above"],
    }
  }

  const { prelude, sections } = splitIntoSections(lines)
  const preludeMetadata = extractPreludeMetadata(prelude)

  let name = inferRecipeName(preludeMetadata.titleLine, preludeMetadata.remainingLines)
  let servings = preludeMetadata.servings
  const metadata = buildRecipeMetadata(preludeMetadata)

  if (!servings) {
    const servingsFromName = extractServingsFromText(name)
    if (servingsFromName) {
      servings = servingsFromName
      name = stripServingsFromTitle(name)
    }
  }

  const ingredientsSection = sections.find((section) => section.kind === "ingredients")
  const instructionsSection = sections.find((section) => section.kind === "instructions")
  const notesSection = sections.find((section) => section.kind === "notes")

  let ingredientGroups: ParsedIngredientGroup[] = []
  let instructionGroups: ParsedInstructionGroup[] = []
  let notes: string[] = []

  if (sections.length === 0) {
    const fallback = parseLegacyRecipeText(
      preludeMetadata.remainingLines,
      name,
      servings
    )

    name = fallback.name
    servings = fallback.servings
    ingredientGroups = fallback.ingredientGroups
    instructionGroups = fallback.instructionGroups
    notes = fallback.notes
  } else {
    ingredientGroups = ingredientsSection
      ? parseIngredientSection(ingredientsSection.lines)
      : parseIngredientSection(inferPreludeIngredientLines(preludeMetadata.remainingLines, name))

    instructionGroups = instructionsSection
      ? parseInstructionSection(instructionsSection.lines)
      : []

    notes = notesSection ? parseNotesSection(notesSection.lines) : []
  }

  const ingredients = flattenIngredientGroups(ingredientGroups)
  const instructions = flattenInstructionGroupsForCurrentModel(instructionGroups, notes)

  if (!name || name === "Untitled Recipe") {
    warnings.push('No recipe name found - using "Untitled Recipe"')
  }

  if (ingredients.length === 0) {
    warnings.push('No ingredients found - add an "Ingredients" section')
  } else {
    const noAmountIngredients = ingredients.filter(shouldWarnMissingIngredientAmount)
    if (noAmountIngredients.length === 1) {
      warnings.push(`"${noAmountIngredients[0].item}" has no amount`)
    } else if (noAmountIngredients.length > 1 && noAmountIngredients.length <= 3) {
      warnings.push(
        `${noAmountIngredients.length} ingredients have no amounts: ${noAmountIngredients
          .map((ingredient) => ingredient.item)
          .join(", ")}`
      )
    } else if (noAmountIngredients.length > 3) {
      warnings.push(`${noAmountIngredients.length} ingredients have no amounts`)
    }
  }

  if (instructionGroups.length === 0 && notes.length === 0) {
    warnings.push('No instructions found - add a "Directions" or "Instructions" section')
  }

  return {
    name: name || "Untitled Recipe",
    ingredients,
    instructions,
    servings,
    notes: notes.length > 0 ? notes : undefined,
    metadata,
    ingredientGroups: ingredientGroups.length > 0 ? ingredientGroups : undefined,
    instructionGroups: instructionGroups.length > 0 ? instructionGroups : undefined,
    warnings,
  }
}

function toRecipeLines(text: string): RecipeLine[] {
  const normalized = text
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")

  return normalized.split("\n").map((raw) => ({
    raw,
    trimmed: raw.trim(),
  }))
}

function splitIntoSections(lines: RecipeLine[]): {
  prelude: RecipeLine[]
  sections: SectionBlock[]
} {
  const prelude: RecipeLine[] = []
  const sections: SectionBlock[] = []
  let currentSection: SectionBlock | null = null

  for (const line of lines) {
    const kind = parseTopLevelSectionKind(line.trimmed)

    if (kind) {
      if (currentSection) {
        sections.push(currentSection)
      }

      currentSection = {
        kind,
        header: line.trimmed,
        lines: [],
      }
      continue
    }

    if (currentSection) {
      currentSection.lines.push(line)
    } else {
      prelude.push(line)
    }
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return { prelude, sections }
}

function parseTopLevelSectionKind(line: string): SectionKind | null {
  const normalized = normalizeHeaderLabel(line)
  if (!normalized) return null

  if (/^(?:ingredients?|what (?:you(?:['’]?ll| will)? )?need)$/.test(normalized)) {
    return "ingredients"
  }

  if (/^(instructions?|directions?|method|steps?)$/.test(normalized)) {
    return "instructions"
  }

  if (/^(notes?|tips?)$/.test(normalized)) {
    return "notes"
  }

  return null
}

function normalizeHeaderLabel(line: string): string {
  return line
    .toLowerCase()
    .replace(/[:\-\u2013\u2014]+$/, "")
    .trim()
}

function extractPreludeMetadata(lines: RecipeLine[]): {
  titleLine?: string
  remainingLines: RecipeLine[]
  servings?: number
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
} {
  const remainingLines: RecipeLine[] = []
  const metadata: {
    titleLine?: string
    servings?: number
    prepTime?: string
    prepTimeMinutes?: number
    cookTime?: string
    cookTimeMinutes?: number
    totalTime?: string
    totalTimeMinutes?: number
  } = {}

  for (const line of lines) {
    const trimmed = line.trimmed

    if (!trimmed) {
      remainingLines.push(line)
      continue
    }

    const titleMatch = trimmed.match(/^(?:title|recipe|name)\s*:\s*(.+)$/i)
    if (titleMatch) {
      metadata.titleLine = titleMatch[1].trim()
      continue
    }

    const servingsMatch = trimmed.match(
      /^(?:servings?|serves|yield|makes?)\s*:?\s*(.+)$/i
    )
    if (servingsMatch) {
      metadata.servings = extractServingsFromText(servingsMatch[1])
      continue
    }

    const prepTimeMatch = trimmed.match(/^prep(?:aration)?\s*time\s*:\s*(.+)$/i)
    if (prepTimeMatch) {
      metadata.prepTime = prepTimeMatch[1].trim()
      metadata.prepTimeMinutes = parseDurationToMinutes(metadata.prepTime)
      continue
    }

    const cookTimeMatch = trimmed.match(/^cook(?:ing)?\s*time\s*:\s*(.+)$/i)
    if (cookTimeMatch) {
      metadata.cookTime = cookTimeMatch[1].trim()
      metadata.cookTimeMinutes = parseDurationToMinutes(metadata.cookTime)
      continue
    }

    const totalTimeMatch = trimmed.match(/^total\s*time\s*:\s*(.+)$/i)
    if (totalTimeMatch) {
      metadata.totalTime = totalTimeMatch[1].trim()
      metadata.totalTimeMinutes = parseDurationToMinutes(metadata.totalTime)
      continue
    }

    remainingLines.push(line)
  }

  return {
    titleLine: metadata.titleLine,
    remainingLines,
    servings: metadata.servings,
    prepTime: metadata.prepTime,
    prepTimeMinutes: metadata.prepTimeMinutes,
    cookTime: metadata.cookTime,
    cookTimeMinutes: metadata.cookTimeMinutes,
    totalTime: metadata.totalTime,
    totalTimeMinutes: metadata.totalTimeMinutes,
  }
}

function buildRecipeMetadata(metadata: {
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
}): ParsedRecipeMetadata | undefined {
  if (!hasTimeMetadata(metadata)) {
    return undefined
  }

  return {
    prepTime: metadata.prepTime,
    prepTimeMinutes: metadata.prepTimeMinutes,
    cookTime: metadata.cookTime,
    cookTimeMinutes: metadata.cookTimeMinutes,
    totalTime: metadata.totalTime,
    totalTimeMinutes: metadata.totalTimeMinutes,
  }
}

function hasTimeMetadata(metadata: {
  prepTime?: string
  cookTime?: string
  totalTime?: string
}): boolean {
  return Boolean(metadata.prepTime || metadata.cookTime || metadata.totalTime)
}

function inferRecipeName(titleLine: string | undefined, remainingPreludeLines: RecipeLine[]): string {
  if (titleLine) {
    return cleanDetectedTitle(titleLine)
  }

  const firstContentLine = remainingPreludeLines.find((line) => line.trimmed)
  return cleanDetectedTitle(firstContentLine?.trimmed || "")
}

function cleanDetectedTitle(value: string): string {
  return value.replace(/^(?:title|recipe|name)\s*:\s*/i, "").trim()
}

function stripServingsFromTitle(value: string): string {
  return value
    .replace(
      /\s*[\(\-–—,]?\s*(?:makes?|serves?)\s+\d+\s*(?:servings?|people|portions?)?\)?$/i,
      ""
    )
    .replace(/\s*[\(\-–—,]?\s*\d+\s*(?:servings?|people|portions?)\)?$/i, "")
    .replace(/\s*\(\s*serves?\s+\d+\s*\)$/i, "")
    .trim()
}

function extractServingsFromText(value: string): number | undefined {
  const directNumberMatch = value.match(/(\d+(?:\.\d+)?)/)
  if (!directNumberMatch) return undefined

  const servingsContextMatch = value.match(
    /\b(\d+(?:\.\d+)?)\b(?:\s*(?:servings?|people|portions?|cookies?))?/i
  )

  if (!servingsContextMatch) {
    return undefined
  }

  const servings = parseFloat(servingsContextMatch[1])
  return Number.isFinite(servings) ? Math.round(servings) : undefined
}

function parseDurationToMinutes(value: string): number | undefined {
  const normalized = value.toLowerCase().replace(/\u2013|\u2014/g, "-")
  const unitPattern =
    /(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/g

  let totalMinutes = 0
  let match: RegExpExecArray | null

  while ((match = unitPattern.exec(normalized)) !== null) {
    const amount = parseFloat(match[1])
    const unit = match[2]

    if (!Number.isFinite(amount)) {
      continue
    }

    if (/^h(?:ours?|rs?)?$/.test(unit)) {
      totalMinutes += amount * 60
      continue
    }

    totalMinutes += amount
  }

  return totalMinutes > 0 ? Math.round(totalMinutes) : undefined
}

function inferPreludeIngredientLines(lines: RecipeLine[], name: string): RecipeLine[] {
  const contentLines = lines.filter((line) => line.trimmed)
  if (contentLines.length === 0) {
    return []
  }

  if (name && cleanDetectedTitle(contentLines[0].trimmed) === name) {
    return contentLines.slice(1)
  }

  return contentLines
}

function parseIngredientSection(lines: RecipeLine[]): ParsedIngredientGroup[] {
  const groups: ParsedIngredientGroup[] = []
  let currentGroup: ParsedIngredientGroup = { ingredients: [] }

  const pushCurrentGroup = () => {
    if (currentGroup.ingredients.length === 0) {
      return
    }

    groups.push(currentGroup)
  }

  for (const line of lines) {
    if (!line.trimmed) {
      continue
    }

    if (isSubsectionLabel(line.trimmed)) {
      pushCurrentGroup()
      currentGroup = {
        label: stripTrailingColon(line.trimmed),
        ingredients: [],
      }
      continue
    }

    const ingredient = parseIngredientLine(line.trimmed)
    if (!ingredient.item) {
      continue
    }

    currentGroup.ingredients.push(
      currentGroup.label
        ? {
            ...ingredient,
            groupLabel: currentGroup.label,
          }
        : ingredient
    )
  }

  pushCurrentGroup()
  return groups
}

function parseInstructionSection(lines: RecipeLine[]): ParsedInstructionGroup[] {
  const groups: ParsedInstructionGroup[] = []
  let currentGroup: ParsedInstructionGroup = { steps: [] }
  let pendingStep: string | null = null

  const flushPendingStep = () => {
    if (!pendingStep) {
      return
    }

    currentGroup.steps.push(pendingStep)
    pendingStep = null
  }

  const pushCurrentGroup = () => {
    flushPendingStep()

    if (currentGroup.steps.length === 0) {
      return
    }

    groups.push(currentGroup)
  }

  for (const line of lines) {
    const trimmed = line.trimmed

    if (!trimmed) {
      flushPendingStep()
      continue
    }

    if (isSubsectionLabel(trimmed)) {
      pushCurrentGroup()
      currentGroup = {
        label: stripTrailingColon(trimmed),
        steps: [],
      }
      continue
    }

    if (isInstructionStepStart(trimmed)) {
      flushPendingStep()
      pendingStep = stripInstructionMarker(trimmed)
      continue
    }

    pendingStep = pendingStep ? `${pendingStep} ${trimmed}` : trimmed
  }

  pushCurrentGroup()
  return groups
}

function parseNotesSection(lines: RecipeLine[]): string[] {
  const notes: string[] = []

  for (const line of lines) {
    if (!line.trimmed) {
      continue
    }

    notes.push(stripInstructionMarker(line.trimmed))
  }

  return notes
}

function flattenIngredientGroups(groups: ParsedIngredientGroup[]): Ingredient[] {
  return groups.flatMap((group) => group.ingredients)
}

function flattenInstructionGroupsForCurrentModel(
  groups: ParsedInstructionGroup[],
  notes: string[]
): string[] {
  const flattened: string[] = []

  for (const group of groups) {
    if (group.label) {
      flattened.push(`${group.label}:`)
    }

    flattened.push(...group.steps)
  }

  if (notes.length > 0) {
    flattened.push("Notes:")
    flattened.push(...notes)
  }

  return flattened
}

function shouldWarnMissingIngredientAmount(ingredient: Ingredient): boolean {
  if (!ingredient.item.trim()) {
    return false
  }

  if (ingredient.amount !== null) {
    return false
  }

  const modifier = ingredient.modifier?.toLowerCase().trim()
  if (modifier && /^(to taste|as needed)$/.test(modifier)) {
    return false
  }

  return true
}

function isSubsectionLabel(line: string): boolean {
  if (!line.endsWith(":")) {
    return false
  }

  if (parseTopLevelSectionKind(line)) {
    return false
  }

  const normalized = stripTrailingColon(line)

  if (!normalized) return false
  if (/\d/.test(normalized)) return false
  if (/[.!?]/.test(normalized)) return false
  if (/[(),]/.test(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 6
}

function stripTrailingColon(line: string): string {
  return line.replace(/:\s*$/, "").trim()
}

function isInstructionStepStart(line: string): boolean {
  return /^\s*(?:\d+[\.\)]|[-*\u2022])\s+/.test(line)
}

function stripInstructionMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[\.\)]|[-*\u2022])\s+/, "").trim()
}

function parseLegacyRecipeText(
  lines: RecipeLine[],
  existingName: string,
  existingServings?: number
): {
  name: string
  servings?: number
  ingredientGroups: ParsedIngredientGroup[]
  instructionGroups: ParsedInstructionGroup[]
  notes: string[]
} {
  const contentLines = lines
    .map((line) => line.trimmed)
    .filter(Boolean)

  if (contentLines.length === 0) {
    return {
      name: existingName || "Untitled Recipe",
      servings: existingServings,
      ingredientGroups: [],
      instructionGroups: [],
      notes: [],
    }
  }

  let name = existingName
  let servings = existingServings

  if (!name) {
    name = cleanDetectedTitle(contentLines[0] || "")
  }

  if (!servings) {
    const servingsFromName = extractServingsFromText(name)
    if (servingsFromName) {
      servings = servingsFromName
      name = stripServingsFromTitle(name)
    }
  }

  const bodyLines =
    name && cleanDetectedTitle(contentLines[0] || "") === name
      ? contentLines.slice(1)
      : contentLines

  const ingredientsIndex = findSectionIndex(bodyLines, ["ingredients", "ingredient"])
  const instructionsIndex = findSectionIndex(bodyLines, [
    "instructions",
    "instruction",
    "directions",
    "direction",
    "method",
    "steps",
    "step",
  ])
  const notesIndex = findSectionIndex(bodyLines, ["notes", "note", "tips", "tip"])

  const ingredientsStart = ingredientsIndex >= 0 ? ingredientsIndex + 1 : 0
  let ingredientsEnd = instructionsIndex >= 0 ? instructionsIndex : bodyLines.length

  if (notesIndex >= 0 && (ingredientsEnd < 0 || notesIndex < ingredientsEnd)) {
    ingredientsEnd = notesIndex
  }

  const ingredientGroups =
    ingredientsStart < ingredientsEnd
      ? [
          {
            ingredients: bodyLines
              .slice(ingredientsStart, ingredientsEnd)
              .map((line) => parseIngredientLine(line))
              .filter((ingredient) => ingredient.item.length > 0),
          },
        ]
      : []

  let instructionLines: string[] = []
  if (instructionsIndex >= 0) {
    const instructionsEnd = notesIndex >= 0 ? notesIndex : bodyLines.length
    instructionLines = bodyLines.slice(instructionsIndex + 1, instructionsEnd)
  } else if (ingredientsIndex >= 0) {
    instructionLines = bodyLines.slice(ingredientsEnd)
  } else {
    instructionLines = bodyLines.filter(
      (line) => isInstructionStepStart(line) || line.length > 50
    )
  }

  const instructionGroups =
    instructionLines.length > 0
      ? [
          {
            steps: instructionLines
              .map((line) => stripInstructionMarker(line))
              .filter(Boolean),
          },
        ]
      : []

  const notes =
    notesIndex >= 0
      ? bodyLines.slice(notesIndex + 1).map((line) => stripInstructionMarker(line)).filter(Boolean)
      : []

  return {
    name: name || "Untitled Recipe",
    servings,
    ingredientGroups,
    instructionGroups,
    notes,
  }
}

function findSectionIndex(lines: string[], keywords: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeHeaderLabel(lines[index])
    if (keywords.some((keyword) => normalized === keyword)) {
      return index
    }
  }

  return -1
}

/**
 * Unicode fraction to decimal mapping.
 */
const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BD": 0.5,
  "\u2153": 1 / 3,
  "\u2154": 2 / 3,
  "\u00BC": 0.25,
  "\u00BE": 0.75,
  "\u2155": 0.2,
  "\u2156": 0.4,
  "\u2157": 0.6,
  "\u2158": 0.8,
  "\u2159": 1 / 6,
  "\u215A": 5 / 6,
  "\u215B": 0.125,
  "\u215C": 0.375,
  "\u215D": 0.625,
  "\u215E": 0.875,
}

/**
 * Common unit abbreviations.
 */
const UNIT_ABBREVIATIONS = [
  "tsp",
  "tbsp",
  "tablespoon",
  "teaspoon",
  "tablespoons",
  "teaspoons",
  "cup",
  "cups",
  "c",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "ml",
  "milliliter",
  "milliliters",
  "l",
  "liter",
  "liters",
  "fl oz",
  "fluid ounce",
  "fluid ounces",
  "pt",
  "pint",
  "pints",
  "qt",
  "quart",
  "quarts",
  "gal",
  "gallon",
  "gallons",
  "can",
  "cans",
  "package",
  "packages",
  "pkg",
  "pkgs",
  "count",
  "counts",
  "whole",
  "whole/count",
  "whole item",
  "whole items",
  "clove",
  "cloves",
  "head",
  "heads",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "slice",
  "slices",
  "strip",
  "strips",
  "pinch",
  "dash",
  "sprinkle",
]

/**
 * Parse a single ingredient line into an Ingredient object.
 */
export function parseIngredientLine(line: string): Ingredient {
  let cleaned = line.trim()

  // Remove list markers at the start, but preserve numbered amounts.
  cleaned = cleaned.replace(/^[\-\*\u2022\.]\s+/, "").trim()

  const originalText = cleaned

  if (!cleaned || /^ingredients?:?$/i.test(cleaned)) {
    return { item: "", amount: null, unit: "" }
  }

  cleaned = normalizeUnicode(cleaned)

  const amountPattern =
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+\.\d+|\d+)(\s*[\u2013\u2014-]\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+\.\d+|\d+))?(?=\s|$|[a-z])/i
  const amountMatch = cleaned.match(amountPattern)

  if (amountMatch) {
    let amount: Ingredient["amount"] = null
    let unit = ""

    const amountEndIndex = amountMatch[0].length
    let remaining = cleaned.substring(amountEndIndex).trim()

    const hasRange = Boolean(amountMatch[3])
    amount = hasRange
      ? formatQuantityRange(parseAmount(amountMatch[1]), parseAmount(amountMatch[3]))
      : parseAmount(amountMatch[1])

    const unitMatch = extractUnit(remaining)
    if (unitMatch) {
      unit = normalizeWholeCountUnit(unitMatch.unit) || unitMatch.unit
      remaining = remaining.substring(unitMatch.endIndex).trim()
    } else if (remaining) {
      unit = WHOLE_COUNT_UNIT
    }

    const { item: baseItem, modifier } = extractModifier(remaining)
    const { item: finalItem, alternatives } = extractAlternatives(baseItem)

    return {
      item: finalItem || cleaned,
      amount,
      unit,
      modifier: modifier || undefined,
      alternatives,
      originalText,
    }
  }

  const { item: baseItem, modifier } = extractModifier(cleaned)
  const { item: finalItem, alternatives } = extractAlternatives(baseItem)

  return {
    item: finalItem,
    amount: null,
    unit: "",
    modifier: modifier || undefined,
    alternatives,
    originalText,
  }
}

/**
 * Normalize a quantity typed into an ingredient amount field.
 * Ranges use decimal endpoints and an en dash (for example, `0.5–1`).
 */
export function parseIngredientAmountInput(value: string): Ingredient["amount"] {
  const normalized = normalizeUnicode(value.trim())
  const endpoint = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+\.\d+|\d+)`
  const match = normalized.match(
    new RegExp(`^(${endpoint})(?:\\s*[-]\\s*(${endpoint}))?$`)
  )

  if (!match) {
    return null
  }

  const start = parseAmount(match[1])
  return match[2] ? formatQuantityRange(start, parseAmount(match[2])) : start
}

export function getIngredientQuantityRange(
  amount: Ingredient["amount"]
): { start: number; end: number; quantity: string } | null {
  if (typeof amount !== "string") {
    return null
  }

  const normalized = parseIngredientAmountInput(amount)
  if (typeof normalized !== "string") {
    return null
  }

  const [start, end] = normalized.split("–").map(Number)
  return { start, end, quantity: normalized }
}

export function hasIngredientAmount(amount: Ingredient["amount"]): boolean {
  return typeof amount === "number" ? amount > 0 : Boolean(amount?.trim())
}

function formatQuantityRange(start: number, end: number): string {
  return `${start}–${end}`
}

function normalizeUnicode(text: string): string {
  let normalized = text

  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    const mixedPattern = new RegExp(`(\\d+)${char}`, "g")
    normalized = normalized.replace(mixedPattern, (_match, whole) => {
      const wholeNumber = parseFloat(whole)
      return (wholeNumber + value).toString()
    })
  }

  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replace(new RegExp(char, "g"), value.toString())
  }

  normalized = normalized.replace(/[\u2013\u2014]/g, "-")
  return normalized
}

function parseAmount(amountStr: string): number {
  const mixedFraction = amountStr.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixedFraction) {
    const whole = parseFloat(mixedFraction[1])
    const numerator = parseFloat(mixedFraction[2])
    const denominator = parseFloat(mixedFraction[3])
    if (denominator !== 0) {
      return whole + numerator / denominator
    }
  }

  if (amountStr.includes("/")) {
    return parseFraction(amountStr)
  }

  const amount = parseFloat(amountStr)
  return Number.isNaN(amount) ? 0 : amount
}

function extractUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null

  const parenMatch = text.match(/^(\([^)]+\))\s*/)
  if (parenMatch) {
    const parenUnit = parenMatch[1]
    const afterParen = text.substring(parenMatch[0].length).trim()
    const unitMatch = matchUnit(afterParen)

    if (unitMatch) {
      return {
        unit: `${unitMatch.unit} ${parenUnit}`.trim(),
        endIndex: parenMatch[0].length + unitMatch.endIndex,
      }
    }

    return {
      unit: parenUnit,
      endIndex: parenMatch[0].length,
    }
  }

  return matchUnit(text)
}

function matchUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null

  const sortedUnits = [...UNIT_ABBREVIATIONS].sort((left, right) => right.length - left.length)

  for (const unit of sortedUnits) {
    const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`^(${escapedUnit})(\\s+|$)`, "i")
    const match = text.match(regex)

    if (match) {
      return {
        unit: match[1],
        endIndex: match[0].length,
      }
    }
  }

  return null
}

function extractModifier(item: string): { item: string; modifier: string | null } {
  if (!item) {
    return { item: "", modifier: null }
  }

  let baseItem = item
  const modifiers: string[] = []

  const forPattern = /,?\s*\bfor\s+[a-z\s]+$/i
  const forMatch = baseItem.match(forPattern)
  if (forMatch) {
    const forText = forMatch[0].replace(/^,\s*/, "").trim()
    if (forText.length < 30) {
      modifiers.push(forText)
      baseItem = baseItem.substring(0, baseItem.length - forMatch[0].length).trim()
    }
  }

  const parenPattern = /\s*\(([^)]+)\)\s*/g
  const parenMatches: { text: string; fullMatch: string; index: number }[] = []
  let match: RegExpExecArray | null

  while ((match = parenPattern.exec(baseItem)) !== null) {
    parenMatches.push({
      text: match[1].trim(),
      fullMatch: match[0],
      index: match.index,
    })
  }

  const modifierKeywords =
    /^(optional|softened|melted|browned|chopped|minced|diced|sliced|peeled|grated|shredded|crushed|mashed|drained|dried|toasted|roasted|fresh|frozen|thawed|cooked|uncooked|raw|whole|halved|quartered|cubed|medium|large|small|extra\s+large|to\s+be|as\s+needed|or\s+to\s+taste|peeled\s+or|or\s+unpeeled)(\s|$)/i

  for (const parenMatch of parenMatches.reverse()) {
    const innerText = parenMatch.text
    const isModifier = innerText.length <= 30 && modifierKeywords.test(innerText)

    if (isModifier) {
      modifiers.unshift(innerText)
      const before = baseItem.substring(0, parenMatch.index)
      const after = baseItem.substring(parenMatch.index + parenMatch.fullMatch.length)
      baseItem = `${before} ${after}`.replace(/\s+/g, " ").trim()
    }
  }

  let lastCommaIndex = -1
  let parenDepth = 0

  for (let index = baseItem.length - 1; index >= 0; index -= 1) {
    if (baseItem[index] === ")") parenDepth += 1
    else if (baseItem[index] === "(") parenDepth -= 1
    else if (baseItem[index] === "," && parenDepth === 0) {
      lastCommaIndex = index
      break
    }
  }

  if (lastCommaIndex !== -1) {
    const potentialModifier = baseItem.substring(lastCommaIndex + 1).trim()
    const beforeComma = baseItem.substring(0, lastCommaIndex).trim()

    const isLikelyModifier =
      potentialModifier.length > 0 &&
      potentialModifier.length < 60 &&
      !/^\d+/.test(potentialModifier) &&
      beforeComma.length > 0 &&
      (potentialModifier.length < 25 || modifierKeywords.test(potentialModifier))

    if (isLikelyModifier) {
      modifiers.unshift(potentialModifier)
      baseItem = beforeComma
    }
  }

  return modifiers.length > 0
    ? { item: baseItem, modifier: modifiers.join(", ") }
    : { item: baseItem, modifier: null }
}

function extractAlternatives(item: string): { item: string; alternatives?: string[] } {
  const modifierContextPatterns = [
    /to taste/i,
    /as needed/i,
    /or unpeeled/i,
    /or peeled/i,
    /more or less/i,
    /or more/i,
    /or less/i,
  ]

  for (const pattern of modifierContextPatterns) {
    if (pattern.test(item)) {
      return { item }
    }
  }

  const alternativeMatch = item.match(/^(.+?)\s+\bor\b\s+(.+)$/i)
  if (!alternativeMatch) {
    return { item }
  }

  const primary = alternativeMatch[1].trim()
  const alternative = alternativeMatch[2].trim()

  if (primary.length <= 1 || alternative.length <= 1) {
    return { item }
  }

  return {
    item: primary,
    alternatives: [alternative],
  }
}

function parseFraction(fraction: string): number {
  const parts = fraction.split("/")
  if (parts.length !== 2) {
    return parseFloat(fraction) || 0
  }

  const numerator = parseFloat(parts[0])
  const denominator = parseFloat(parts[1])

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return parseFloat(fraction) || 0
  }

  return numerator / denominator
}
