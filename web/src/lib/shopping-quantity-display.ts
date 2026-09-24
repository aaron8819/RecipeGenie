import type { ShoppingItem, ShoppingQuantity } from '@/types/database'
import { getIngredientDisplayUnit } from './ingredient-units'
import { toFraction } from './utils'
import { formatStructuredRecipeQuantity } from './recipe-quantity'
import { categorizeIngredient } from './shopping-categories'

const DISPLAY_UNIT_PLURALS: Record<string, string> = {
  piece: "pieces",
  clove: "cloves",
  slice: "slices",
  can: "cans",
  bunch: "bunches",
  head: "heads",
  stalk: "stalks",
  sprig: "sprigs",
  package: "packages",
  bag: "bags",
  box: "boxes",
  jar: "jars",
  bottle: "bottles",
}

function formatDisplayUnit(amount: number, unit: string): string {
  const trimmedUnit = getIngredientDisplayUnit(unit)
  if (!trimmedUnit) return ""

  const sizedPackageMatch = trimmedUnit.match(/^([a-z]+)\s+\((.+)\)$/)
  if (sizedPackageMatch) {
    const singularUnit = sizedPackageMatch[1]
    const packageSize = sizedPackageMatch[2]
    const displayUnit =
      Math.abs(amount) === 1 ? singularUnit : (DISPLAY_UNIT_PLURALS[singularUnit] ?? singularUnit)
    return `${displayUnit} (${packageSize})`
  }

  if (Math.abs(amount) === 1) {
    return trimmedUnit
  }

  return DISPLAY_UNIT_PLURALS[trimmedUnit] ?? trimmedUnit
}

export function formatAmountPart(amount: number | null | undefined, unit: string): string {
  if (amount == null) return ""

  const rangeAmount = formatEncodedRangeAmount(amount, unit)
  if (rangeAmount) return rangeAmount

  const displayAmount = toFraction(amount)
  const displayUnit = formatDisplayUnit(amount, unit)
  return `${displayAmount}${displayUnit ? ` ${displayUnit}` : ""}`
}

export function formatEncodedRangeAmount(
  amount: number | null | undefined,
  unit: string
): string | null {
  if (amount == null) return null

  const match = unit.trim().match(/^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)(?:\s+(.+))?$/)
  if (!match || Number(match[1]) !== amount) return null

  const displayUnit = getIngredientDisplayUnit(match[3] || "")
  return `${match[1]}–${match[2]}${displayUnit ? ` ${displayUnit}` : ""}`
}

export function formatAdditionalAmountParts(
  additionalAmounts: ShoppingItem["additionalAmounts"]
): string[] {
  if (!additionalAmounts || additionalAmounts.length === 0) return []

  return additionalAmounts
    .map((additional) => formatAmountPart(additional.amount, additional.unit))
    .filter(Boolean)
}

/** Render a single requirement without replacing available exact evidence. */
export function formatShoppingQuantityPart(part: ShoppingQuantity): string {
  const structured = formatStructuredRecipeQuantity(
    part.exactQuantityV1, part.exactAuthoredUnit ?? part.unit, part.exactPackageV1
  )
  if (structured) {
    // Recipe display may approximate awkward rational values. Shopping can
    // show their exact authored/scaled fraction instead of a rounded estimate.
    if (structured.approximate && part.exactQuantityV1?.kind === 'exact' && !part.exactPackageV1) {
      const { numerator, denominator } = part.exactQuantityV1.value
      const unit = getIngredientDisplayUnit(part.exactAuthoredUnit ?? part.unit)
      const qualifier = part.exactQuantityV1.qualifier
      return [qualifier, numerator + '/' + denominator, unit].filter(Boolean).join(' ')
    }
    if (structured.approximate && part.exactQuantityV1) {
      const quantity = part.exactQuantityV1.authored
      const pack = part.exactPackageV1
      return pack
        ? `${quantity} × ${pack.size.lexeme} ${pack.size.authoredUnit} ${pack.authoredType}`
        : [quantity, getIngredientDisplayUnit(part.exactAuthoredUnit ?? part.unit)].filter(Boolean).join(' ')
    }
    return structured.text
  }
  if (part.amount === null) {
    const unit = getIngredientDisplayUnit(part.unit)
    return unit ? 'amount unspecified (' + unit + ')' : 'amount unspecified'
  }
  return formatAmountPart(part.amount, part.unit)
}

export function formatShoppingItemAmount(item: ShoppingItem): string {
  if (item.quantityParts) {
    return item.quantityParts.map(formatShoppingQuantityPart).join(' + ')
  }
  // Historical normalized ShoppingItem callers still carry primary metadata
  // and numeric additions. Convert once; never append them to quantityParts.
  const primary = item.amount !== null || item.exactQuantityV1
    ? [formatShoppingQuantityPart(item)] : []
  return [...primary, ...formatAdditionalAmountParts(item.additionalAmounts)].join(' + ')
}

/** Purchase-facing amounts only; exact recipe requirements remain in View sources. */
export function formatShoppingPurchaseAmount(item: ShoppingItem): string {
  const [category] = categorizeIngredient(item.item)
  const parts: ShoppingQuantity[] = item.quantityParts ?? [item, ...(item.additionalAmounts ?? [])]
  if (item.sources?.some(source => source.recipeId && source.originalAmount == null &&
    !source.exactPackageV1 && (!source.exactQuantityV1 ||
      source.exactQuantityV1.kind === 'qualitative'))) return ''
  // A partial total would imply the shopper has the complete purchase amount.
  if (parts.some(part => part.amount == null && !part.exactPackageV1 &&
    (!part.exactQuantityV1 || part.exactQuantityV1.kind === 'qualitative'))) return ''
  const purchasableUnits = new Set([
    'bag', 'bags', 'box', 'boxes', 'bottle', 'bottles', 'bunch', 'bunches',
    'can', 'cans', 'clove', 'cloves', 'head', 'heads', 'jar', 'jars',
    'package', 'packages', 'stalk', 'stalks',
  ])
  return parts.filter(part => {
    if (part.amount == null && (!part.exactQuantityV1 ||
      part.exactQuantityV1.kind === 'qualitative')) return false
    const unit = getIngredientDisplayUnit(part.exactAuthoredUnit ?? part.unit).toLowerCase()
    if (purchasableUnits.has(unit) || /^(?:bag|box|bottle|can|jar|package) \(/.test(unit)) return true
    if ((category === 'produce' || /^(?:large )?eggs?$/.test(item.item)) &&
      (!unit || unit === 'count')) return true
    return category === 'protein' && ['lb', 'lbs', 'pound', 'pounds'].includes(unit)
  }).map(formatShoppingQuantityPart).join(' + ')
}
