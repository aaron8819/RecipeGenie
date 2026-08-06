import type {
  CustomShoppingCategory,
  PantryItem,
  RationalV1,
  ShoppingItem,
  ShoppingList,
} from "@/types/database"
import {
  matchIngredientExclusionFamily,
} from "./ingredient-exclusion-families"
import {
  normalizeScaleRatioV1,
  parseRationalLexeme,
  scaleQuantityV1,
} from "./recipe-quantity"
import type { RecipeShoppingContribution } from "./shopping-contributions"
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
  validateShoppingDocumentV1,
  type RowRef,
  type ShoppingBucket,
  type ShoppingDocumentStateV1,
  type ShoppingItemOverrideV1,
  type ShoppingManualItemV1,
  type ShoppingRecipeIngredientV1,
} from "./shopping-document"
import {
  createShoppingAggregateDiscriminator,
  createShoppingAggregateKey,
  type AggregateKey,
  type ShoppingQuantity,
} from "./shopping-ingredient-resolution"
import { createShoppingPurchaseKey } from "./shopping-list-normalization"

export type CurrentShoppingPreferencesV1 = {
  categoryOverrides?: Record<string, string> | null
  customCategories?: CustomShoppingCategory[] | null
  categoryOrder?: string[] | null
  excludedKeywords?: string[] | null
  excludeSaltVariants?: boolean | null
  excludeBlackPepperVariants?: boolean | null
}

export type ConvertShoppingPersistenceV1Input = {
  currentList: ShoppingList
  contributions: RecipeShoppingContribution[]
  preferences?: CurrentShoppingPreferencesV1
  contentRevision?: number
  pantryItems?: PantryItem[]
}

export type ShoppingConversionIssue = {
  code: "malformed" | "ambiguous-row" | "identity-collision"
  path: string
  message: string
}

export type ShoppingConversionResult =
  | { ok: true; state: ShoppingDocumentStateV1 }
  | { ok: false; issues: ShoppingConversionIssue[] }

function quantityOf(item: ShoppingItem): ShoppingQuantity | null {
  if (item.amount == null && !item.exactQuantityV1 && !item.exactPackageV1)
    return null
  return {
    amount: item.amount,
    unit: item.unit || "",
    exactQuantityV1: item.exactQuantityV1,
    exactPackageV1: item.exactPackageV1,
    exactAuthoredUnit: item.exactAuthoredUnit,
  }
}

function aggregateKeyFor(
  item: ShoppingItem,
  recipeId?: string,
  identityQuantity = item.exactQuantityV1
): AggregateKey {
  const ingredientKey = createShoppingPurchaseKey(item.item, item.amount, item.unit)
  const discriminator = item.structuredSourceKey
    ? createShoppingAggregateDiscriminator(
        recipeId,
        identityQuantity || null,
        item.exactPackageV1,
        item.unit
      ) || ["unresolved-structured", recipeId || "unknown-recipe"]
    : null
  return createShoppingAggregateKey(ingredientKey, discriminator)
}

function ingredientFromContributionItem(
  item: ShoppingItem,
  recipeId: string,
  scaleV1: RationalV1
): ShoppingRecipeIngredientV1 {
  const ingredientKey = createShoppingPurchaseKey(item.item, item.amount, item.unit)
  const exclusionFamily = matchIngredientExclusionFamily({
    item: item.item,
    amount: item.amount,
    unit: item.unit,
  })
  const unscaledQuantity = item.exactQuantityV1
    ? scaleQuantityV1(item.exactQuantityV1, {
        numerator: scaleV1.denominator,
        denominator: scaleV1.numerator,
      }) || item.exactQuantityV1
    : undefined
  return {
    ingredientKey,
    aggregateKey: aggregateKeyFor(item, recipeId, unscaledQuantity),
    displayName: item.item,
    quantity: quantityOf(item),
    purchaseUnit: item.unit || "",
    defaultCategoryKey: item.categoryKey,
    pantryMatchKeys: [ingredientKey],
    exclusionFamily: exclusionFamily || undefined,
  }
}

function currentRows(list: ShoppingList): Array<{
  bucket: ShoppingBucket
  item: ShoppingItem
  index: number
}> {
  return ([
    ["items", list.items],
    ["already_have", list.already_have],
    ["excluded", list.excluded],
  ] as const).flatMap(([bucket, items]) =>
    items.map((item, index) => ({ bucket, item, index })))
}

function sameQuantity(left: ShoppingQuantity | null, right: ShoppingQuantity | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function manualId(item: ShoppingItem, bucket: ShoppingBucket, index: number): string {
  return item.rowId || `converted-${bucket}-${index}-${encodeURIComponent(
    createShoppingPurchaseKey(item.item, item.amount, item.unit)
  )}`
}

function legacyContributionKeys(item: ShoppingItem): string[] {
  const identity = createShoppingPurchaseKey(item.item, item.amount, item.unit)
  return [
    identity,
    `${identity}|category:${item.categoryKey}`,
    ...(item.structuredSourceKey ? [`structured:${item.structuredSourceKey}`] : []),
    ...(item.contributionKey ? [item.contributionKey] : []),
  ]
}

/**
 * Temporary PR-1 migration helper. It reconstructs intent and fails closed;
 * it never copies rendered buckets wholesale into the canonical document.
 */
export function convertShoppingPersistenceV1(
  input: ConvertShoppingPersistenceV1Input
): ShoppingConversionResult {
  const issues: ShoppingConversionIssue[] = []
  const { currentList, contributions } = input
  if (!currentList || !Array.isArray(currentList.items) ||
      !Array.isArray(currentList.already_have) || !Array.isArray(currentList.excluded) ||
      !Array.isArray(contributions)) {
    return { ok: false, issues: [{
      code: "malformed",
      path: "$",
      message: "Current Shopping buckets and contributions must be arrays",
    }] }
  }
  const revision = input.contentRevision ?? currentList.contribution_revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, issues: [{
      code: "malformed",
      path: "contentRevision",
      message: "Current revision must be a non-negative safe integer",
    }] }
  }

  const document = createEmptyShoppingDocument()
  const recipeIds = new Set<string>()
  const aggregateKeysByLegacyKey = new Map<string, Set<AggregateKey>>()
  for (const [index, contribution] of contributions.entries()) {
    if (!contribution || typeof contribution.recipeId !== "string" ||
        !contribution.recipeId || !Array.isArray(contribution.items) ||
        recipeIds.has(contribution.recipeId)) {
      issues.push({
        code: "malformed",
        path: `contributions.${index}`,
        message: "Contribution must have one unique recipeId and an item array",
      })
      continue
    }
    recipeIds.add(contribution.recipeId)
    const scaleV1: RationalV1 | null =
      normalizeScaleRatioV1(contribution.scaleV1) ||
      normalizeScaleRatioV1(parseRationalLexeme(String(contribution.scale)))
    if (!scaleV1 || !Number.isFinite(contribution.servings) || contribution.servings <= 0) {
      issues.push({
        code: "malformed",
        path: `contributions.${index}`,
        message: "Contribution scale and servings must be valid",
      })
      continue
    }
    const ingredients = contribution.items.map((item) =>
      ingredientFromContributionItem(item, contribution.recipeId, scaleV1))
    contribution.items.forEach((item, itemIndex) => {
      const aggregateKey = ingredients[itemIndex].aggregateKey
      for (const legacyKey of legacyContributionKeys(item)) {
        const matches = aggregateKeysByLegacyKey.get(legacyKey) || new Set()
        matches.add(aggregateKey)
        aggregateKeysByLegacyKey.set(legacyKey, matches)
      }
    })
    const keyCounts = new Map<string, number>()
    for (const ingredient of ingredients)
      keyCounts.set(ingredient.aggregateKey, (keyCounts.get(ingredient.aggregateKey) || 0) + 1)
    for (const [key, count] of keyCounts) {
      if (count > 1) issues.push({
        code: "identity-collision",
        path: `contributions.${index}.items`,
        message: `Multiple frozen rows map to aggregate key ${key}`,
      })
    }
    document.recipeEntries[contribution.recipeId] = {
      recipeId: contribution.recipeId,
      recipeName: contribution.recipeName,
      selectedServings: contribution.servings,
      scaleV1,
      ingredients,
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  const preferences = input.preferences
  document.preferences.customCategories = [...(preferences?.customCategories || [])]
  document.preferences.categoryOrder = [...(preferences?.categoryOrder || [])]
  document.preferences.excludeSaltVariants = preferences?.excludeSaltVariants ?? false
  document.preferences.excludeBlackPepperVariants = preferences?.excludeBlackPepperVariants ?? false
  document.preferences.excludedIngredientKeys = (preferences?.excludedKeywords || [])
    .map((keyword) => createShoppingPurchaseKey(keyword))
  for (const [key, category] of Object.entries(preferences?.categoryOverrides || {}))
    document.preferences.categoryByIngredient[createShoppingPurchaseKey(key)] = category

  const baseProjection = projectShoppingDocument(document, input.pantryItems || [])
  const baseByKey = new Map(baseProjection.rows.flatMap((row) =>
    row.aggregateKey ? [[row.aggregateKey, row] as const] : []))
  const seenDerived = new Set<string>()
  const manualItems: ShoppingManualItemV1[] = []
  const order: RowRef[] = []

  for (const { bucket, item, index } of currentRows(currentList)) {
    if (!item || typeof item.item !== "string" || typeof item.categoryKey !== "string") {
      issues.push({ code: "malformed", path: `${bucket}.${index}`, message: "Malformed rendered row" })
      continue
    }
    const sourceIds = new Set((item.sources || []).flatMap((source) =>
      source.recipeId ? [source.recipeId] : []))
    const activeIds = [...sourceIds].filter((id) => recipeIds.has(id))
    const unknownRecipeSource = (item.sources || []).some((source) =>
      source.recipeId && !recipeIds.has(source.recipeId))
    if (activeIds.length > 0 && (unknownRecipeSource || activeIds.length !== sourceIds.size)) {
      issues.push({
        code: "ambiguous-row",
        path: `${bucket}.${index}`,
        message: "Row mixes active contribution and unknown recipe provenance",
      })
      continue
    }

    if (activeIds.length === 0) {
      const hasNonManualProvenance = (item.sources || []).some((source) =>
        source.recipeId || (source.recipeName && source.recipeName !== "Manual"))
      if (hasNonManualProvenance) {
        issues.push({
          code: "ambiguous-row",
          path: `${bucket}.${index}`,
          message: "Legacy recipe row cannot be deterministically assigned",
        })
        continue
      }
      const id = manualId(item, bucket, index)
      if (manualItems.some((manual) => manual.id === id)) {
        issues.push({ code: "identity-collision", path: `${bucket}.${index}`, message: `Duplicate manual id ${id}` })
        continue
      }
      manualItems.push({
        id,
        displayName: item.item,
        quantity: quantityOf(item),
        categoryKey: item.categoryKey,
        bucket,
        checked: item.checked || false,
      })
      order.push(`manual:${id}`)
      continue
    }

    const candidateKeys = new Set([
      ...activeIds.map((recipeId) => aggregateKeyFor(item, recipeId)),
      ...legacyContributionKeys(item).flatMap((legacyKey) =>
        [...(aggregateKeysByLegacyKey.get(legacyKey) || [])]),
    ])
    let matchingKeys = [...candidateKeys].filter((key) => baseByKey.has(key))
    if (matchingKeys.length !== 1) {
      const sourceKeySets = activeIds.map((recipeId) =>
        new Set(document.recipeEntries[recipeId].ingredients.map((ingredient) =>
          ingredient.aggregateKey)))
      matchingKeys = sourceKeySets.length === 0
        ? []
        : [...sourceKeySets[0]].filter((key) =>
            sourceKeySets.every((keys) => keys.has(key)))
    }
    if (matchingKeys.length !== 1) {
      issues.push({
        code: "ambiguous-row",
        path: `${bucket}.${index}`,
        message: "Rendered contribution row does not map to exactly one target aggregate",
      })
      continue
    }
    const key = matchingKeys[0]
    if (seenDerived.has(key)) {
      issues.push({ code: "identity-collision", path: `${bucket}.${index}`, message: `Multiple rows map to ${key}` })
      continue
    }
    seenDerived.add(key)
    const base = baseByKey.get(key)!
    const override: ShoppingItemOverrideV1 = {}
    if (item.item !== base.displayName) override.displayName = item.item
    if (!sameQuantity(quantityOf(item), base.quantity)) override.quantity = quantityOf(item)
    if (item.categoryKey !== base.categoryKey) override.categoryKey = item.categoryKey
    if (bucket !== base.bucket) override.bucket = bucket
    if (item.checked) override.checked = true
    if (Object.keys(override).length > 0) document.itemOverrides[key] = override
    order.push(`derived:${key}`)
  }

  for (const key of baseByKey.keys()) {
    if (!seenDerived.has(key)) document.itemOverrides[key] = { suppressed: true }
  }
  document.manualItems = manualItems
  document.order = order

  if (issues.length > 0) return { ok: false, issues }
  const validation = validateShoppingDocumentV1(document)
  if (!validation.ok) {
    return {
      ok: false,
      issues: validation.issues.map((issue) => ({
        code: "malformed",
        path: issue.path,
        message: issue.message,
      })),
    }
  }
  return { ok: true, state: { document: validation.document, contentRevision: revision } }
}
