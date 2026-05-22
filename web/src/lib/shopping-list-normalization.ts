/**
 * Unit normalization utilities for shopping list
 * Ensures consistent unit representation across the system
 */

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

const ITEM_CANONICAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bextra[\s-]+virgin olive oil\b/g, "olive oil"],
  [/\bevoo\b/g, "olive oil"],
  [/\byellow onions?\b/g, "onion"],
  [/\bwhite onions?\b/g, "onion"],
  [/\bonions\b/g, "onion"],
  [/\bgarlic cloves?\b/g, "garlic"],
]

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

/**
 * Create a stable key for merging items (normalized item name + normalized unit)
 */
export function createItemKey(item: string, unit: string): string {
  return `${normalizeItemName(item)}|${normalizeUnit(unit)}`
}
