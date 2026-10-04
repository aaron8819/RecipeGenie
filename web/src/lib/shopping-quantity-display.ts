import type { ShoppingItem, ShoppingQuantity } from '@/types/database'
import { getIngredientDisplayUnit } from './ingredient-units'
import { toFraction } from './utils'
import { formatStructuredRecipeQuantity } from './recipe-quantity'
import { categorizeIngredient } from './shopping-categories'
import { addShoppingRationals, sumShoppingRequirements } from './shopping-extra-quantities'
import { pluralizeShoppingPurchaseName } from './shopping-ingredient-semantics'
import { normalizeUnit } from './shopping-list-normalization'

const SOURCE_QUANTITIES = 'See sources for quantities'

/** The existing high-confidence whole-produce default, display only.
 * One item per qualitative occurrence, stable at every selected yield.
 * Requirements and completion coverage continue to use the source wording.
 */
function isWholeItemEstimate(item: ShoppingItem, part: ShoppingQuantity): boolean {
  return ['onion', 'lemon', 'lime'].includes(item.orderingKey ?? item.item) &&
    ['', 'count'].includes(part.unit) && !part.exactPackageV1 &&
    part.amount == null && part.exactQuantityV1?.kind === 'qualitative' &&
    part.exactQuantityV1.authored.trim().toLowerCase() === 'as needed'
}

function purchaseParts(item: ShoppingItem): ShoppingQuantity[] {
  const parts = item.quantityParts ?? [item, ...(item.additionalAmounts ?? [])]
  return parts.some(part => isWholeItemEstimate(item, part))
    ? sumShoppingRequirements(parts.map(part => isWholeItemEstimate(item, part)
      ? { amount: 1, unit: 'count' } : part))
    : parts
}

export function shoppingPurchaseDisplayName(item: ShoppingItem): string {
  const parts = purchaseParts(item)
  const count = parts.find(part => ['', 'count'].includes(part.unit))?.amount
  const name = count && Math.abs(count) !== 1
    ? pluralizeShoppingPurchaseName(item.item) : item.item
  const estimated = (item.quantityParts ?? [item]).some(part => isWholeItemEstimate(item, part))
  const amount = formatShoppingPurchaseAmount(item)
  return estimated && amount && amount !== SOURCE_QUANTITIES ? `${name} (estimate)` : name
}

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

/** Sum only exact counts with the same captured package descriptor and size.
 * Unsized packages, ranges, qualifiers and unsupported arithmetic stay separate.
 * These display-only copies never change the captured source operands.
 */
function combinePurchasePackages(parts: ShoppingQuantity[]): ShoppingQuantity[] {
  const result: ShoppingQuantity[] = []
  const packages = new Map<string, number>()
  for (const part of parts) {
    const pack = part.exactPackageV1
    if (!pack || pack.count.kind !== 'exact' || pack.count.qualifier) {
      result.push(part)
      continue
    }
    const key = JSON.stringify([pack.type, pack.size.value, normalizeUnit(pack.size.unit)])
    const index = packages.get(key)
    if (index === undefined) {
      packages.set(key, result.length)
      result.push(part)
      continue
    }
    const previous = result[index].exactPackageV1!
    const count = previous.count
    const total = count.kind === 'exact' ? addShoppingRationals(count.value, pack.count.value) : null
    if (!total) {
      result.push(part)
      continue
    }
    const lexeme = total.denominator === '1' ? total.numerator : `${total.numerator}/${total.denominator}`
    const quantity = { ...count, kind: 'exact' as const, value: total,
      authored: lexeme, lexeme, source: 'legacy-synthesized' as const }
    result[index] = { ...result[index],
      amount: Number(total.numerator) / Number(total.denominator),
      exactQuantityV1: quantity, exactPackageV1: { ...previous, count: quantity } }
  }
  return result
}

/** Purchase-facing amounts only; never advertise a partial total. */
export function formatShoppingPurchaseAmount(item: ShoppingItem): string {
  const [category] = categorizeIngredient(item.item)
  const parts = purchaseParts(item)
  if (item.sources?.some(source => source.recipeId && source.originalAmount == null &&
    !isWholeItemEstimate(item, { amount: null, unit: source.originalUnit ?? '', exactQuantityV1: source.exactQuantityV1 }) &&
    !source.exactPackageV1 && (!source.exactQuantityV1 ||
      ['qualitative', 'unparsed'].includes(source.exactQuantityV1.kind)))) return ''
  // A partial total would imply the shopper has the complete purchase amount.
  if (parts.some(part => part.amount == null && !part.exactPackageV1 &&
    (!part.exactQuantityV1 || ['qualitative', 'unparsed'].includes(part.exactQuantityV1.kind)))) return ''
  const purchasableUnits = new Set([
    'bag', 'bags', 'box', 'boxes', 'bottle', 'bottles', 'bunch', 'bunches',
    'can', 'cans', 'clove', 'cloves', 'head', 'heads', 'jar', 'jars',
    'package', 'packages', 'stalk', 'stalks',
  ])
  const purchasable = parts.map(part => {
    // Structured package semantics outrank the author's unit word order.
    if (part.exactPackageV1) return true
    if (part.amount == null && (!part.exactQuantityV1 ||
      part.exactQuantityV1.kind === 'qualitative')) return false
    const unit = getIngredientDisplayUnit(part.exactAuthoredUnit ?? part.unit).toLowerCase()
    if (purchasableUnits.has(unit) || /^(?:bag|box|bottle|can|jar|package) \(/.test(unit)) return true
    if ((category === 'produce' || /^(?:large )?eggs?$/.test(item.item)) &&
      (!unit || unit === 'count')) return true
    return category === 'protein' && ['lb', 'lbs', 'pound', 'pounds'].includes(unit)
  })
  if (!purchasable.some(Boolean)) return ''
  const amounts = combinePurchasePackages(parts).map(formatShoppingQuantityPart)
  if (!amounts.every(Boolean)) return SOURCE_QUANTITIES
  if (!purchasable.every(Boolean) && (item.sources?.some(source => source.recipeId) ||
    item.requirementBreakdown?.some(part => part.source?.recipeId))) return SOURCE_QUANTITIES
  // Manual-only Dashboard rows have no Sources disclosure; keep all their amounts visible.
  return amounts.join(' + ')
}
