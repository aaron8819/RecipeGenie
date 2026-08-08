import type {
  CustomShoppingCategory,
  PackageV1,
  PantryItem,
  QuantityV1,
  RationalV1,
  Recipe,
} from "@/types/database"
import { SHOPPING_CATEGORIES } from "./shopping-categories"
import {
  INGREDIENT_EXCLUSION_REASONS,
  matchIngredientExclusionFamily,
  type IngredientExclusionFamily,
  type IngredientExclusionSettings,
} from "./ingredient-exclusion-families"
import {
  normalizePackageV1,
  normalizeQuantityV1,
  normalizeRationalV1,
} from "./recipe-quantity"
import {
  type AggregateKey,
  type IngredientKey,
  resolveRecipeShoppingIngredients,
  type ShoppingQuantity,
} from "./shopping-ingredient-resolution"
import { createShoppingPurchaseKey } from "./shopping-list-normalization"
import {
  learnIngredientOrder,
  mergeVisibleIngredientOrder,
  orderShoppingRows,
  resolveShoppingCategoryOrder,
  type IngredientOrderByCategory,
  type ShoppingDropPlacement,
  type ShoppingOrderingCategory,
} from "./shopping-ordering"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"

export type ShoppingBucket = "items" | "already_have" | "excluded"
export type RowRef = `derived:${AggregateKey}` | `manual:${string}`

export type ShoppingRecipeIngredientV1 = {
  ingredientKey: IngredientKey
  aggregateKey: AggregateKey
  displayName: string
  quantity: ShoppingQuantity | null
  purchaseUnit: string
  defaultCategoryKey: string
  pantryMatchKeys: IngredientKey[]
  exclusionFamily?: "salt" | "black-pepper"
  citrusPrep?: "juiced" | "zested"
}

export type ShoppingRecipeEntryV1 = {
  recipeId: string
  recipeName: string
  selectedServings: number
  scaleV1: RationalV1
  ingredients: ShoppingRecipeIngredientV1[]
}

export type ShoppingManualItemV1 = {
  id: string
  displayName: string
  quantity: ShoppingQuantity | null
  categoryKey: string
  bucket: ShoppingBucket
  checked: boolean
}

export type ShoppingItemOverrideV1 = {
  displayName?: string
  quantity?: ShoppingQuantity | null
  categoryKey?: string
  bucket?: ShoppingBucket
  checked?: boolean
  suppressed?: true
}

export type ShoppingItemOverrideV2 = Omit<ShoppingItemOverrideV1, "categoryKey">

export type ShoppingOrderingPreferences = {
  categoryOrder: string[]
  ingredientOrderByCategory: IngredientOrderByCategory
}

type ShoppingPreferencesV1 = {
  categoryByIngredient: Record<IngredientKey, string>
  customCategories: CustomShoppingCategory[]
  categoryOrder: string[]
  excludedIngredientKeys: IngredientKey[]
  excludeSaltVariants: boolean
  excludeBlackPepperVariants: boolean
}

export type ShoppingDocumentV1 = {
  schemaVersion: 1
  recipeEntries: Record<string, ShoppingRecipeEntryV1>
  manualItems: ShoppingManualItemV1[]
  itemOverrides: Record<AggregateKey, ShoppingItemOverrideV1>
  order: RowRef[]
  preferences: ShoppingPreferencesV1
}

export type ShoppingDocumentV2 = {
  schemaVersion: 2
  recipeEntries: Record<string, ShoppingRecipeEntryV1>
  manualItems: ShoppingManualItemV1[]
  itemOverrides: Record<AggregateKey, ShoppingItemOverrideV2>
  preferences: ShoppingPreferencesV1 & ShoppingOrderingPreferences
}

/** content_revision is the row CAS token, not document content. */
export type ShoppingDocumentStateV2 = {
  document: ShoppingDocumentV2
  contentRevision: number
}

export type ShoppingDocumentValidationIssue = {
  path: string
  message: string
}

export type ShoppingDocumentValidationResult =
  | { ok: true; document: ShoppingDocumentV2 }
  | { ok: false; issues: ShoppingDocumentValidationIssue[] }

export function createEmptyShoppingDocument(): ShoppingDocumentV2 {
  return {
    schemaVersion: 2,
    recipeEntries: {},
    manualItems: [],
    itemOverrides: {},
    preferences: {
      categoryByIngredient: {},
      customCategories: [],
      categoryOrder: [],
      ingredientOrderByCategory: {},
      excludedIngredientKeys: [],
      excludeSaltVariants: false,
      excludeBlackPepperVariants: false,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isBucket(value: unknown): value is ShoppingBucket {
  return value === "items" || value === "already_have" || value === "excluded"
}

function validQuantity(value: unknown): value is ShoppingQuantity | null {
  if (value === null) return true
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "amount",
    "unit",
    "exactQuantityV1",
    "exactPackageV1",
    "exactAuthoredUnit",
  ])) return false
  if (value.amount !== null &&
      (typeof value.amount !== "number" || !Number.isFinite(value.amount) ||
        value.amount < 0)) {
    return false
  }
  if (typeof value.unit !== "string") return false
  if (value.exactQuantityV1 !== undefined &&
      !normalizeQuantityV1(value.exactQuantityV1)) return false
  if (value.exactPackageV1 !== undefined &&
      !normalizePackageV1(value.exactPackageV1)) return false
  return value.exactAuthoredUnit === undefined ||
    typeof value.exactAuthoredUnit === "string"
}

function validIngredient(value: unknown): value is ShoppingRecipeIngredientV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "ingredientKey",
    "aggregateKey",
    "displayName",
    "quantity",
    "purchaseUnit",
    "defaultCategoryKey",
    "pantryMatchKeys",
    "exclusionFamily",
    "citrusPrep",
  ])) return false
  return isNonEmptyString(value.ingredientKey) &&
    isNonEmptyString(value.aggregateKey) &&
    isNonEmptyString(value.displayName) &&
    validQuantity(value.quantity) &&
    typeof value.purchaseUnit === "string" &&
    isNonEmptyString(value.defaultCategoryKey) &&
    Array.isArray(value.pantryMatchKeys) &&
    value.pantryMatchKeys.length > 0 &&
    value.pantryMatchKeys.every(isNonEmptyString) &&
    new Set(value.pantryMatchKeys).size === value.pantryMatchKeys.length &&
    (value.exclusionFamily === undefined ||
      value.exclusionFamily === "salt" ||
      value.exclusionFamily === "black-pepper") &&
    (value.citrusPrep === undefined ||
      ((value.citrusPrep === "juiced" || value.citrusPrep === "zested") &&
        (value.ingredientKey === "lemon" || value.ingredientKey === "lime") &&
        value.purchaseUnit === "count"))
}

function validOverride(
  value: unknown,
  allowCategoryKey = false
): value is ShoppingItemOverrideV1 {
  const allowedKeys = [
    "displayName",
    "quantity",
    "bucket",
    "checked",
    "suppressed",
    ...(allowCategoryKey ? ["categoryKey"] : []),
  ]
  if (!isRecord(value) || !hasOnlyKeys(value, allowedKeys)) return false
  if (Object.keys(value).length === 0) return false
  return (value.displayName === undefined || isNonEmptyString(value.displayName)) &&
    (value.quantity === undefined || validQuantity(value.quantity)) &&
    (value.categoryKey === undefined || isNonEmptyString(value.categoryKey)) &&
    (value.bucket === undefined || isBucket(value.bucket)) &&
    (value.checked === undefined || typeof value.checked === "boolean") &&
    (value.suppressed === undefined || value.suppressed === true)
}

export function validateShoppingDocumentV2(
  value: unknown
): ShoppingDocumentValidationResult {
  const issues: ShoppingDocumentValidationIssue[] = []
  const issue = (path: string, message: string) => issues.push({ path, message })
  if (!isRecord(value)) return { ok: false, issues: [{ path: "$", message: "Document must be an object" }] }
  if (!hasOnlyKeys(value, [
    "schemaVersion",
    "recipeEntries",
    "manualItems",
    "itemOverrides",
    "preferences",
  ])) issue("$", "Document contains persisted derived or unknown fields")
  if (value.schemaVersion !== 2) issue("schemaVersion", "Expected schemaVersion 2")

  const aggregateKeys = new Set<string>()
  const ingredientKeysByAggregate = new Map<string, Set<string>>()
  if (!isRecord(value.recipeEntries)) {
    issue("recipeEntries", "Expected a recipe-entry map")
  } else {
    for (const [recipeId, entry] of Object.entries(value.recipeEntries)) {
      const path = `recipeEntries.${recipeId}`
      if (!isRecord(entry) || !hasOnlyKeys(entry, [
        "recipeId", "recipeName", "selectedServings", "scaleV1", "ingredients",
      ])) {
        issue(path, "Malformed recipe entry")
        continue
      }
      if (entry.recipeId !== recipeId || !isNonEmptyString(entry.recipeId))
        issue(`${path}.recipeId`, "Recipe map key must equal recipeId")
      if (!isNonEmptyString(entry.recipeName)) issue(`${path}.recipeName`, "Expected recipe name")
      if (typeof entry.selectedServings !== "number" ||
          !Number.isFinite(entry.selectedServings) || entry.selectedServings <= 0)
        issue(`${path}.selectedServings`, "Expected a positive finite serving count")
      if (!normalizeRationalV1(entry.scaleV1, { positive: true }))
        issue(`${path}.scaleV1`, "Expected a valid positive scale")
      if (!Array.isArray(entry.ingredients) || !entry.ingredients.every(validIngredient)) {
        issue(`${path}.ingredients`, "Expected valid resolved ingredients")
      } else {
        entry.ingredients.forEach((ingredient) => {
          aggregateKeys.add(ingredient.aggregateKey)
          const ingredientKeys = ingredientKeysByAggregate.get(ingredient.aggregateKey) ||
            new Set<string>()
          ingredientKeys.add(ingredient.ingredientKey)
          ingredientKeysByAggregate.set(ingredient.aggregateKey, ingredientKeys)
        })
      }
    }
  }
  for (const [aggregateKey, ingredientKeys] of ingredientKeysByAggregate) {
    if (ingredientKeys.size !== 1) {
      issue(
        `recipeEntries.${aggregateKey}`,
        "An aggregate key must resolve to exactly one ingredient key"
      )
    }
  }

  const manualIds = new Set<string>()
  if (!Array.isArray(value.manualItems)) {
    issue("manualItems", "Expected a manual-item array")
  } else {
    value.manualItems.forEach((manual, index) => {
      const path = `manualItems.${index}`
      if (!isRecord(manual) || !hasOnlyKeys(manual, [
        "id", "displayName", "quantity", "categoryKey", "bucket", "checked",
      ]) || !isNonEmptyString(manual.id) || !isNonEmptyString(manual.displayName) ||
        !validQuantity(manual.quantity) || !isNonEmptyString(manual.categoryKey) ||
        !isBucket(manual.bucket) || typeof manual.checked !== "boolean") {
        issue(path, "Malformed manual item")
        return
      }
      if (manualIds.has(manual.id)) issue(`${path}.id`, "Duplicate manual item id")
      manualIds.add(manual.id)
    })
  }

  if (!isRecord(value.itemOverrides)) {
    issue("itemOverrides", "Expected an override map")
  } else {
    for (const [key, override] of Object.entries(value.itemOverrides)) {
      if (!aggregateKeys.has(key)) issue(`itemOverrides.${key}`, "Override key is not produced by a recipe")
      if (!validOverride(override)) issue(`itemOverrides.${key}`, "Malformed item override")
    }
  }

  const preferences = value.preferences
  if (!isRecord(preferences) || !hasOnlyKeys(preferences, [
    "categoryByIngredient", "customCategories", "categoryOrder",
    "ingredientOrderByCategory",
    "excludedIngredientKeys", "excludeSaltVariants", "excludeBlackPepperVariants",
  ]) || !isRecord(preferences.categoryByIngredient) ||
    !Object.entries(preferences.categoryByIngredient).every(([key, category]) =>
      isNonEmptyString(key) && isNonEmptyString(category)) ||
    !Array.isArray(preferences.customCategories) ||
    !preferences.customCategories.every((category) => isRecord(category) &&
      hasOnlyKeys(category, ["id", "name", "order"]) &&
      isNonEmptyString(category.id) && isNonEmptyString(category.name) &&
      typeof category.order === "number" && Number.isFinite(category.order)) ||
    !Array.isArray(preferences.categoryOrder) ||
    !preferences.categoryOrder.every(isNonEmptyString) ||
    !isRecord(preferences.ingredientOrderByCategory) ||
    !Object.entries(preferences.ingredientOrderByCategory).every(([category, order]) =>
      isNonEmptyString(category) && Array.isArray(order) &&
      order.every(isNonEmptyString)) ||
    !Array.isArray(preferences.excludedIngredientKeys) ||
    !preferences.excludedIngredientKeys.every(isNonEmptyString) ||
    typeof preferences.excludeSaltVariants !== "boolean" ||
    typeof preferences.excludeBlackPepperVariants !== "boolean") {
    issue("preferences", "Malformed Shopping preferences")
  }
  if (isRecord(preferences)) {
    if (Array.isArray(preferences.customCategories)) {
      const ids = preferences.customCategories.flatMap((category) =>
        isRecord(category) && typeof category.id === "string" ? [category.id] : [])
      if (new Set(ids).size !== ids.length)
        issue("preferences.customCategories", "Custom category ids must be unique")
    }
    if (Array.isArray(preferences.categoryOrder) &&
        new Set(preferences.categoryOrder).size !== preferences.categoryOrder.length)
      issue("preferences.categoryOrder", "Category order keys must be unique")
    if (isRecord(preferences.ingredientOrderByCategory)) {
      const seenIngredientKeys = new Set<string>()
      for (const [categoryKey, order] of Object.entries(
        preferences.ingredientOrderByCategory
      )) {
        if (!Array.isArray(order)) continue
        if (new Set(order).size !== order.length) {
          issue(
            `preferences.ingredientOrderByCategory.${categoryKey}`,
            "Ingredient order keys must be unique"
          )
        }
        for (const key of order) {
          if (typeof key !== "string") continue
          if (seenIngredientKeys.has(key)) {
            issue(
              "preferences.ingredientOrderByCategory",
              `Ingredient order key appears in multiple categories: ${key}`
            )
          }
          seenIngredientKeys.add(key)
        }
      }
    }
    if (Array.isArray(preferences.excludedIngredientKeys) &&
        new Set(preferences.excludedIngredientKeys).size !==
          preferences.excludedIngredientKeys.length)
      issue("preferences.excludedIngredientKeys", "Excluded ingredient keys must be unique")
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, document: value as ShoppingDocumentV2 }
}

export function upgradeShoppingDocumentV1(
  value: unknown
): ShoppingDocumentValidationResult {
  const issues: ShoppingDocumentValidationIssue[] = []
  const issue = (path: string, message: string) => issues.push({ path, message })
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", message: "Document must be an object" }] }
  }
  if (!hasOnlyKeys(value, [
    "schemaVersion",
    "recipeEntries",
    "manualItems",
    "itemOverrides",
    "order",
    "preferences",
  ])) issue("$", "V1 document contains persisted derived or unknown fields")
  if (value.schemaVersion !== 1) issue("schemaVersion", "Expected schemaVersion 1")
  if (!Array.isArray(value.order) || !value.order.every(isNonEmptyString) ||
      new Set(value.order).size !== value.order.length) {
    issue("order", "Expected unique non-empty row references")
  }
  if (!isRecord(value.preferences) || !hasOnlyKeys(value.preferences, [
    "categoryByIngredient",
    "customCategories",
    "categoryOrder",
    "excludedIngredientKeys",
    "excludeSaltVariants",
    "excludeBlackPepperVariants",
  ])) issue("preferences", "Malformed V1 Shopping preferences")
  if (!isRecord(value.itemOverrides)) {
    issue("itemOverrides", "Expected an override map")
  } else {
    for (const [aggregateKey, override] of Object.entries(value.itemOverrides)) {
      if (!validOverride(override, true)) {
        issue(`itemOverrides.${aggregateKey}`, "Malformed V1 item override")
      }
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  const preferences = value.preferences as Record<string, unknown>
  const categoryByIngredient = {
    ...(preferences.categoryByIngredient as Record<IngredientKey, string>),
  }
  const itemOverrides: Record<AggregateKey, ShoppingItemOverrideV2> = {}
  for (const [aggregateKey, rawOverride] of Object.entries(
    value.itemOverrides as Record<AggregateKey, ShoppingItemOverrideV1>
  )) {
    const { categoryKey, ...override } = rawOverride
    if (categoryKey && isRecord(value.recipeEntries)) {
      for (const entry of Object.values(value.recipeEntries)) {
        if (!isRecord(entry) || !Array.isArray(entry.ingredients)) continue
        for (const ingredient of entry.ingredients) {
          if (isRecord(ingredient) && ingredient.aggregateKey === aggregateKey &&
              isNonEmptyString(ingredient.ingredientKey)) {
            categoryByIngredient[ingredient.ingredientKey] = categoryKey
          }
        }
      }
    }
    if (Object.keys(override).length > 0) itemOverrides[aggregateKey] = override
  }

  const candidate = {
    schemaVersion: 2,
    recipeEntries: value.recipeEntries,
    manualItems: value.manualItems,
    itemOverrides,
    preferences: {
      ...preferences,
      categoryByIngredient,
      ingredientOrderByCategory: {},
    },
  }
  const validation = validateShoppingDocumentV2(candidate)
  if (!validation.ok) return validation

  const projection = projectShoppingDocument(validation.document)
  const byRef = new Map(projection.rows.map((row) => [row.rowRef, row]))
  const migratedRows = [
    ...(value.order as RowRef[]).flatMap((ref) => {
      const row = byRef.get(ref)
      if (!row) return []
      byRef.delete(ref)
      return [row]
    }),
    ...projection.rows.filter((row) => byRef.has(row.rowRef)),
  ]
  const ingredientOrderByCategory: IngredientOrderByCategory = {}
  const seenOrderingKeys = new Set<IngredientKey>()
  for (const row of migratedRows) {
    if (seenOrderingKeys.has(row.orderingKey)) continue
    seenOrderingKeys.add(row.orderingKey)
    ingredientOrderByCategory[row.categoryKey] = [
      ...(ingredientOrderByCategory[row.categoryKey] || []),
      row.orderingKey,
    ]
  }
  return {
    ok: true,
    document: {
      ...validation.document,
      preferences: {
        ...validation.document.preferences,
        ingredientOrderByCategory,
      },
    },
  }
}

export function validateShoppingDocumentStateV2(
  value: unknown
): ShoppingDocumentValidationResult & { contentRevision?: number } {
  if (!isRecord(value) || !Number.isSafeInteger(value.contentRevision) ||
      (value.contentRevision as number) < 0) {
    return { ok: false, issues: [{ path: "contentRevision", message: "Expected a non-negative safe integer revision" }] }
  }
  const validation = validateShoppingDocumentV2(value.document)
  const compatible = validation.ok ? validation : upgradeShoppingDocumentV1(value.document)
  return { ...compatible, contentRevision: value.contentRevision as number }
}

export function createShoppingRecipeEntry(
  recipe: Recipe,
  selectedServings: number,
  scaleV1: RationalV1
): ShoppingRecipeEntryV1 {
  const scale = Number(scaleV1.numerator) / Number(scaleV1.denominator)
  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    selectedServings,
    scaleV1,
    ingredients: resolveRecipeShoppingIngredients(recipe.ingredientSections, {
      scale,
      exactScaleV1: scaleV1,
      recipeId: recipe.id,
    }).map(({
      runtime: _runtime,
      sourceOrdinal: _ordinal,
      defaultCategoryOrder: _categoryOrder,
      ...ingredient
    }) => ingredient),
  }
}

export type ProjectedShoppingSource = { recipeId: string; recipeName: string }
export type ProjectedShoppingRow = {
  rowRef: RowRef
  aggregateKey?: AggregateKey
  manualId?: string
  orderingKey: IngredientKey
  ingredientKeys: IngredientKey[]
  displayName: string
  quantity: ShoppingQuantity | null
  additionalQuantities?: ShoppingQuantity[]
  categoryKey: string
  categoryOrder: number
  bucket: ShoppingBucket
  checked: boolean
  sources: ProjectedShoppingSource[]
  excludedBy?: string
}

export type ShoppingDocumentProjection = {
  rows: ProjectedShoppingRow[]
  items: ProjectedShoppingRow[]
  alreadyHave: ProjectedShoppingRow[]
  excluded: ProjectedShoppingRow[]
}

type Occurrence = ShoppingRecipeIngredientV1 & ProjectedShoppingSource

type PantrySemanticEvidence = {
  ingredientKeys: Set<IngredientKey>
  families: Set<IngredientExclusionFamily>
}

function resolvePantrySemanticEvidence(
  pantryItems: PantryItem[]
): PantrySemanticEvidence {
  const ingredientKeys = new Set<IngredientKey>()
  const families = new Set<IngredientExclusionFamily>()

  for (const pantryItem of pantryItems) {
    ingredientKeys.add(createShoppingPurchaseKey(pantryItem.item))
    const family = matchIngredientExclusionFamily({
      item: pantryItem.item,
      amount: null,
      unit: "",
    })
    if (family) families.add(family)
  }

  return { ingredientKeys, families }
}

function shoppingOrderingCategories(
  document: ShoppingDocumentV2,
  visibleKeys: readonly string[] = []
): ShoppingOrderingCategory[] {
  const categories: ShoppingOrderingCategory[] = [
    ...Object.entries(SHOPPING_CATEGORIES).map(([key, category]) => ({
      key,
      defaultOrder: category.order,
      isCustom: false,
    })),
    ...document.preferences.customCategories.map((category) => ({
      key: `custom_${category.id}`,
      defaultOrder: category.order,
      isCustom: true,
    })),
  ]
  const known = new Set(categories.map((category) => category.key))
  for (const key of visibleKeys) {
    if (known.has(key)) continue
    known.add(key)
    categories.push({
      key,
      defaultOrder: Number.MAX_SAFE_INTEGER,
      isCustom: true,
    })
  }
  return categories
}

function categoryOrder(document: ShoppingDocumentV2, key: string): number {
  return resolveShoppingCategoryOrder(
    shoppingOrderingCategories(document, [key]),
    document.preferences.categoryOrder
  ).findIndex((category) => category.key === key)
}

function derivedCategory(document: ShoppingDocumentV2, occurrences: Occurrence[]): string {
  const preferenceCounts = new Map<string, number>()
  for (const occurrence of occurrences) {
    const category = document.preferences.categoryByIngredient[occurrence.ingredientKey] ||
      occurrence.defaultCategoryKey
    preferenceCounts.set(category, (preferenceCounts.get(category) || 0) + 1)
  }
  return [...preferenceCounts.entries()].sort((left, right) =>
    right[1] - left[1] ||
    categoryOrder(document, left[0]) - categoryOrder(document, right[0]) ||
    left[0].localeCompare(right[0]))[0][0]
}

function mergeQuantity(
  primary: ShoppingQuantity | null,
  additional: ShoppingQuantity[],
  incoming: ShoppingQuantity | null
): { primary: ShoppingQuantity | null; additional: ShoppingQuantity[] } {
  if (!incoming) return { primary, additional }
  if (!primary) return { primary: incoming, additional }
  const merged = mergeAmounts(primary.amount, primary.unit, incoming.amount, incoming.unit)
  if (merged) {
    return {
      primary: { amount: roundForDisplay(merged.amount), unit: merged.unit },
      additional,
    }
  }
  const next = [...additional]
  for (let index = 0; index < next.length; index++) {
    const candidate = mergeAmounts(next[index].amount, next[index].unit, incoming.amount, incoming.unit)
    if (candidate) {
      next[index] = { amount: roundForDisplay(candidate.amount), unit: candidate.unit }
      return { primary, additional: next }
    }
  }
  return { primary, additional: [...next, incoming] }
}

type CitrusPrepNeeds = { juiced: number; zested: number }

function citrusAmountToMerge(
  prepByRecipe: Map<string, CitrusPrepNeeds>,
  recipeId: string,
  prep: "juiced" | "zested",
  amount: number
): number {
  const previous = prepByRecipe.get(recipeId) || { juiced: 0, zested: 0 }
  const previousApplied = Math.max(previous.juiced, previous.zested)
  const next = { ...previous, [prep]: previous[prep] + amount }
  prepByRecipe.set(recipeId, next)
  return Math.max(next.juiced, next.zested) - previousApplied
}

function derivedClassification(
  occurrences: Occurrence[],
  pantry: PantrySemanticEvidence,
  excludedKeys: Set<string>,
  settings: IngredientExclusionSettings
): { bucket: ShoppingBucket; excludedBy?: string } {
  const classifications = occurrences.map((occurrence) => {
    if (
      occurrence.pantryMatchKeys.some((key) => pantry.ingredientKeys.has(key)) ||
      (occurrence.exclusionFamily !== undefined &&
        pantry.families.has(occurrence.exclusionFamily))
    )
      return { bucket: "already_have" as const }
    if (excludedKeys.has(occurrence.ingredientKey))
      return { bucket: "excluded" as const, excludedBy: occurrence.ingredientKey }
    if (occurrence.exclusionFamily === "salt" && settings.exclude_salt_variants)
      return { bucket: "excluded" as const, excludedBy: INGREDIENT_EXCLUSION_REASONS.salt }
    if (occurrence.exclusionFamily === "black-pepper" && settings.exclude_black_pepper_variants)
      return { bucket: "excluded" as const, excludedBy: INGREDIENT_EXCLUSION_REASONS["black-pepper"] }
    return { bucket: "items" as const }
  })
  if (classifications.every((result) => result.bucket === "already_have"))
    return { bucket: "already_have" }
  const reason = classifications[0]?.excludedBy
  if (reason && classifications.every((result) =>
    result.bucket === "excluded" && result.excludedBy === reason)) {
    return { bucket: "excluded", excludedBy: reason }
  }
  return { bucket: "items" }
}

export function projectShoppingDocument(
  document: ShoppingDocumentV2,
  pantryItems: PantryItem[] = []
): ShoppingDocumentProjection {
  const pantry = resolvePantrySemanticEvidence(pantryItems)
  const settings: IngredientExclusionSettings = {
    exclude_salt_variants: document.preferences.excludeSaltVariants,
    exclude_black_pepper_variants: document.preferences.excludeBlackPepperVariants,
  }
  const groups = new Map<AggregateKey, Occurrence[]>()
  for (const entry of Object.values(document.recipeEntries).sort((left, right) =>
    left.recipeId.localeCompare(right.recipeId))) {
    for (const ingredient of entry.ingredients) {
      const occurrence = { ...ingredient, recipeId: entry.recipeId, recipeName: entry.recipeName }
      groups.set(ingredient.aggregateKey, [...(groups.get(ingredient.aggregateKey) || []), occurrence])
    }
  }

  const rows: ProjectedShoppingRow[] = []
  for (const [aggregateKey, occurrences] of groups) {
    const override = document.itemOverrides[aggregateKey]
    if (override?.suppressed) continue
    let quantity: ShoppingQuantity | null = null
    let additionalQuantities: ShoppingQuantity[] = []
    const citrusPrepByRecipe = new Map<string, CitrusPrepNeeds>()
    for (const occurrence of occurrences) {
      const occurrenceQuantity = occurrence.citrusPrep &&
          occurrence.quantity?.amount != null &&
          occurrence.quantity.unit === "count"
        ? {
            ...occurrence.quantity,
            amount: citrusAmountToMerge(
              citrusPrepByRecipe,
              occurrence.recipeId,
              occurrence.citrusPrep,
              occurrence.quantity.amount
            ),
          }
        : occurrence.quantity
      const merged = mergeQuantity(quantity, additionalQuantities, occurrenceQuantity)
      quantity = merged.primary
      additionalQuantities = merged.additional
    }
    const classification = derivedClassification(
      occurrences,
      pantry,
      new Set(document.preferences.excludedIngredientKeys),
      settings
    )
    const orderingKey = occurrences[0].ingredientKey
    const categoryKey = derivedCategory(document, occurrences)
    rows.push({
      rowRef: `derived:${aggregateKey}`,
      aggregateKey,
      orderingKey,
      ingredientKeys: [...new Set(occurrences.map((item) => item.ingredientKey))],
      displayName: override?.displayName || occurrences[0].displayName,
      quantity: override && "quantity" in override ? override.quantity ?? null : quantity,
      additionalQuantities: override && "quantity" in override
        ? undefined
        : additionalQuantities.length > 0 ? additionalQuantities : undefined,
      categoryKey,
      categoryOrder: categoryOrder(document, categoryKey),
      bucket: override?.bucket || classification.bucket,
      checked: override?.checked || false,
      sources: [...new Map(occurrences.map(({ recipeId, recipeName }) =>
        [recipeId, { recipeId, recipeName }])).values()],
      excludedBy: override?.bucket ? undefined : classification.excludedBy,
    })
  }
  for (const item of document.manualItems) {
    rows.push({
      rowRef: `manual:${item.id}`,
      manualId: item.id,
      orderingKey: createShoppingPurchaseKey(
        item.displayName,
        item.quantity?.amount,
        item.quantity?.unit
      ),
      ingredientKeys: [],
      displayName: item.displayName,
      quantity: item.quantity,
      categoryKey: item.categoryKey,
      categoryOrder: categoryOrder(document, item.categoryKey),
      bucket: item.bucket,
      checked: item.checked,
      sources: [],
    })
  }

  const visibleCategoryKeys = [...new Set(rows.map((row) => row.categoryKey))]
  const categories = shoppingOrderingCategories(document, visibleCategoryKeys)
  const categoryRanks = new Map(resolveShoppingCategoryOrder(
    categories,
    document.preferences.categoryOrder
  ).map((category, index) => [category.key, index]))
  const ordered = orderShoppingRows(
    rows,
    categories,
    document.preferences.categoryOrder,
    document.preferences.ingredientOrderByCategory
  ).map((row) => ({
    ...row,
    categoryOrder: categoryRanks.get(row.categoryKey) ?? Number.MAX_SAFE_INTEGER,
  }))
  return {
    rows: ordered,
    items: ordered.filter((row) => row.bucket === "items"),
    alreadyHave: ordered.filter((row) => row.bucket === "already_have"),
    excluded: ordered.filter((row) => row.bucket === "excluded"),
  }
}

export type ShoppingDocumentMutation =
  | { type: "upsertRecipe"; entry: ShoppingRecipeEntryV1 }
  | { type: "upsertRecipes"; entries: ShoppingRecipeEntryV1[] }
  | { type: "rescaleRecipe"; entry: ShoppingRecipeEntryV1 }
  | { type: "removeRecipe"; recipeId: string }
  | { type: "setChecked"; rowRef: RowRef; checked: boolean }
  | { type: "setCheckedMany"; rowRefs: RowRef[]; checked: boolean }
  | { type: "setQuantityOverride"; aggregateKey: AggregateKey; quantity: ShoppingQuantity | null | undefined }
  | { type: "setDisplayNameOverride"; aggregateKey: AggregateKey; displayName?: string }
  | { type: "setBucketOverride"; aggregateKey: AggregateKey; bucket?: ShoppingBucket }
  | { type: "setSuppressed"; aggregateKey: AggregateKey; suppressed: boolean }
  | { type: "setIngredientCategory"; ingredientKey: IngredientKey; categoryKey?: string }
  | {
      type: "updatePreferences"
      preferences: Partial<ShoppingDocumentV2["preferences"]>
    }
  | {
      type: "updateCategoryPreferences"
      preferences: Partial<ShoppingDocumentV2["preferences"]>
    }
  | {
      type: "learnOrder"
      draggedRowRef: RowRef
      draggedOrderingKey: IngredientKey
      sourceCategoryKey: string
      targetRowRef: RowRef
      targetOrderingKey: IngredientKey
      targetCategoryKey: string
      placement: ShoppingDropPlacement
    }
  | { type: "addManualItem"; item: ShoppingManualItemV1 }
  | {
      type: "editManualItem"
      id: string
      changes: Partial<Omit<ShoppingManualItemV1, "id">>
    }
  | { type: "deleteManualItem"; id: string }
  | {
      type: "restoreContent"
      content: Pick<
        ShoppingDocumentV2,
        "recipeEntries" | "manualItems" | "itemOverrides"
      >
    }
  | { type: "complete" }

function activeKeys(document: ShoppingDocumentV2): Set<string> {
  return new Set(Object.values(document.recipeEntries)
    .flatMap((entry) => entry.ingredients.map((ingredient) => ingredient.aggregateKey)))
}

function pruneDocument(document: ShoppingDocumentV2): ShoppingDocumentV2 {
  const keys = activeKeys(document)
  return {
    ...document,
    itemOverrides: Object.fromEntries(Object.entries(document.itemOverrides)
      .filter(([key, value]) => keys.has(key) && Object.keys(value).length > 0)),
  }
}

function updateOverride(
  document: ShoppingDocumentV2,
  aggregateKey: string,
  update: (current: ShoppingItemOverrideV2) => ShoppingItemOverrideV2
): ShoppingDocumentV2 {
  if (!activeKeys(document).has(aggregateKey)) return document
  const next = update(document.itemOverrides[aggregateKey] || {})
  const itemOverrides = { ...document.itemOverrides }
  if (Object.keys(next).length === 0) delete itemOverrides[aggregateKey]
  else itemOverrides[aggregateKey] = next
  return { ...document, itemOverrides }
}

function orderingKeysByCategory(
  rows: readonly ProjectedShoppingRow[]
): IngredientOrderByCategory {
  const keysByCategory: IngredientOrderByCategory = {}
  for (const row of rows) {
    const keys = keysByCategory[row.categoryKey] || []
    if (!keys.includes(row.orderingKey)) keys.push(row.orderingKey)
    keysByCategory[row.categoryKey] = keys
  }
  return keysByCategory
}

function removeIngredientKeysFromOrder(
  ordering: IngredientOrderByCategory,
  keys: ReadonlySet<IngredientKey>
): IngredientOrderByCategory {
  return Object.fromEntries(Object.entries(ordering).flatMap(
    ([categoryKey, sequence]) => {
      const retained = sequence.filter((key) => !keys.has(key))
      return retained.length > 0 ? [[categoryKey, retained]] : []
    }
  ))
}

function reconcileCategoryPreferences(
  document: ShoppingDocumentV2,
  preferences: Partial<ShoppingDocumentV2["preferences"]>
): ShoppingDocumentV2 {
  const nextPreferences = { ...document.preferences, ...preferences }
  const previousCustomKeys = new Set(document.preferences.customCategories
    .map((category) => `custom_${category.id}`))
  const nextCustomKeys = new Set(nextPreferences.customCategories
    .map((category) => `custom_${category.id}`))
  const deletedCategoryKeys = new Set([...previousCustomKeys]
    .filter((key) => !nextCustomKeys.has(key)))

  const categoryByIngredient = { ...nextPreferences.categoryByIngredient }
  const reassignedDeletedIngredientKeys = new Set<IngredientKey>()
  for (const [ingredientKey, categoryKey] of Object.entries(
    document.preferences.categoryByIngredient
  )) {
    if (deletedCategoryKeys.has(categoryKey)) {
      categoryByIngredient[ingredientKey] = "misc"
      reassignedDeletedIngredientKeys.add(ingredientKey)
    }
  }
  for (const [ingredientKey, categoryKey] of Object.entries(
    categoryByIngredient
  )) {
    if (deletedCategoryKeys.has(categoryKey)) {
      categoryByIngredient[ingredientKey] = "misc"
      reassignedDeletedIngredientKeys.add(ingredientKey)
    }
  }

  const categoryOrder = nextPreferences.categoryOrder.filter(
    (key) => !deletedCategoryKeys.has(key)
  )
  const manualItems = document.manualItems.map((item) =>
    deletedCategoryKeys.has(item.categoryKey)
      ? { ...item, categoryKey: "misc" }
      : item)

  let ingredientOrderByCategory = {
    ...nextPreferences.ingredientOrderByCategory,
  }
  const fallbackSequence = [...(ingredientOrderByCategory.misc || [])]
  for (const categoryKey of deletedCategoryKeys) {
    for (const ingredientKey of ingredientOrderByCategory[categoryKey] || []) {
      if (!fallbackSequence.includes(ingredientKey)) {
        fallbackSequence.push(ingredientKey)
      }
    }
    delete ingredientOrderByCategory[categoryKey]
  }
  if (fallbackSequence.length > 0) {
    ingredientOrderByCategory.misc = fallbackSequence
  }

  const changedIngredientKeys = new Set<IngredientKey>()
  for (const ingredientKey of new Set([
    ...Object.keys(document.preferences.categoryByIngredient),
    ...Object.keys(categoryByIngredient),
  ])) {
    if (document.preferences.categoryByIngredient[ingredientKey] !==
        categoryByIngredient[ingredientKey] &&
        !reassignedDeletedIngredientKeys.has(ingredientKey)) {
      changedIngredientKeys.add(ingredientKey)
    }
  }
  ingredientOrderByCategory = removeIngredientKeysFromOrder(
    ingredientOrderByCategory,
    changedIngredientKeys
  )

  const reconciled = {
    ...document,
    manualItems,
    preferences: {
      ...nextPreferences,
      categoryByIngredient,
      categoryOrder,
      ingredientOrderByCategory,
    },
  }
  if (changedIngredientKeys.size === 0) {
    return reconciled
  }
  const projection = projectShoppingDocument(reconciled)
  return {
    ...reconciled,
    preferences: {
      ...reconciled.preferences,
      ingredientOrderByCategory: mergeVisibleIngredientOrder(
        ingredientOrderByCategory,
        orderingKeysByCategory(projection.rows)
      ),
    },
  }
}

function reduceDocument(
  document: ShoppingDocumentV2,
  mutation: ShoppingDocumentMutation
): ShoppingDocumentV2 {
  switch (mutation.type) {
    case "upsertRecipe":
    case "rescaleRecipe":
      return pruneDocument({
        ...document,
        recipeEntries: {
          ...document.recipeEntries,
          [mutation.entry.recipeId]: mutation.entry,
        },
      })
    case "upsertRecipes":
      return pruneDocument({
        ...document,
        recipeEntries: {
          ...document.recipeEntries,
          ...Object.fromEntries(mutation.entries.map((entry) => [entry.recipeId, entry])),
        },
      })
    case "removeRecipe": {
      const recipeEntries = { ...document.recipeEntries }
      delete recipeEntries[mutation.recipeId]
      return pruneDocument({ ...document, recipeEntries })
    }
    case "setChecked": {
      if (mutation.rowRef.startsWith("derived:")) {
        const aggregateKey = mutation.rowRef.slice("derived:".length)
        return updateOverride(document, aggregateKey, (current) =>
          mutation.checked ? { ...current, checked: true } :
            Object.fromEntries(Object.entries(current).filter(([key]) => key !== "checked")))
      }
      const id = mutation.rowRef.slice("manual:".length)
      if (!document.manualItems.some((item) => item.id === id)) return document
      return {
        ...document,
        manualItems: document.manualItems.map((item) =>
          item.id === id && item.checked !== mutation.checked
            ? { ...item, checked: mutation.checked }
            : item),
      }
    }
    case "setCheckedMany": {
      const requested = new Set(mutation.rowRefs)
      let next = document
      for (const rowRef of requested) {
        next = reduceDocument(next, {
          type: "setChecked",
          rowRef,
          checked: mutation.checked,
        })
      }
      return next
    }
    case "setQuantityOverride":
      return updateOverride(document, mutation.aggregateKey, (current) => {
        if (mutation.quantity === undefined)
          return Object.fromEntries(Object.entries(current).filter(([key]) => key !== "quantity"))
        return { ...current, quantity: mutation.quantity }
      })
    case "setDisplayNameOverride":
      return updateOverride(document, mutation.aggregateKey, (current) => {
        const next = { ...current }
        if (mutation.displayName) next.displayName = mutation.displayName
        else delete next.displayName
        return next
      })
    case "setBucketOverride":
      return updateOverride(document, mutation.aggregateKey, (current) => {
        const next = { ...current }
        if (mutation.bucket) next.bucket = mutation.bucket
        else delete next.bucket
        return next
      })
    case "setSuppressed":
      return updateOverride(document, mutation.aggregateKey, (current) => {
        const next = { ...current }
        if (mutation.suppressed) next.suppressed = true
        else delete next.suppressed
        return next
      })
    case "setIngredientCategory": {
      const categoryByIngredient = { ...document.preferences.categoryByIngredient }
      if (mutation.categoryKey) categoryByIngredient[mutation.ingredientKey] = mutation.categoryKey
      else delete categoryByIngredient[mutation.ingredientKey]
      return reconcileCategoryPreferences(document, { categoryByIngredient })
    }
    case "updatePreferences":
      return {
        ...document,
        preferences: {
          ...document.preferences,
          ...mutation.preferences,
        },
      }
    case "updateCategoryPreferences":
      return reconcileCategoryPreferences(document, mutation.preferences)
    case "learnOrder": {
      const projected = projectShoppingDocument(document)
      const dragged = projected.items.find((row) =>
        row.rowRef === mutation.draggedRowRef &&
        row.orderingKey === mutation.draggedOrderingKey)
      if (!dragged || dragged.categoryKey !== mutation.sourceCategoryKey) return document
      const target = projected.items.find((row) =>
        row.rowRef === mutation.targetRowRef &&
        row.orderingKey === mutation.targetOrderingKey)
      if (!target || target.categoryKey !== mutation.targetCategoryKey) return document
      if (dragged.orderingKey === target.orderingKey) return document

      const ingredientOrderByCategory = learnIngredientOrder({
        existing: document.preferences.ingredientOrderByCategory,
        visibleOrderingKeysByCategory: orderingKeysByCategory(projected.items),
        draggedOrderingKey: dragged.orderingKey,
        targetOrderingKey: target.orderingKey,
        targetCategoryKey: target.categoryKey,
        placement: mutation.placement,
      })
      const categoryByIngredient = { ...document.preferences.categoryByIngredient }
      let manualItems = document.manualItems
      if (mutation.sourceCategoryKey !== mutation.targetCategoryKey) {
        categoryByIngredient[dragged.orderingKey] = target.categoryKey
        if (mutation.draggedRowRef.startsWith("manual:")) {
          const manualId = mutation.draggedRowRef.slice("manual:".length)
          manualItems = document.manualItems.map((item) =>
            item.id === manualId
              ? { ...item, categoryKey: target.categoryKey }
              : item)
        }
      }
      return {
        ...document,
        manualItems,
        preferences: {
          ...document.preferences,
          categoryByIngredient,
          ingredientOrderByCategory,
        },
      }
    }
    case "addManualItem":
      return document.manualItems.some((item) => item.id === mutation.item.id)
        ? document
        : { ...document, manualItems: [...document.manualItems, mutation.item] }
    case "editManualItem": {
      if (!document.manualItems.some((item) => item.id === mutation.id)) return document
      return {
        ...document,
        manualItems: document.manualItems.map((item) => {
          if (item.id !== mutation.id) return item
          const next = { ...item }
          if (mutation.changes.displayName !== undefined)
            next.displayName = mutation.changes.displayName
          if (mutation.changes.quantity !== undefined)
            next.quantity = mutation.changes.quantity
          if (mutation.changes.categoryKey !== undefined)
            next.categoryKey = mutation.changes.categoryKey
          if (mutation.changes.bucket !== undefined)
            next.bucket = mutation.changes.bucket
          if (mutation.changes.checked !== undefined)
            next.checked = mutation.changes.checked
          return next
        }),
      }
    }
    case "deleteManualItem":
      return pruneDocument({ ...document, manualItems: document.manualItems.filter((item) =>
        item.id !== mutation.id) })
    case "restoreContent":
      return pruneDocument({
        ...document,
        recipeEntries: mutation.content.recipeEntries,
        manualItems: mutation.content.manualItems,
        itemOverrides: mutation.content.itemOverrides,
      })
    case "complete":
      return {
        ...document,
        recipeEntries: {},
        manualItems: [],
        itemOverrides: {},
      }
  }
}

/** Pure, replayable mutation application for the future one-retry CAS loop. */
export function applyShoppingDocumentMutation(
  state: ShoppingDocumentStateV2,
  mutation: ShoppingDocumentMutation
): ShoppingDocumentStateV2 {
  const document = reduceDocument(state.document, mutation)
  return JSON.stringify(document) === JSON.stringify(state.document)
    ? state
    : { document, contentRevision: state.contentRevision + 1 }
}
