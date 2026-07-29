import type { RationalV1, ShoppingItem, ShoppingList } from "@/types/database"
import { sortShoppingItemsByPreferences } from "./shopping-item-order"
import { mergeShoppingItems } from "./shopping-list-merging"
import { createShoppingPurchaseKey } from "./shopping-list-normalization"
import { ensureShoppingItemsHaveRowIds } from "./shopping-row-identity"

export const SHOPPING_NORMALIZATION_VERSION = 2

export type ShoppingContributionBucket = "items" | "already_have" | "excluded"

export type ShoppingContributionItem = ShoppingItem & {
  bucket: ShoppingContributionBucket
}

export type RecipeShoppingContribution = {
  recipeId: string
  recipeName: string
  servings: number
  scale: number
  scaleV1?: RationalV1
  normalizationVersion: number
  items: ShoppingContributionItem[]
}

export type ShoppingContributionOverride = {
  bucket?: ShoppingContributionBucket
  rowId?: string
  checked?: boolean
  displayName?: string
  categoryKey?: string
  categoryOrder?: number
  quantity?: {
    amount: number | null
    unit: string
    additionalAmounts?: { amount: number; unit: string }[]
  }
  deleted?: boolean
}

export type ShoppingContributionOverrides = Record<
  string,
  ShoppingContributionOverride
>

type ContributionAwareShoppingItem = ShoppingItem & {
  contributionKey?: string
  derivedQuantity?: {
    amount: number | null
    unit: string
    additionalAmounts?: { amount: number; unit: string }[]
  }
  legacyRecipeProvenance?: boolean
}

type ProjectShoppingContributionsInput = {
  currentList: ShoppingList
  previousContributions: RecipeShoppingContribution[]
  nextContributions: RecipeShoppingContribution[]
  existingOverrides?: ShoppingContributionOverrides | null
  replacingRecipeIds?: string[]
  clearAll?: boolean
  shoppingItemOrder?: Record<string, string[]> | null
}

export type ShoppingContributionProjection = {
  shoppingList: Pick<
    ShoppingList,
    | "items"
    | "already_have"
    | "excluded"
    | "source_recipes"
    | "scale"
    | "total_servings"
    | "custom_order"
  >
  overrides: ShoppingContributionOverrides
}

function canonicalizeStoredContributionKey(key: string): string {
  const categorySeparator = "|category:"
  const categoryIndex = key.indexOf(categorySeparator)
  if (categoryIndex < 0) {
    return createShoppingPurchaseKey(key)
  }

  const identity = key.slice(0, categoryIndex)
  const category = key.slice(categoryIndex + categorySeparator.length)
  return `${createShoppingPurchaseKey(identity)}${categorySeparator}${category}`
}

function contributionKey(item: ShoppingItem): string {
  const awareItem = item as ContributionAwareShoppingItem
  return awareItem.contributionKey
    ? canonicalizeStoredContributionKey(awareItem.contributionKey)
    : createShoppingPurchaseKey(item.item, item.amount, item.unit)
}

function findOverride(
  overrides: ShoppingContributionOverrides,
  key: string,
  item: ShoppingItem
): ShoppingContributionOverride | undefined {
  if (overrides[key]) return overrides[key]

  const exactCanonicalMatches = Object.entries(overrides).filter(
    ([candidateKey]) => canonicalizeStoredContributionKey(candidateKey) === key
  )
  if (exactCanonicalMatches.length === 1) return exactCanonicalMatches[0][1]
  if (exactCanonicalMatches.length > 1) return undefined

  const categorySeparator = "|category:"
  const categoryIndex = key.indexOf(categorySeparator)
  if (categoryIndex < 0) {
    const categoryMatches = Object.entries(overrides).filter(
      ([candidateKey, override]) => {
        const canonicalCandidate = canonicalizeStoredContributionKey(candidateKey)
        const candidateCategoryIndex = canonicalCandidate.indexOf(categorySeparator)
        return candidateCategoryIndex >= 0 &&
          canonicalCandidate.slice(0, candidateCategoryIndex) === key &&
          override.categoryKey === item.categoryKey
      }
    )
    return categoryMatches.length === 1 ? categoryMatches[0][1] : undefined
  }

  const baseKey = key.slice(0, categoryIndex)
  const categoryMatches = Object.entries(overrides).filter(
    ([candidateKey, override]) =>
      !canonicalizeStoredContributionKey(candidateKey).includes(categorySeparator) &&
      canonicalizeStoredContributionKey(candidateKey) === baseKey &&
      override.categoryKey === item.categoryKey
  )
  return categoryMatches.length === 1 ? categoryMatches[0][1] : undefined
}

function quantityOf(item: ShoppingItem) {
  return {
    amount: item.amount,
    unit: item.unit,
    additionalAmounts: item.additionalAmounts,
  }
}

function quantitiesEqual(left: ShoppingItem, right: ShoppingItem): boolean {
  return JSON.stringify(quantityOf(left)) === JSON.stringify(quantityOf(right))
}

function aggregateContributions(
  contributions: RecipeShoppingContribution[]
): ContributionAwareShoppingItem[] {
  let aggregate: ShoppingItem[] = []

  for (const contribution of [...contributions].sort((a, b) =>
    a.recipeId.localeCompare(b.recipeId)
  )) {
    // Version-1 snapshots stay frozen in storage. The current pure merger
    // upgrades their purchase identity only for this in-memory projection.
    aggregate = mergeShoppingItems(
      aggregate,
      contribution.items.map(({ bucket: _bucket, ...item }) => item),
      { preserveCustomOrder: false }
    )
  }

  const baseKeyCounts = new Map<string, number>()
  for (const item of aggregate) {
    const key = createShoppingPurchaseKey(item.item, item.amount, item.unit)
    baseKeyCounts.set(key, (baseKeyCounts.get(key) || 0) + 1)
  }

  return aggregate.map((item) => {
    const baseKey = createShoppingPurchaseKey(item.item, item.amount, item.unit)
    const key = (baseKeyCounts.get(baseKey) || 0) > 1
      ? `${baseKey}|category:${item.categoryKey}`
      : baseKey
    return {
      ...item,
      rowId: item.rowId || `derived:${key}`,
      contributionKey: key,
      derivedQuantity: quantityOf(item),
    }
  })
}

function allBuckets(list: ShoppingList) {
  return (["items", "already_have", "excluded"] as const).flatMap((bucket) =>
    (list[bucket] || []).map((item) => ({ bucket, item }))
  )
}

function hasContributionSource(
  item: ShoppingItem,
  contributionRecipeIds: Set<string>
): boolean {
  return Boolean(
    item.sources?.some(
      (source) => source.recipeId && contributionRecipeIds.has(source.recipeId)
    )
  )
}

function isConfidentLegacyReplacement(
  item: ShoppingItem,
  replacingRecipeIds: Set<string>
): boolean {
  const sources = item.sources || []
  return (
    sources.length > 0 &&
    sources.every(
      (source) => source.recipeId && replacingRecipeIds.has(source.recipeId)
    )
  )
}

function captureOverrides(
  currentList: ShoppingList,
  previousDerived: ContributionAwareShoppingItem[],
  existingOverrides: ShoppingContributionOverrides
): ShoppingContributionOverrides {
  const overrides = { ...existingOverrides }
  const previousRecipeIds = new Set(
    previousDerived.flatMap((item) =>
      (item.sources || []).flatMap((source) =>
        source.recipeId ? [source.recipeId] : []
      )
    )
  )
  const current = allBuckets(currentList)

  for (const derived of previousDerived) {
    const key = contributionKey(derived)
    const categorySeparator = "|category:"
    const categoryIndex = key.indexOf(categorySeparator)
    const baseKey = categoryIndex < 0 ? key : key.slice(0, categoryIndex)
    const contributionRows = current.filter(
      ({ item }) =>
        hasContributionSource(item, previousRecipeIds) ||
        Boolean((item as ContributionAwareShoppingItem).contributionKey)
    )
    const currentMatch = contributionRows.find(({ item }) => {
      const currentKey = contributionKey(item)
      if (currentKey === key) return true
      return categoryIndex >= 0 &&
        currentKey === baseKey &&
        item.categoryKey === derived.categoryKey
    })

    if (!currentMatch) {
      // Version-1 projection could collapse category-conflicted contributions
      // into one unsuffixed row. Its absence cannot prove that the other
      // category-specific v2 row was explicitly deleted.
      const hasLegacyBaseRow = categoryIndex >= 0 && contributionRows.some(
        ({ item }) => contributionKey(item) === baseKey
      )
      if (hasLegacyBaseRow) continue
      overrides[key] = { ...overrides[key], deleted: true }
      continue
    }

    const { item, bucket } = currentMatch
    const nextOverride: ShoppingContributionOverride = {
      ...overrides[key],
      bucket,
      rowId: item.rowId,
      checked: item.checked,
      displayName: item.item,
      categoryKey: item.categoryKey,
      categoryOrder: item.categoryOrder,
      deleted: false,
    }

    if (!quantitiesEqual(item, derived)) {
      nextOverride.quantity = quantityOf(item)
    }

    overrides[key] = nextOverride
  }

  return overrides
}

function applyOverride(
  item: ContributionAwareShoppingItem,
  override: ShoppingContributionOverride | undefined
): ContributionAwareShoppingItem | null {
  if (override?.deleted) return null

  return {
    ...item,
    rowId: override?.rowId || item.rowId,
    item: override?.displayName || item.item,
    categoryKey: override?.categoryKey || item.categoryKey,
    categoryOrder: override?.categoryOrder ?? item.categoryOrder,
    checked: override?.checked ?? item.checked,
    ...(override?.quantity || {}),
  }
}

function sortProjectionItems(
  items: ShoppingItem[],
  currentList: ShoppingList,
  shoppingItemOrder?: Record<string, string[]> | null
): ShoppingItem[] {
  if (!currentList.custom_order) {
    return sortShoppingItemsByPreferences(items, shoppingItemOrder)
  }

  const currentOrder = new Map(
    currentList.items.map((item, index) => [contributionKey(item), index])
  )

  return [...items].sort((left, right) => {
    const leftOrder = currentOrder.get(contributionKey(left))
    const rightOrder = currentOrder.get(contributionKey(right))
    if (leftOrder !== undefined || rightOrder !== undefined) {
      return (leftOrder ?? Number.MAX_SAFE_INTEGER) -
        (rightOrder ?? Number.MAX_SAFE_INTEGER)
    }
    if (left.categoryOrder !== right.categoryOrder) {
      return left.categoryOrder - right.categoryOrder
    }
    return left.item.localeCompare(right.item)
  })
}

export function projectShoppingContributions({
  currentList,
  previousContributions,
  nextContributions,
  existingOverrides = {},
  replacingRecipeIds = [],
  clearAll = false,
  shoppingItemOrder,
}: ProjectShoppingContributionsInput): ShoppingContributionProjection {
  const previousDerived = aggregateContributions(previousContributions)
  const nextDerived = aggregateContributions(nextContributions)
  const previousRecipeIds = new Set(
    previousContributions.map((contribution) => contribution.recipeId)
  )
  const replacingIds = new Set(replacingRecipeIds)
  const overrides = clearAll
    ? {}
    : captureOverrides(currentList, previousDerived, existingOverrides || {})

  const manualByBucket: Record<ShoppingContributionBucket, ShoppingItem[]> = {
    items: [],
    already_have: [],
    excluded: [],
  }

  if (!clearAll) {
    for (const { bucket, item } of allBuckets(currentList)) {
      if (hasContributionSource(item, previousRecipeIds)) continue
      if (isConfidentLegacyReplacement(item, replacingIds)) continue

      const legacyRecipeProvenance = Boolean(
        item.sources?.some((source) => source.recipeId)
      )
      manualByBucket[bucket].push({
        ...item,
        ...(legacyRecipeProvenance ? { legacyRecipeProvenance: true } : {}),
      })
    }
  }

  const projectedByBucket: Record<ShoppingContributionBucket, ShoppingItem[]> = {
    items: [...manualByBucket.items],
    already_have: [...manualByBucket.already_have],
    excluded: [...manualByBucket.excluded],
  }

  for (const derived of nextDerived) {
    const key = contributionKey(derived)
    const override = findOverride(overrides, key, derived)
    const projected = applyOverride(derived, override)
    if (!projected) continue

    const defaultBucket = [...nextContributions]
      .sort((left, right) => left.recipeId.localeCompare(right.recipeId))
      .flatMap((contribution) => contribution.items)
      .find((item) => {
        const candidateKey = contributionKey(item)
        const baseKey = key.split("|category:")[0]
        return candidateKey === key ||
          (candidateKey === baseKey && item.categoryKey === derived.categoryKey)
      })?.bucket || "items"
    projectedByBucket[override?.bucket || defaultBucket].push(projected)
  }

  const items = ensureShoppingItemsHaveRowIds(
    sortProjectionItems(
      projectedByBucket.items,
      currentList,
      shoppingItemOrder
    )
  ).items
  const alreadyHave = ensureShoppingItemsHaveRowIds(
    projectedByBucket.already_have
  ).items
  const excluded = ensureShoppingItemsHaveRowIds(projectedByBucket.excluded).items
  const sourceRecipes = [...nextContributions]
    .map((contribution) => contribution.recipeId)
    .sort()

  return {
    shoppingList: {
      items,
      already_have: alreadyHave,
      excluded,
      source_recipes: sourceRecipes,
      scale:
        nextContributions.length === 1 ? nextContributions[0].scale : 1,
      total_servings: nextContributions.reduce(
        (total, contribution) => total + contribution.servings,
        0
      ),
      custom_order: Boolean(currentList.custom_order),
    },
    overrides,
  }
}
