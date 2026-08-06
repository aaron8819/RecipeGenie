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

export type ShoppingDocumentV1 = {
  schemaVersion: 1
  recipeEntries: Record<string, ShoppingRecipeEntryV1>
  manualItems: ShoppingManualItemV1[]
  itemOverrides: Record<AggregateKey, ShoppingItemOverrideV1>
  order: RowRef[]
  preferences: {
    categoryByIngredient: Record<IngredientKey, string>
    customCategories: CustomShoppingCategory[]
    categoryOrder: string[]
    excludedIngredientKeys: IngredientKey[]
    excludeSaltVariants: boolean
    excludeBlackPepperVariants: boolean
  }
}

/** content_revision is the row CAS token, not document content. */
export type ShoppingDocumentStateV1 = {
  document: ShoppingDocumentV1
  contentRevision: number
}

export type ShoppingDocumentValidationIssue = {
  path: string
  message: string
}

export type ShoppingDocumentValidationResult =
  | { ok: true; document: ShoppingDocumentV1 }
  | { ok: false; issues: ShoppingDocumentValidationIssue[] }

export function createEmptyShoppingDocument(): ShoppingDocumentV1 {
  return {
    schemaVersion: 1,
    recipeEntries: {},
    manualItems: [],
    itemOverrides: {},
    order: [],
    preferences: {
      categoryByIngredient: {},
      customCategories: [],
      categoryOrder: [],
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
      value.exclusionFamily === "black-pepper")
}

function validOverride(value: unknown): value is ShoppingItemOverrideV1 {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "displayName",
    "quantity",
    "categoryKey",
    "bucket",
    "checked",
    "suppressed",
  ])) return false
  if (Object.keys(value).length === 0) return false
  return (value.displayName === undefined || isNonEmptyString(value.displayName)) &&
    (value.quantity === undefined || validQuantity(value.quantity)) &&
    (value.categoryKey === undefined || isNonEmptyString(value.categoryKey)) &&
    (value.bucket === undefined || isBucket(value.bucket)) &&
    (value.checked === undefined || typeof value.checked === "boolean") &&
    (value.suppressed === undefined || value.suppressed === true)
}

export function validateShoppingDocumentV1(
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
    "order",
    "preferences",
  ])) issue("$", "Document contains persisted derived or unknown fields")
  if (value.schemaVersion !== 1) issue("schemaVersion", "Expected schemaVersion 1")

  const aggregateKeys = new Set<string>()
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
        entry.ingredients.forEach((ingredient) => aggregateKeys.add(ingredient.aggregateKey))
      }
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

  if (!Array.isArray(value.order) || !value.order.every(isNonEmptyString)) {
    issue("order", "Expected an order array")
  } else {
    const refs = new Set<string>()
    for (const ref of value.order) {
      if (refs.has(ref)) issue("order", `Duplicate order reference: ${ref}`)
      refs.add(ref)
      const valid = ref.startsWith("derived:")
        ? aggregateKeys.has(ref.slice("derived:".length))
        : ref.startsWith("manual:") && manualIds.has(ref.slice("manual:".length))
      if (!valid) issue("order", `Unknown order reference: ${ref}`)
    }
  }

  const preferences = value.preferences
  if (!isRecord(preferences) || !hasOnlyKeys(preferences, [
    "categoryByIngredient", "customCategories", "categoryOrder",
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
    if (Array.isArray(preferences.excludedIngredientKeys) &&
        new Set(preferences.excludedIngredientKeys).size !==
          preferences.excludedIngredientKeys.length)
      issue("preferences.excludedIngredientKeys", "Excluded ingredient keys must be unique")
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, document: value as ShoppingDocumentV1 }
}

export function validateShoppingDocumentStateV1(
  value: unknown
): ShoppingDocumentValidationResult & { contentRevision?: number } {
  if (!isRecord(value) || !Number.isSafeInteger(value.contentRevision) ||
      (value.contentRevision as number) < 0) {
    return { ok: false, issues: [{ path: "contentRevision", message: "Expected a non-negative safe integer revision" }] }
  }
  return { ...validateShoppingDocumentV1(value.document), contentRevision: value.contentRevision as number }
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
    }).map(({ runtime: _runtime, sourceOrdinal: _ordinal, ...ingredient }) => ingredient),
  }
}

export type ProjectedShoppingSource = { recipeId: string; recipeName: string }
export type ProjectedShoppingRow = {
  rowRef: RowRef
  aggregateKey?: AggregateKey
  manualId?: string
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

function categoryOrder(document: ShoppingDocumentV1, key: string): number {
  const explicit = document.preferences.categoryOrder.indexOf(key)
  if (explicit >= 0) return explicit
  const custom = document.preferences.customCategories.find((category) => category.id === key)
  return custom?.order ?? SHOPPING_CATEGORIES[key]?.order ?? Number.MAX_SAFE_INTEGER
}

function derivedCategory(document: ShoppingDocumentV1, occurrences: Occurrence[]): string {
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

function derivedClassification(
  occurrences: Occurrence[],
  pantry: Set<string>,
  excludedKeys: Set<string>,
  settings: IngredientExclusionSettings
): { bucket: ShoppingBucket; excludedBy?: string } {
  const classifications = occurrences.map((occurrence) => {
    if (occurrence.pantryMatchKeys.some((key) => pantry.has(key)))
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
  document: ShoppingDocumentV1,
  pantryItems: PantryItem[] = [],
  exclusionSettings?: IngredientExclusionSettings
): ShoppingDocumentProjection {
  const pantry = new Set(pantryItems.map((item) => createShoppingPurchaseKey(item.item)))
  const settings = exclusionSettings || {
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
    for (const occurrence of occurrences) {
      const merged = mergeQuantity(quantity, additionalQuantities, occurrence.quantity)
      quantity = merged.primary
      additionalQuantities = merged.additional
    }
    const classification = derivedClassification(
      occurrences,
      pantry,
      new Set(document.preferences.excludedIngredientKeys),
      settings
    )
    const categoryKey = override?.categoryKey || derivedCategory(document, occurrences)
    rows.push({
      rowRef: `derived:${aggregateKey}`,
      aggregateKey,
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

  const deterministic = [...rows].sort((left, right) =>
    left.categoryOrder - right.categoryOrder ||
    left.displayName.localeCompare(right.displayName) ||
    left.rowRef.localeCompare(right.rowRef))
  const byRef = new Map(deterministic.map((row) => [row.rowRef, row]))
  const ordered = [
    ...document.order.flatMap((ref) => {
      const row = byRef.get(ref)
      if (!row) return []
      byRef.delete(ref)
      return [row]
    }),
    ...deterministic.filter((row) => byRef.has(row.rowRef)),
  ]
  return {
    rows: ordered,
    items: ordered.filter((row) => row.bucket === "items"),
    alreadyHave: ordered.filter((row) => row.bucket === "already_have"),
    excluded: ordered.filter((row) => row.bucket === "excluded"),
  }
}

export type ShoppingDocumentMutation =
  | { type: "upsertRecipe"; entry: ShoppingRecipeEntryV1 }
  | { type: "rescaleRecipe"; entry: ShoppingRecipeEntryV1 }
  | { type: "removeRecipe"; recipeId: string }
  | { type: "setChecked"; aggregateKey: AggregateKey; checked: boolean }
  | { type: "setQuantityOverride"; aggregateKey: AggregateKey; quantity: ShoppingQuantity | null | undefined }
  | { type: "setDisplayNameOverride"; aggregateKey: AggregateKey; displayName?: string }
  | { type: "setCategoryOverride"; aggregateKey: AggregateKey; categoryKey?: string }
  | { type: "setBucketOverride"; aggregateKey: AggregateKey; bucket?: ShoppingBucket }
  | { type: "setSuppressed"; aggregateKey: AggregateKey; suppressed: boolean }
  | { type: "setIngredientCategory"; ingredientKey: IngredientKey; categoryKey?: string }
  | { type: "setOrder"; order: RowRef[] }
  | { type: "addManualItem"; item: ShoppingManualItemV1 }
  | { type: "editManualItem"; item: ShoppingManualItemV1 }
  | { type: "deleteManualItem"; id: string }
  | { type: "complete" }

function activeKeys(document: ShoppingDocumentV1): Set<string> {
  return new Set(Object.values(document.recipeEntries)
    .flatMap((entry) => entry.ingredients.map((ingredient) => ingredient.aggregateKey)))
}

function validRefs(document: ShoppingDocumentV1): Set<RowRef> {
  return new Set([
    ...[...activeKeys(document)].map((key): RowRef => `derived:${key}`),
    ...document.manualItems.map((item): RowRef => `manual:${item.id}`),
  ])
}

function pruneDocument(document: ShoppingDocumentV1): ShoppingDocumentV1 {
  const keys = activeKeys(document)
  const refs = validRefs(document)
  return {
    ...document,
    itemOverrides: Object.fromEntries(Object.entries(document.itemOverrides)
      .filter(([key, value]) => keys.has(key) && Object.keys(value).length > 0)),
    order: document.order.filter((ref, index) =>
      refs.has(ref) && document.order.indexOf(ref) === index),
  }
}

function updateOverride(
  document: ShoppingDocumentV1,
  aggregateKey: string,
  update: (current: ShoppingItemOverrideV1) => ShoppingItemOverrideV1
): ShoppingDocumentV1 {
  if (!activeKeys(document).has(aggregateKey)) return document
  const next = update(document.itemOverrides[aggregateKey] || {})
  const itemOverrides = { ...document.itemOverrides }
  if (Object.keys(next).length === 0) delete itemOverrides[aggregateKey]
  else itemOverrides[aggregateKey] = next
  return { ...document, itemOverrides }
}

function reduceDocument(
  document: ShoppingDocumentV1,
  mutation: ShoppingDocumentMutation
): ShoppingDocumentV1 {
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
    case "removeRecipe": {
      const recipeEntries = { ...document.recipeEntries }
      delete recipeEntries[mutation.recipeId]
      return pruneDocument({ ...document, recipeEntries })
    }
    case "setChecked":
      return updateOverride(document, mutation.aggregateKey, (current) =>
        mutation.checked ? { ...current, checked: true } :
          Object.fromEntries(Object.entries(current).filter(([key]) => key !== "checked")))
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
    case "setCategoryOverride":
      return updateOverride(document, mutation.aggregateKey, (current) => {
        const next = { ...current }
        if (mutation.categoryKey) next.categoryKey = mutation.categoryKey
        else delete next.categoryKey
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
      return { ...document, preferences: { ...document.preferences, categoryByIngredient } }
    }
    case "setOrder": {
      const refs = validRefs(document)
      return { ...document, order: mutation.order.filter((ref, index) =>
        refs.has(ref) && mutation.order.indexOf(ref) === index) }
    }
    case "addManualItem":
      return document.manualItems.some((item) => item.id === mutation.item.id)
        ? document
        : { ...document, manualItems: [...document.manualItems, mutation.item] }
    case "editManualItem":
      return document.manualItems.some((item) => item.id === mutation.item.id)
        ? { ...document, manualItems: document.manualItems.map((item) =>
            item.id === mutation.item.id ? mutation.item : item) }
        : document
    case "deleteManualItem":
      return pruneDocument({ ...document, manualItems: document.manualItems.filter((item) =>
        item.id !== mutation.id) })
    case "complete":
      return {
        ...document,
        recipeEntries: {},
        manualItems: [],
        itemOverrides: {},
        order: [],
      }
  }
}

/** Pure, replayable mutation application for the future one-retry CAS loop. */
export function applyShoppingDocumentMutation(
  state: ShoppingDocumentStateV1,
  mutation: ShoppingDocumentMutation
): ShoppingDocumentStateV1 {
  const document = reduceDocument(state.document, mutation)
  return JSON.stringify(document) === JSON.stringify(state.document)
    ? state
    : { document, contentRevision: state.contentRevision + 1 }
}
