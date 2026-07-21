/**
 * Unit normalization utilities for shopping list
 * Ensures consistent unit representation across the system
 */

import {
  canonicalizeShoppingIngredient,
  type CanonicalShoppingIngredient,
} from "./shopping-ingredient-canonicalization"

const SIMPLE_UNIT_MAP: Record<string, string> = {
  // Volume units
  milliliter: "ml",
  milliliters: "ml",
  liter: "l",
  liters: "l",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  c: "cup",
  "fluid ounce": "fl oz",
  "fluid ounces": "fl oz",
  pint: "pint",
  pints: "pint",
  pt: "pint",
  quart: "quart",
  quarts: "quart",
  qt: "quart",
  gallon: "gallon",
  gallons: "gallon",
  gal: "gallon",

  // Weight units
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  ounce: "oz",
  ounces: "oz",
  pound: "lb",
  pounds: "lb",
  lbs: "lb",

  // Count and package units
  piece: "piece",
  pieces: "piece",
  pc: "piece",
  pcs: "piece",
  whole: "count",
  wholes: "count",
  "whole/count": "count",
  "whole item": "count",
  "whole items": "count",
  count: "count",
  counts: "count",
  clove: "clove",
  cloves: "clove",
  slice: "slice",
  slices: "slice",
  can: "can",
  cans: "can",
  bunch: "bunch",
  bunches: "bunch",
  head: "head",
  heads: "head",
  stalk: "stalk",
  stalks: "stalk",
  sprig: "sprig",
  sprigs: "sprig",
  package: "package",
  packages: "package",
  pkg: "package",
  pkgs: "package",
  bag: "bag",
  bags: "bag",
  box: "box",
  boxes: "box",
  jar: "jar",
  jars: "jar",
  bottle: "bottle",
  bottles: "bottle",
}

const SIZED_PACKAGE_PATTERN =
  /^(can|cans|jar|jars|bottle|bottles|package|packages|pkg|pkgs|bag|bags|box|boxes)\s*\(([^)]+)\)$/

// Legacy free-form normalization remains for non-shopping consumers such as
// recipe duplicate warnings. Shopping identity uses the structured contract.
const ITEM_CANONICAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bextra[\s-]+virgin olive oil\b/g, "olive oil"],
  [/\bevoo\b/g, "olive oil"],
  [/\byellow onions?\b/g, "onion"],
  [/\bwhite onions?\b/g, "onion"],
  [/\bonions\b/g, "onion"],
  [/\bgarlic cloves?\b/g, "garlic"],
]

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const WHOLE_PRODUCE_DEFAULTS = new Set(["lime", "lemon", "onion"])
const CITRUS_PURCHASE_NAMES: Record<string, string> = {
  lime: "lime",
  limes: "lime",
  lemon: "lemon",
  lemons: "lemon",
}
const CITRUS_YIELDS: Record<string, { juiceTbsp: number; zestTbsp: number }> = {
  lemon: { juiceTbsp: 3, zestTbsp: 1 },
  lime: { juiceTbsp: 2, zestTbsp: 2 / 3 },
}
const WHOLE_PRODUCE_PURCHASE_NAMES: Record<string, string> = {
  ...CITRUS_PURCHASE_NAMES,
  onion: "onion",
  onions: "onion",
}

export type ShoppingPurchaseNormalization = {
  purchaseName: string
  purchaseUnit: string | null
  purchaseQuantity: number | null
  originalName: string
  originalUnit: string | null
  originalQuantity: number | null
  prepIntent?: string
  canonical: CanonicalShoppingIngredient
  confidence: "high" | "medium" | "low"
  reason: string
}

export type ShoppingPurchaseNormalizationInput = {
  item: string
  amount?: number | null
  unit?: string | null
  modifier?: string | null
}

function parseQuantityToken(token: string): number | null {
  const normalized = token.toLowerCase().trim()
  const wordValue = NUMBER_WORDS[normalized]
  if (wordValue !== undefined) return wordValue

  const fractionMatch = normalized.match(/^(\d+)\/(\d+)$/)
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    return denominator ? numerator / denominator : null
  }

  const numericValue = Number(normalized)
  return Number.isFinite(numericValue) ? numericValue : null
}

function createBasePurchaseNormalization(
  input: ShoppingPurchaseNormalizationInput
): ShoppingPurchaseNormalization {
  const originalName = input.item.trim()
  const canonical = canonicalizeShoppingIngredient({
    item: input.item,
    modifier: input.modifier,
  })
  return {
    purchaseName: canonical.displayName,
    purchaseUnit: normalizeUnit(input.unit || ""),
    purchaseQuantity: input.amount ?? null,
    originalName,
    originalUnit: input.unit ?? null,
    originalQuantity: input.amount ?? null,
    prepIntent: canonical.preparationModifiers.join(", ") || undefined,
    canonical,
    confidence: "high",
    reason: "default ingredient normalization",
  }
}

function normalizeWholeProduce(
  input: ShoppingPurchaseNormalizationInput,
  purchaseName: string,
  options?: { prepIntent?: string; quantity?: number | null; confidence?: "high" | "medium"; reason: string }
): ShoppingPurchaseNormalization {
  const quantity = options?.quantity ?? input.amount ?? (WHOLE_PRODUCE_DEFAULTS.has(purchaseName) ? 1 : null)
  const originalCanonical = canonicalizeShoppingIngredient({
    item: input.item,
    modifier: input.modifier,
  })
  const canonicalPurchase = canonicalizeShoppingIngredient({ item: purchaseName })
  const prepIntent =
    options?.prepIntent ||
    originalCanonical.preparationModifiers.join(", ") ||
    undefined

  return {
    purchaseName,
    purchaseUnit: "count",
    purchaseQuantity: quantity,
    originalName: input.item.trim(),
    originalUnit: input.unit ?? null,
    originalQuantity: input.amount ?? null,
    prepIntent,
    canonical: {
      ...canonicalPurchase,
      optional: originalCanonical.optional,
      preparationModifiers: prepIntent ? [prepIntent] : [],
    },
    confidence: options?.confidence ?? "high",
    reason: options?.reason ?? "whole produce purchase",
  }
}

function tablespoonsFromVolume(amount: number, unit: string): number | null {
  switch (normalizeUnit(unit)) {
    case "tbsp":
      return amount
    case "tsp":
      return amount / 3
    case "cup":
      return amount * 16
    case "fl oz":
      return amount * 2
    case "ml":
      return amount / 14.787
    default:
      return null
  }
}

function citrusQuantityFromMeasuredVolume(
  fruitName: string,
  prepIntent: "juiced" | "zested",
  amount: number | null | undefined,
  unit: string | null | undefined
): number | null {
  if (!amount || !unit) return null

  const tablespoons = tablespoonsFromVolume(amount, unit)
  if (!tablespoons) return null

  const yieldKey = prepIntent === "juiced" ? "juiceTbsp" : "zestTbsp"
  return tablespoons / CITRUS_YIELDS[fruitName][yieldKey]
}

function normalizeMeasuredCitrus(
  input: ShoppingPurchaseNormalizationInput,
  fruitName: string,
  prepIntent: "juiced" | "zested",
  reason: string,
  parsedAmount?: number | null,
  parsedUnit?: string | null
): ShoppingPurchaseNormalization | null {
  const amount = parsedAmount ?? input.amount
  const unit = parsedUnit ?? input.unit
  const quantity = citrusQuantityFromMeasuredVolume(fruitName, prepIntent, amount, unit)

  if (!quantity) return null

  return normalizeWholeProduce(input, fruitName, {
    quantity,
    prepIntent,
    confidence: "medium",
    reason,
  })
}

function normalizeToken(token: string): string {
  return SIMPLE_UNIT_MAP[token] ?? token
}

function normalizeSizedPackageUnit(unit: string): string | null {
  const match = unit.match(SIZED_PACKAGE_PATTERN)
  if (!match) return null

  const packageUnit = normalizeToken(match[1])
  const size = match[2]
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bounces?\b/g, "oz")
    .replace(/\bpounds?\b/g, "lb")
    .replace(/\bgrams?\b/g, "g")
    .replace(/\bkilograms?\b/g, "kg")
    .replace(/\bmilliliters?\b/g, "ml")
    .replace(/\bliters?\b/g, "l")

  return `${packageUnit} (${size})`
}

/**
 * Normalize a unit string to its canonical lowercase form
 * Maps common variations (e.g., "TBSP", "tablespoon", "tablespoons") to canonical form (e.g., "tbsp")
 */
export function normalizeUnit(unit: string): string {
  if (!unit) return ""

  const normalized = unit.toLowerCase().trim().replace(/\s+/g, " ")
  const sizedPackageUnit = normalizeSizedPackageUnit(normalized)
  if (sizedPackageUnit) {
    return sizedPackageUnit
  }

  return SIMPLE_UNIT_MAP[normalized] ?? normalized
}

/**
 * Normalize an item name (lowercase, trimmed)
 */
export function normalizeItemName(item: string): string {
  let normalized = item
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s;:]+$/g, "")

  for (const [pattern, replacement] of ITEM_CANONICAL_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized.replace(/\s+/g, " ").trim()
}

function normalizeShoppingSyntax(item: string): string {
  return item
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s;:]+$/g, "")
}

/**
 * Separates the recipe ingredient form from the grocery purchase item.
 *
 * This intentionally covers only high-confidence whole-produce patterns. Measured
 * ingredients like "4 tbsp lemon juice" remain their own purchase item.
 */
export function normalizeShoppingPurchase(
  input: ShoppingPurchaseNormalizationInput
): ShoppingPurchaseNormalization {
  const canonical = canonicalizeShoppingIngredient({
    item: input.item,
    modifier: input.modifier,
  })
  const normalizedName = normalizeShoppingSyntax(input.item)
  const normalizedUnit = normalizeUnit(input.unit || "")
  const base = createBasePurchaseNormalization(input)

  const measuredCitrusName = normalizedName.match(/^(?:fresh\s+)?(lemon|lime)\s+(juice|zest)$/)
  if (measuredCitrusName) {
    const measured = normalizeMeasuredCitrus(
      input,
      measuredCitrusName[1],
      measuredCitrusName[2] === "juice" ? "juiced" : "zested",
      "measured citrus component"
    )
    if (measured) return measured
  }

  const leadingMeasuredCitrus = normalizedName.match(
    /^(\d+(?:\.\d+)?|\d+\/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z ]+?)\s+(?:fresh\s+)?(lemon|lime)\s+(juice|zest)$/
  )
  if (leadingMeasuredCitrus) {
    const measured = normalizeMeasuredCitrus(
      input,
      leadingMeasuredCitrus[3],
      leadingMeasuredCitrus[4] === "juice" ? "juiced" : "zested",
      "embedded measured citrus component",
      parseQuantityToken(leadingMeasuredCitrus[1]),
      leadingMeasuredCitrus[2]
    )
    if (measured) return measured
  }

  const juiceOfCitrus = normalizedName.match(
    /^juice (?:of|from) (?:(\d+(?:\.\d+)?|\d+\/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(limes?|lemons?)$/
  )
  if (juiceOfCitrus) {
    const purchaseName = CITRUS_PURCHASE_NAMES[juiceOfCitrus[2]]
    const parsedQuantity = juiceOfCitrus[1] ? parseQuantityToken(juiceOfCitrus[1]) : null
    return normalizeWholeProduce(input, purchaseName, {
      quantity: parsedQuantity ?? input.amount ?? null,
      prepIntent: "juiced",
      reason: "explicit citrus juice quantity",
    })
  }

  const zestOfCitrus = normalizedName.match(
    /^zest (?:of|from) (?:(\d+(?:\.\d+)?|\d+\/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+)?(?:one\s+)?(limes?|lemons?)$/
  )
  if (zestOfCitrus) {
    const purchaseName = CITRUS_PURCHASE_NAMES[zestOfCitrus[2]]
    const parsedQuantity = zestOfCitrus[1] ? parseQuantityToken(zestOfCitrus[1]) : null
    return normalizeWholeProduce(input, purchaseName, {
      quantity: parsedQuantity ?? input.amount ?? null,
      prepIntent: "zested",
      reason: "explicit citrus zest quantity",
    })
  }

  if (normalizedUnit && normalizedUnit !== "count") {
    return base
  }

  const leadingWholeProduce = normalizedName.match(
    /^(\d+(?:\.\d+)?|\d+\/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(limes?|lemons?|onions?)(?:,?\s+(juiced|zested|diced|chopped|minced|sliced|wedges|cut into wedges))?$/
  )
  if (leadingWholeProduce) {
    const purchaseName = WHOLE_PRODUCE_PURCHASE_NAMES[leadingWholeProduce[2]]
    return normalizeWholeProduce(input, purchaseName, {
      quantity: parseQuantityToken(leadingWholeProduce[1]),
      prepIntent: leadingWholeProduce[3]?.replace("cut into ", ""),
      reason: "explicit whole produce quantity",
    })
  }

  const trailingPrepProduce = normalizedName.match(
    /^(limes?|lemons?|onions?),?\s+(juiced|zested|diced|chopped|minced|sliced|wedges|cut into wedges)$/
  )
  if (trailingPrepProduce) {
    const purchaseName = WHOLE_PRODUCE_PURCHASE_NAMES[trailingPrepProduce[1]]
    return normalizeWholeProduce(input, purchaseName, {
      prepIntent: trailingPrepProduce[2].replace("cut into ", ""),
      reason: "whole produce with prep intent",
    })
  }

  const prepOnion = normalizedName.match(/^(diced|chopped|minced|sliced)\s+onions?$/)
  if (prepOnion) {
    return normalizeWholeProduce(input, "onion", {
      prepIntent: prepOnion[1],
      reason: "implicit whole onion prep",
    })
  }

  const wholeProduceName = WHOLE_PRODUCE_PURCHASE_NAMES[normalizedName]
  if (wholeProduceName) {
    return normalizeWholeProduce(input, wholeProduceName, {
      reason: "whole produce item",
    })
  }

  return base
}

export function createShoppingPurchaseKey(item: string, amount?: number | null, unit?: string | null): string {
  const normalized = normalizeShoppingPurchase({ item, amount, unit })
  return normalized.canonical.mergeKey
}

/**
 * Create a stable key for merging items (normalized item name + normalized unit)
 */
export function createItemKey(item: string, unit: string): string {
  return `${normalizeItemName(item)}|${normalizeUnit(unit)}`
}
