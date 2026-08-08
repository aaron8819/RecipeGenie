import type { IngredientKey } from './shopping-ingredient-resolution'
import { normalizeItemName } from './shopping-list-normalization'

export type CategoryKey = string

export type IngredientOrderByCategory = Record<CategoryKey, IngredientKey[]>

export interface ShoppingOrderingCategory {
  key: CategoryKey
  defaultOrder: number
  isCustom: boolean
}

export interface ShoppingOrderingRow {
  rowRef: string
  orderingKey: IngredientKey
  displayName: string
  categoryKey: CategoryKey
}

export type ShoppingDropPlacement = 'before' | 'after'

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** Unicode-code-point order; SQL migration 019 uses the matching C collation. */
function compareShoppingText(left: string, right: string): number {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0)!)
  const rightCodePoints = [...right].map((value) => value.codePointAt(0)!)
  const length = Math.min(leftCodePoints.length, rightCodePoints.length)
  for (let index = 0; index < length; index++) {
    if (leftCodePoints[index] !== rightCodePoints[index]) {
      return leftCodePoints[index] - rightCodePoints[index]
    }
  }
  return leftCodePoints.length - rightCodePoints.length
}

export function resolveShoppingCategoryOrder<T extends ShoppingOrderingCategory>(
  categories: readonly T[],
  preferredOrder: readonly CategoryKey[]
): T[] {
  const byKey = new Map(categories.map((category) => [category.key, category]))
  const preferred = uniqueStrings(preferredOrder).flatMap((key) => {
    const category = byKey.get(key)
    if (!category) return []
    byKey.delete(key)
    return [category]
  })
  const remaining = [...byKey.values()]
  const builtIn = remaining
    .filter((category) => !category.isCustom)
    .sort((left, right) =>
      left.defaultOrder - right.defaultOrder ||
        compareShoppingText(left.key, right.key))
  const custom = remaining
    .filter((category) => category.isCustom)
    .sort((left, right) =>
      left.defaultOrder - right.defaultOrder ||
        compareShoppingText(left.key, right.key))
  return [...preferred, ...builtIn, ...custom]
}

export function orderShoppingRows<T extends ShoppingOrderingRow>(
  rows: readonly T[],
  categories: readonly ShoppingOrderingCategory[],
  preferredCategoryOrder: readonly CategoryKey[],
  ingredientOrderByCategory: IngredientOrderByCategory
): T[] {
  const categoryRank = new Map(resolveShoppingCategoryOrder(
    categories,
    preferredCategoryOrder
  ).map((category, index) => [category.key, index]))
  const ingredientRank = new Map<string, Map<IngredientKey, number>>()
  for (const [categoryKey, sequence] of Object.entries(ingredientOrderByCategory)) {
    ingredientRank.set(
      categoryKey,
      new Map(sequence.map((key, index) => [key, index]))
    )
  }

  const fallbackByIdentity = new Map<string, {
    displayName: string
    rowRef: string
  }>()
  for (const row of rows) {
    const identity = `${row.categoryKey}\0${row.orderingKey}`
    const candidate = {
      displayName: normalizeItemName(row.displayName),
      rowRef: row.rowRef,
    }
    const current = fallbackByIdentity.get(identity)
    if (!current || compareShoppingText(
      candidate.displayName,
      current.displayName
    ) < 0 ||
        (candidate.displayName === current.displayName &&
          compareShoppingText(candidate.rowRef, current.rowRef) < 0)) {
      fallbackByIdentity.set(identity, candidate)
    }
  }

  return [...rows].sort((left, right) => {
    const leftCategoryRank = categoryRank.get(left.categoryKey) ?? Number.MAX_SAFE_INTEGER
    const rightCategoryRank = categoryRank.get(right.categoryKey) ?? Number.MAX_SAFE_INTEGER
    if (leftCategoryRank !== rightCategoryRank) {
      return leftCategoryRank - rightCategoryRank
    }
    if (left.categoryKey !== right.categoryKey) {
      return compareShoppingText(left.categoryKey, right.categoryKey)
    }

    const ranks = ingredientRank.get(left.categoryKey)
    const leftRank = ranks?.get(left.orderingKey)
    const rightRank = ranks?.get(right.orderingKey)
    if (leftRank !== undefined || rightRank !== undefined) {
      if (leftRank === undefined) return 1
      if (rightRank === undefined) return -1
      if (leftRank !== rightRank) return leftRank - rightRank
    }


    if (left.orderingKey !== right.orderingKey) {
      const leftFallback = fallbackByIdentity.get(
        `${left.categoryKey}\0${left.orderingKey}`
      )!
      const rightFallback = fallbackByIdentity.get(
        `${right.categoryKey}\0${right.orderingKey}`
      )!
      const fallbackComparison = compareShoppingText(
        leftFallback.displayName,
        rightFallback.displayName
      ) || compareShoppingText(left.orderingKey, right.orderingKey) ||
        compareShoppingText(leftFallback.rowRef, rightFallback.rowRef)
      if (fallbackComparison !== 0) return fallbackComparison
    }

    return compareShoppingText(
      normalizeItemName(left.displayName),
      normalizeItemName(right.displayName)
    ) || compareShoppingText(left.rowRef, right.rowRef)
  })
}

export function normalizeIngredientOrderByCategory(
  value: unknown
): IngredientOrderByCategory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const seen = new Set<IngredientKey>()
  const normalized: IngredientOrderByCategory = {}
  for (const [categoryKey, sequence] of Object.entries(value)) {
    if (!categoryKey || !Array.isArray(sequence)) continue
    const keys: IngredientKey[] = []
    for (const key of sequence) {
      if (typeof key !== 'string' || !key || seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }
    if (keys.length > 0) normalized[categoryKey] = keys
  }
  return normalized
}

function removeOrderingKey(
  preferences: IngredientOrderByCategory,
  orderingKey: IngredientKey
): IngredientOrderByCategory {
  const next: IngredientOrderByCategory = {}
  for (const [categoryKey, sequence] of Object.entries(preferences)) {
    const retained = sequence.filter((key) => key !== orderingKey)
    if (retained.length > 0) next[categoryKey] = retained
  }
  return next
}

function mergeVisibleSequence(
  existing: readonly IngredientKey[],
  visible: readonly IngredientKey[]
): IngredientKey[] {
  const visibleKeys = uniqueStrings(visible)
  if (visibleKeys.length === 0) return [...existing]

  const visibleSet = new Set(visibleKeys)
  const firstVisibleIndex = existing.findIndex((key) => visibleSet.has(key))
  const retained = existing.filter((key) => !visibleSet.has(key))
  const insertionIndex = firstVisibleIndex < 0
    ? retained.length
    : existing.slice(0, firstVisibleIndex)
      .filter((key) => !visibleSet.has(key)).length
  return [
    ...retained.slice(0, insertionIndex),
    ...visibleKeys,
    ...retained.slice(insertionIndex),
  ]
}

export function mergeVisibleIngredientOrder(
  existing: IngredientOrderByCategory,
  visibleOrderingKeysByCategory: IngredientOrderByCategory
): IngredientOrderByCategory {
  const next = normalizeIngredientOrderByCategory(existing)
  const assignedCategory = new Map<IngredientKey, CategoryKey>()
  for (const [categoryKey, sequence] of Object.entries(next)) {
    for (const key of sequence) assignedCategory.set(key, categoryKey)
  }

  const visibleOccurrences = new Map<IngredientKey, Set<CategoryKey>>()
  for (const [categoryKey, sequence] of Object.entries(
    visibleOrderingKeysByCategory
  )) {
    for (const key of uniqueStrings(sequence)) {
      const categories = visibleOccurrences.get(key) || new Set<CategoryKey>()
      categories.add(categoryKey)
      visibleOccurrences.set(key, categories)
    }
  }

  for (const [categoryKey, sequence] of Object.entries(
    visibleOrderingKeysByCategory
  )) {
    const visibleKeys = uniqueStrings(sequence).filter((key) => {
      const assigned = assignedCategory.get(key)
      if (assigned) return assigned === categoryKey
      return visibleOccurrences.get(key)?.size === 1
    })
    if (visibleKeys.length === 0) continue
    next[categoryKey] = mergeVisibleSequence(next[categoryKey] || [], visibleKeys)
    for (const key of visibleKeys) assignedCategory.set(key, categoryKey)
  }

  return normalizeIngredientOrderByCategory(next)
}

export function learnIngredientOrder({
  existing,
  visibleOrderingKeysByCategory,
  draggedOrderingKey,
  targetOrderingKey,
  targetCategoryKey,
  placement,
}: {
  existing: IngredientOrderByCategory
  visibleOrderingKeysByCategory: IngredientOrderByCategory
  draggedOrderingKey: IngredientKey
  targetOrderingKey: IngredientKey
  targetCategoryKey: CategoryKey
  placement: ShoppingDropPlacement
}): IngredientOrderByCategory {
  if (!draggedOrderingKey || !targetOrderingKey ||
      draggedOrderingKey === targetOrderingKey) {
    return normalizeIngredientOrderByCategory(existing)
  }

  let next = mergeVisibleIngredientOrder(existing, visibleOrderingKeysByCategory)

  next = removeOrderingKey(next, draggedOrderingKey)
  const targetSequence = [...(next[targetCategoryKey] || [])]
  let targetIndex = targetSequence.indexOf(targetOrderingKey)
  if (targetIndex < 0) {
    targetSequence.push(targetOrderingKey)
    targetIndex = targetSequence.length - 1
  }
  targetSequence.splice(
    placement === 'after' ? targetIndex + 1 : targetIndex,
    0,
    draggedOrderingKey
  )
  next[targetCategoryKey] = targetSequence
  return normalizeIngredientOrderByCategory(next)
}
