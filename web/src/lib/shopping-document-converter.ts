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
  rationalToNumber,
  scaleQuantityV1,
} from "./recipe-quantity"
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
  validateShoppingDocumentV1,
  type RowRef,
  type ShoppingBucket,
  type ShoppingDocumentStateV1,
  type ShoppingItemOverrideV1,
  type ShoppingManualItemV1,
  type ProjectedShoppingRow,
  type ShoppingRecipeIngredientV1,
} from "./shopping-document"
import {
  createShoppingAggregateDiscriminator,
  createShoppingAggregateKey,
  type AggregateKey,
  type ShoppingQuantity,
} from "./shopping-ingredient-resolution"
import {
  createShoppingPurchaseKey,
  normalizeUnit,
} from "./shopping-list-normalization"

export type CurrentShoppingPreferencesV1 = {
  categoryOverrides?: Record<string, string> | null
  customCategories?: CustomShoppingCategory[] | null
  categoryOrder?: string[] | null
  excludedKeywords?: string[] | null
  excludeSaltVariants?: boolean | null
  excludeBlackPepperVariants?: boolean | null
}

export type RecipeShoppingContribution = {
  recipeId: string
  recipeName: string
  servings: number
  scale: number
  scaleV1?: RationalV1
  normalizationVersion: number
  items: Array<ShoppingItem & { bucket: ShoppingBucket }>
}

export type LegacyShoppingListV1 = ShoppingList & {
  contribution_revision?: number
  legacy_items_preserved?: boolean
}

export type ConvertShoppingPersistenceV1Input = {
  currentList: LegacyShoppingListV1
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isFiniteAmount(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function isCurrentItem(value: unknown, requireBucket = false): value is ShoppingItem & {
  bucket?: ShoppingBucket
} {
  if (!isRecord(value) || typeof value.item !== "string" || !value.item.trim() ||
      !isFiniteAmount(value.amount) || typeof value.unit !== "string" ||
      typeof value.categoryKey !== "string" || !value.categoryKey.trim() ||
      typeof value.categoryOrder !== "number" || !Number.isFinite(value.categoryOrder) ||
      (value.rowId !== undefined &&
        (typeof value.rowId !== "string" || !value.rowId.trim())) ||
      (value.checked !== undefined && typeof value.checked !== "boolean")) {
    return false
  }
  if (requireBucket &&
      value.bucket !== "items" && value.bucket !== "already_have" &&
      value.bucket !== "excluded") return false
  if (value.additionalAmounts !== undefined &&
      (!Array.isArray(value.additionalAmounts) ||
        !value.additionalAmounts.every((amount) => isRecord(amount) &&
          isFiniteAmount(amount.amount) && amount.amount !== null &&
          typeof amount.unit === "string"))) return false
  return value.sources === undefined ||
    (Array.isArray(value.sources) && value.sources.every((source) =>
      isRecord(source) && typeof source.recipeName === "string" &&
      (source.recipeId === undefined || typeof source.recipeId === "string") &&
      (source.originalItem === undefined || typeof source.originalItem === "string")))
}

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

function additionalQuantitiesOf(item: ShoppingItem): ShoppingQuantity[] {
  return (item.additionalAmounts || []).map((quantity) => ({
    amount: quantity.amount,
    unit: normalizeUnit(quantity.unit),
  }))
}

function pantryMatchKeys(item: ShoppingItem, ingredientKey: string): string[] {
  const alternativeMatch = item.item.match(/\s+\(or\s+(.+)\)$/i)
  const alternatives = alternativeMatch
    ? alternativeMatch[1].split(",").map((value) => createShoppingPurchaseKey(value))
    : []
  return [...new Set([ingredientKey, ...alternatives])]
}

function ingredientKeyOf(item: ShoppingItem): string {
  const alternativeMatch = item.item.match(/^(.+?)\s+\(or\s+.+\)$/i)
  return createShoppingPurchaseKey(
    alternativeMatch ? alternativeMatch[1] : item.item,
    item.amount,
    item.unit
  )
}

function citrusPrepOf(
  item: ShoppingItem,
  ingredientKey: string
): "juiced" | "zested" | undefined {
  if ((ingredientKey !== "lemon" && ingredientKey !== "lime") ||
      normalizeUnit(item.unit) !== "count") return undefined
  const intents = (item.sources || [])
    .map((source) => source.prepIntent)
    .filter((intent): intent is "juiced" | "zested" =>
      intent === "juiced" || intent === "zested")
  return intents.length > 0 && intents.every((intent) => intent === intents[0])
    ? intents[0]
    : undefined
}

function exclusionFamilyOf(item: ShoppingItem) {
  if (/\s+\(or\s+.+\)$/i.test(item.item)) return null
  const sourceFamilies = (item.sources || []).flatMap((source) =>
    source.originalItem
      ? [matchIngredientExclusionFamily({
          item: source.originalItem,
          amount: source.originalAmount ?? null,
          unit: source.originalUnit || item.unit,
          modifier: source.prepIntent,
        })]
      : [])
  if (sourceFamilies.length > 0) {
    const family = sourceFamilies[0]
    return family && sourceFamilies.every((candidate) => candidate === family)
      ? family
      : null
  }
  return matchIngredientExclusionFamily({
    item: item.item,
    amount: item.amount,
    unit: item.unit,
  })
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
): ShoppingRecipeIngredientV1[] {
  const ingredientKey = ingredientKeyOf(item)
  const exclusionFamily = exclusionFamilyOf(item)
  const unscaledQuantity = item.exactQuantityV1
    ? scaleQuantityV1(item.exactQuantityV1, {
        numerator: scaleV1.denominator,
        denominator: scaleV1.numerator,
      }) || undefined
    : undefined
  const ingredient: ShoppingRecipeIngredientV1 = {
    ingredientKey,
    aggregateKey: createShoppingAggregateKey(
      ingredientKey,
      item.structuredSourceKey
        ? createShoppingAggregateDiscriminator(
            recipeId,
            unscaledQuantity || null,
            item.exactPackageV1,
            item.unit
          ) || ["unresolved-structured", recipeId]
        : null
    ),
    displayName: item.item,
    quantity: quantityOf(item),
    purchaseUnit: item.unit || "",
    defaultCategoryKey: item.categoryKey,
    pantryMatchKeys: pantryMatchKeys(item, ingredientKey),
    exclusionFamily: exclusionFamily || undefined,
    citrusPrep: citrusPrepOf(item, ingredientKey),
  }
  return [
    ingredient,
    ...additionalQuantitiesOf(item).map((quantity) => ({
      ...ingredient,
      quantity,
      purchaseUnit: quantity.unit,
    })),
  ]
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

function sameQuantity(item: ShoppingItem, projected: ProjectedShoppingRow): boolean {
  return JSON.stringify({
    quantity: quantityOf(item),
    additionalQuantities: additionalQuantitiesOf(item),
  }) === JSON.stringify({
    quantity: projected.quantity,
    additionalQuantities: projected.additionalQuantities || [],
  })
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
    if (!isRecord(contribution) || typeof contribution.recipeId !== "string" ||
        !contribution.recipeId || typeof contribution.recipeName !== "string" ||
        !contribution.recipeName.trim() || !Array.isArray(contribution.items) ||
        (contribution.normalizationVersion !== 1 &&
          contribution.normalizationVersion !== 2) ||
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
    const exactScale = scaleV1 ? rationalToNumber(scaleV1) : null
    if (!scaleV1 || typeof contribution.scale !== "number" ||
        !Number.isFinite(contribution.scale) || contribution.scale <= 0 ||
        exactScale === null || Math.abs(exactScale - contribution.scale) > 0.000001 ||
        !Number.isFinite(contribution.servings) || contribution.servings <= 0) {
      issues.push({
        code: "malformed",
        path: `contributions.${index}`,
        message: "Contribution scale and servings must be valid",
      })
      continue
    }
    const invalidItemIndex = contribution.items.findIndex((item) =>
      !isCurrentItem(item, true))
    if (invalidItemIndex >= 0) {
      issues.push({
        code: "malformed",
        path: `contributions.${index}.items.${invalidItemIndex}`,
        message: "Malformed frozen contribution row",
      })
      continue
    }
    const unscalableItemIndex = contribution.items.findIndex((item) => {
      if (!item.exactQuantityV1) return false
      return !scaleQuantityV1(item.exactQuantityV1, {
        numerator: scaleV1.denominator,
        denominator: scaleV1.numerator,
      })
    })
    if (unscalableItemIndex >= 0) {
      issues.push({
        code: "malformed",
        path: `contributions.${index}.items.${unscalableItemIndex}.exactQuantityV1`,
        message: "Frozen exact quantity cannot be restored to its source scale",
      })
      continue
    }
    const ingredientGroups = contribution.items.map((item) =>
      ingredientFromContributionItem(item, contribution.recipeId, scaleV1))
    const ingredients = ingredientGroups.flat()
    contribution.items.forEach((item, itemIndex) => {
      const aggregateKey = ingredientGroups[itemIndex][0].aggregateKey
      for (const legacyKey of legacyContributionKeys(item)) {
        const matches = aggregateKeysByLegacyKey.get(legacyKey) || new Set()
        matches.add(aggregateKey)
        aggregateKeysByLegacyKey.set(legacyKey, matches)
      }
    })
    const keyCounts = new Map<string, number>()
    for (const ingredientGroup of ingredientGroups) {
      const ingredient = ingredientGroup[0]
      keyCounts.set(ingredient.aggregateKey, (keyCounts.get(ingredient.aggregateKey) || 0) + 1)
    }
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
  if (preferences !== undefined && (!isRecord(preferences) ||
      (preferences.categoryOverrides != null &&
        (!isRecord(preferences.categoryOverrides) ||
          !Object.values(preferences.categoryOverrides).every((value) =>
            typeof value === "string"))) ||
      (preferences.customCategories != null && !Array.isArray(preferences.customCategories)) ||
      (preferences.categoryOrder != null &&
        (!Array.isArray(preferences.categoryOrder) ||
          !preferences.categoryOrder.every((value) => typeof value === "string"))) ||
      (preferences.excludedKeywords != null &&
        (!Array.isArray(preferences.excludedKeywords) ||
          !preferences.excludedKeywords.every((value) => typeof value === "string"))) ||
      (preferences.excludeSaltVariants != null &&
        typeof preferences.excludeSaltVariants !== "boolean") ||
      (preferences.excludeBlackPepperVariants != null &&
        typeof preferences.excludeBlackPepperVariants !== "boolean"))) {
    return { ok: false, issues: [{
      code: "malformed",
      path: "preferences",
      message: "Malformed current Shopping preferences",
    }] }
  }
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
    if (!isCurrentItem(item)) {
      issues.push({ code: "malformed", path: `${bucket}.${index}`, message: "Malformed rendered row" })
      continue
    }
    const sources = item.sources || []
    const sourceIds = new Set(sources.flatMap((source) =>
      source.recipeId ? [source.recipeId] : []))
    const activeIds = [...sourceIds].filter((id) => recipeIds.has(id))
    const unknownRecipeSource = sources.some((source) =>
      source.recipeId
        ? !recipeIds.has(source.recipeId)
        : source.recipeName !== "Manual")
    const hasManualSource = sources.some((source) =>
      !source.recipeId && source.recipeName === "Manual")
    if (activeIds.length > 0 &&
        (unknownRecipeSource || hasManualSource || activeIds.length !== sourceIds.size)) {
      issues.push({
        code: "ambiguous-row",
        path: `${bucket}.${index}`,
        message: "Row mixes active contribution and unknown recipe provenance",
      })
      continue
    }

    if (activeIds.length === 0) {
      const explicitManual = sources.length > 0 && sources.every((source) =>
        !source.recipeId && source.recipeName === "Manual")
      const preservedLegacyManual = sources.length === 0 &&
        currentList.legacy_items_preserved === true
      if (!explicitManual && !preservedLegacyManual) {
        issues.push({
          code: "ambiguous-row",
          path: `${bucket}.${index}`,
          message: "Legacy recipe row cannot be deterministically assigned",
        })
        continue
      }
      if ((item.additionalAmounts || []).length > 0) {
        issues.push({
          code: "ambiguous-row",
          path: `${bucket}.${index}`,
          message: "Manual item with additional amounts is not representable in ShoppingDocumentV1",
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
    if (!sameQuantity(item, base)) {
      if ((item.additionalAmounts || []).length > 0) {
        issues.push({
          code: "ambiguous-row",
          path: `${bucket}.${index}`,
          message: "Quantity override with additional amounts is not representable in ShoppingDocumentV1",
        })
        continue
      }
      override.quantity = quantityOf(item)
    }
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
