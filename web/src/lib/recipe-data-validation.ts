import type {
  Ingredient,
  RecipeInstructionGroup,
  RecipeShareSnapshot,
  ShoppingItem,
  YieldMetadataV1,
} from "@/types/database"
import {
  RECIPE_QUANTITY_LIMITS,
  normalizePackageV1,
  normalizeQuantityV1,
  normalizeScaleRatioV1,
  normalizeYieldMetadataV1,
  normalizeRecipeUnit,
  packageMatchesCompatibilityUnit,
  quantityMatchesLegacy,
  resolveIngredientQuantity,
  formatStructuredRecipeQuantity,
} from "./recipe-quantity"

export const RECIPE_DATA_LIMITS = {
  ingredientsPerRecipe: 500,
  shoppingItemsPerList: 2_000,
  sourcesPerShoppingItem: 100,
  alternativesPerIngredient: 20,
  itemLength: 512,
  originalTextLength: 2_048,
  modifierLength: 256,
  groupLabelLength: 128,
  categoryLength: 128,
  recipeNameLength: 512,
  instructionLength: 10_000,
  instructionsPerRecipe: 2_000,
  instructionGroupsPerRecipe: 500,
  imageUrlLength: 8_192,
  tagsPerRecipe: 100,
  tagLength: 128,
  numericAmount: 100_000_000,
} as const

type ValidationMode = "hydrate" | "persist"

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function boundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false
): string | null {
  if (typeof value !== "string" || value.length > maximumLength) return null
  if (!allowEmpty && value.trim().length === 0) return null
  return value
}

function optionalString(
  value: unknown,
  maximumLength: number
): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined
  return boundedString(value, maximumLength)
}

function normalizeLegacyAmount(
  value: unknown
): Ingredient["amount"] | undefined {
  if (value === null) return null
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= RECIPE_DATA_LIMITS.numericAmount
  ) {
    return value
  }
  if (
    typeof value === "string" &&
    value.length <= RECIPE_QUANTITY_LIMITS.authoredQuantityLength
  ) {
    return value
  }
  return undefined
}

function normalizeStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number
): string[] | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null
  const normalized: string[] = []
  for (const entry of value) {
    const parsed = boundedString(entry, maximumLength)
    if (!parsed) return null
    normalized.push(parsed)
  }
  return normalized
}

export function normalizeIngredient(
  value: unknown,
  mode: ValidationMode = "hydrate"
): Ingredient | null {
  if (typeof value === "string") {
    const text = boundedString(
      value,
      RECIPE_DATA_LIMITS.originalTextLength
    )
    return text
      ? { item: text, amount: null, unit: "", originalText: text }
      : null
  }
  if (!isRecord(value)) return null

  const item = boundedString(value.item, RECIPE_DATA_LIMITS.itemLength)
  const unit = boundedString(
    value.unit,
    RECIPE_QUANTITY_LIMITS.unitLength,
    true
  )
  const amount = normalizeLegacyAmount(value.amount)
  if (!item || unit == null || amount === undefined) return null

  const authoredUnit = optionalString(
    value.authoredUnit,
    RECIPE_QUANTITY_LIMITS.unitLength
  )
  const shoppingCategory = optionalString(
    value.shoppingCategory,
    RECIPE_DATA_LIMITS.categoryLength
  )
  const groupLabel = optionalString(
    value.groupLabel,
    RECIPE_DATA_LIMITS.groupLabelLength
  )
  const modifier = optionalString(
    value.modifier,
    RECIPE_DATA_LIMITS.modifierLength
  )
  const originalText = optionalString(
    value.originalText,
    RECIPE_DATA_LIMITS.originalTextLength
  )
  if (
    mode === "persist" &&
    (authoredUnit === null ||
      shoppingCategory === null ||
      groupLabel === null ||
      modifier === null ||
      originalText === null)
  ) {
    return null
  }

  const alternatives =
    value.alternatives === undefined
      ? undefined
      : normalizeStringArray(
          value.alternatives,
          RECIPE_DATA_LIMITS.alternativesPerIngredient,
          RECIPE_DATA_LIMITS.itemLength
        )
  if (mode === "persist" && alternatives === null) return null

  let quantity = normalizeQuantityV1(value.quantityV1)
  let packageV1 = normalizePackageV1(value.packageV1)
  if (
    mode === "persist" &&
    ((value.quantityV1 !== undefined && !quantity) ||
      (value.packageV1 !== undefined && !packageV1))
  ) {
    return null
  }
  const legacyQuantityMismatch =
    quantity ? !quantityMatchesLegacy(quantity, amount) : false
  const authoredUnitMismatch =
    quantity && authoredUnit
      ? normalizeRecipeUnit(authoredUnit) !== normalizeRecipeUnit(unit)
      : false
  if (
    mode === "persist" &&
    (legacyQuantityMismatch || authoredUnitMismatch)
  ) {
    return null
  }
  if (legacyQuantityMismatch || authoredUnitMismatch) {
    quantity = null
    packageV1 = null
  }

  const normalized: Ingredient = {
    item,
    amount,
    unit,
    ...(quantity ? { quantityV1: quantity } : {}),
    ...(authoredUnit && !authoredUnitMismatch ? { authoredUnit } : {}),
    ...(packageV1 ? { packageV1 } : {}),
    ...(shoppingCategory ? { shoppingCategory } : {}),
    ...(groupLabel ? { groupLabel } : {}),
    ...(modifier ? { modifier } : {}),
    ...(alternatives && alternatives.length > 0 ? { alternatives } : {}),
    ...(originalText ? { originalText } : {}),
  }

  if (normalized.packageV1) {
    const resolved = resolveIngredientQuantity(normalized)
    if (!resolved.packageV1) {
      if (mode === "persist") return null
      delete normalized.packageV1
    }
  }
  return normalized
}

export function normalizeIngredients(
  value: unknown,
  mode: ValidationMode = "hydrate"
): Ingredient[] | null {
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.ingredientsPerRecipe
  ) {
    return mode === "hydrate" ? [] : null
  }
  const normalized: Ingredient[] = []
  for (const ingredient of value) {
    const parsed = normalizeIngredient(ingredient, mode)
    if (!parsed) {
      if (mode === "persist") return null
      continue
    }
    normalized.push(parsed)
  }
  return normalized
}

export function requireIngredientsForPersistence(
  value: unknown
): Ingredient[] {
  const normalized = normalizeIngredients(value, "persist")
  if (!normalized) {
    throw new Error("Ingredient data contains invalid structured metadata")
  }
  return normalized
}

export function normalizeYieldMetadataForHydration(
  value: unknown
): YieldMetadataV1 | null {
  return normalizeYieldMetadataV1(value)
}

function normalizeOptionalInteger(
  value: unknown
): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : undefined
}

function normalizeInstructionGroups(
  value: unknown,
  mode: ValidationMode
): RecipeInstructionGroup[] | null | undefined {
  if (value === undefined || value === null) return value
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe
  ) {
    return undefined
  }
  const groups: RecipeInstructionGroup[] = []
  let totalSteps = 0
  for (const entry of value) {
    if (!isRecord(entry)) return undefined
    if (
      mode === "persist" &&
      Object.keys(entry).some((key) => !["label", "steps"].includes(key))
    ) {
      return undefined
    }
    const label = optionalString(
      entry.label,
      RECIPE_DATA_LIMITS.groupLabelLength
    )
    const steps = normalizeStringArray(
      entry.steps,
      RECIPE_DATA_LIMITS.instructionsPerRecipe,
      RECIPE_DATA_LIMITS.instructionLength
    )
    if (
      label === null ||
      !steps ||
      (mode === "persist" &&
        entry.label !== undefined &&
        (typeof entry.label !== "string" || !label))
    ) {
      return undefined
    }
    totalSteps += steps.length
    if (totalSteps > RECIPE_DATA_LIMITS.instructionsPerRecipe) {
      return undefined
    }
    groups.push({
      ...(label ? { label } : {}),
      steps,
    })
  }
  return groups
}

export function normalizeRecipeShareSnapshot(
  value: unknown,
  mode: ValidationMode = "hydrate"
): RecipeShareSnapshot | null {
  if (!isRecord(value)) return null
  const name = boundedString(value.name, RECIPE_DATA_LIMITS.recipeNameLength)
  const category = boundedString(
    value.category,
    RECIPE_DATA_LIMITS.categoryLength
  )
  const servings =
    Number.isSafeInteger(value.servings) &&
    Number(value.servings) > 0 &&
    Number(value.servings) <= RECIPE_QUANTITY_LIMITS.yieldValue
      ? Number(value.servings)
      : null
  const tags = normalizeStringArray(
    value.tags,
    RECIPE_DATA_LIMITS.tagsPerRecipe,
    RECIPE_DATA_LIMITS.tagLength
  )
  const instructions = normalizeStringArray(
    value.instructions,
    RECIPE_DATA_LIMITS.instructionsPerRecipe,
    RECIPE_DATA_LIMITS.instructionLength
  )
  const ingredients = normalizeIngredients(value.ingredients, mode)
  const parsedImageUrl =
    value.image_url === null
      ? null
      : boundedString(
          value.image_url,
          RECIPE_DATA_LIMITS.imageUrlLength,
          true
        )
  if (
    !name ||
    !category ||
    !servings ||
    !tags ||
    !instructions ||
    !ingredients ||
    (mode === "persist" &&
      value.image_url !== undefined &&
      value.image_url !== null &&
      parsedImageUrl === null)
  ) {
    return null
  }
  const imageUrl = parsedImageUrl?.trim() ? parsedImageUrl : null

  const yieldMetadata = normalizeYieldMetadataV1(value.yield_metadata)
  if (
    mode === "persist" &&
    value.yield_metadata !== undefined &&
    value.yield_metadata !== null &&
    !yieldMetadata
  ) {
    return null
  }
  const parsedPrepTime = normalizeOptionalInteger(value.prep_time_minutes)
  const parsedCookTime = normalizeOptionalInteger(value.cook_time_minutes)
  const parsedTotalTime = normalizeOptionalInteger(value.total_time_minutes)
  if (
    mode === "persist" &&
    ((value.prep_time_minutes !== undefined && parsedPrepTime === undefined) ||
      (value.cook_time_minutes !== undefined && parsedCookTime === undefined) ||
      (value.total_time_minutes !== undefined && parsedTotalTime === undefined))
  ) {
    return null
  }
  const prepTime = parsedPrepTime ?? null
  const cookTime = parsedCookTime ?? null
  const totalTime = parsedTotalTime ?? null

  const parsedNotes =
    value.notes === undefined || value.notes === null
      ? []
      : normalizeStringArray(
          value.notes,
          RECIPE_DATA_LIMITS.instructionsPerRecipe,
          RECIPE_DATA_LIMITS.instructionLength
        )
  if (mode === "persist" && !parsedNotes) return null
  const notes = parsedNotes || []
  const parsedInstructionGroups = normalizeInstructionGroups(
    value.instruction_groups,
    mode
  )
  if (
    mode === "persist" &&
    value.instruction_groups !== undefined &&
    parsedInstructionGroups === undefined
  ) {
    return null
  }
  const instructionGroups = parsedInstructionGroups ?? null

  return {
    name,
    category,
    servings,
    tags,
    ingredients,
    instructions,
    image_url: imageUrl,
    yield_metadata: yieldMetadata,
    prep_time_minutes: prepTime,
    cook_time_minutes: cookTime,
    total_time_minutes: totalTime,
    notes,
    instruction_groups: instructionGroups,
  }
}

export function recipeShareSnapshotForDisplay(
  value: unknown
): RecipeShareSnapshot {
  return normalizeRecipeShareSnapshot(value, "hydrate") || {
    name: "Shared recipe",
    category: "uncategorized",
    servings: 4,
    tags: [],
    ingredients: [],
    instructions: [],
    image_url: null,
    yield_metadata: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    notes: [],
    instruction_groups: null,
  }
}

function normalizeShoppingSource(
  value: unknown,
  mode: ValidationMode
): NonNullable<ShoppingItem["sources"]>[number] | null {
  if (!isRecord(value)) return null
  const recipeName = boundedString(
    value.recipeName,
    RECIPE_DATA_LIMITS.recipeNameLength
  )
  if (!recipeName) return null
  let exactQuantity = normalizeQuantityV1(value.exactQuantityV1)
  const exactScale = normalizeScaleRatioV1(value.exactScaleV1)
  let exactPackage = normalizePackageV1(value.exactPackageV1)
  const parsedExactAuthoredUnit = optionalString(
    value.exactAuthoredUnit,
    RECIPE_QUANTITY_LIMITS.unitLength
  )
  if (
    mode === "persist" &&
    (parsedExactAuthoredUnit === null ||
      (value.exactQuantityV1 !== undefined && !exactQuantity) ||
      (value.exactScaleV1 !== undefined && !exactScale) ||
      (value.exactPackageV1 !== undefined && !exactPackage))
  ) {
    return null
  }
  const exactAuthoredUnit = parsedExactAuthoredUnit || undefined
  if (
    exactPackage &&
    (!exactQuantity ||
      !formatStructuredRecipeQuantity(
        exactQuantity,
        exactAuthoredUnit || "",
        exactPackage
      ))
  ) {
    if (mode === "persist") return null
    exactPackage = null
  }
  const optionalFields = [
    ["recipeId", RECIPE_DATA_LIMITS.itemLength],
    ["recipeUuid", RECIPE_DATA_LIMITS.itemLength],
    ["legacyRecipeId", RECIPE_DATA_LIMITS.itemLength],
    ["originalItem", RECIPE_DATA_LIMITS.itemLength],
    ["originalUnit", RECIPE_QUANTITY_LIMITS.unitLength],
    ["originalText", RECIPE_DATA_LIMITS.originalTextLength],
    ["prepIntent", RECIPE_DATA_LIMITS.modifierLength],
  ] as const
  const strings: Record<string, string> = {}
  for (const [key, limit] of optionalFields) {
    const parsed = optionalString(value[key], limit)
    if (parsed === null) {
      if (mode === "persist") return null
      continue
    }
    if (parsed) strings[key] = parsed
  }
  const originalAmount =
    value.originalAmount === null ||
    (typeof value.originalAmount === "number" &&
      Number.isFinite(value.originalAmount) &&
      Math.abs(value.originalAmount) <= RECIPE_DATA_LIMITS.numericAmount)
      ? value.originalAmount
      : undefined
  if (value.originalAmount !== undefined && originalAmount === undefined) {
    if (mode === "persist") return null
  }
  const structuredCoherent = shoppingStructuredMetadataIsCoherent({
    quantity: exactQuantity,
    packageV1: exactPackage,
    authoredUnit: exactAuthoredUnit,
    amount: originalAmount,
    unit: strings.originalUnit,
  })
  if (!structuredCoherent) {
    if (mode === "persist") return null
    exactQuantity = null
    exactPackage = null
  }
  const preparationModifiers =
    value.preparationModifiers === undefined
      ? undefined
      : normalizeStringArray(
          value.preparationModifiers,
          RECIPE_DATA_LIMITS.alternativesPerIngredient,
          RECIPE_DATA_LIMITS.modifierLength
        )
  if (
    mode === "persist" &&
    (preparationModifiers === null ||
      (value.optional !== undefined && typeof value.optional !== "boolean"))
  ) {
    return null
  }
  return {
    recipeName,
    ...strings,
    ...(originalAmount !== undefined ? { originalAmount } : {}),
    ...(exactQuantity ? { exactQuantityV1: exactQuantity } : {}),
    ...(exactScale && structuredCoherent ? { exactScaleV1: exactScale } : {}),
    ...(exactPackage ? { exactPackageV1: exactPackage } : {}),
    ...(exactAuthoredUnit && structuredCoherent ? { exactAuthoredUnit } : {}),
    ...(preparationModifiers ? { preparationModifiers } : {}),
    ...(typeof value.optional === "boolean"
      ? { optional: value.optional }
      : {}),
  } as NonNullable<ShoppingItem["sources"]>[number] & { recipeUuid?: string }
}

function normalizeAdditionalAmounts(
  value: unknown
): ShoppingItem["additionalAmounts"] | null | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.alternativesPerIngredient
  ) {
    return null
  }
  const normalized: NonNullable<ShoppingItem["additionalAmounts"]> = []
  for (const entry of value) {
    if (!isRecord(entry)) return null
    const amount =
      typeof entry.amount === "number" &&
      Number.isFinite(entry.amount) &&
      Math.abs(entry.amount) <= RECIPE_DATA_LIMITS.numericAmount
        ? entry.amount
        : null
    const unit = boundedString(
      entry.unit,
      RECIPE_QUANTITY_LIMITS.unitLength,
      true
    )
    if (amount === null || unit === null) return null
    normalized.push({ amount, unit })
  }
  return normalized
}

function shoppingStructuredMetadataIsCoherent({
  quantity,
  packageV1,
  authoredUnit,
  amount,
  unit,
}: {
  quantity: ReturnType<typeof normalizeQuantityV1>
  packageV1: ReturnType<typeof normalizePackageV1>
  authoredUnit?: string
  amount: Ingredient["amount"] | undefined
  unit?: string
}): boolean {
  if (!quantity) return !packageV1
  if (amount === undefined) return false
  const quantityMatches =
    quantity.kind === "range"
      ? amount === null
      : quantityMatchesLegacy(quantity, amount)
  if (!quantityMatches) return false
  if (packageV1) {
    return (
      packageMatchesCompatibilityUnit(packageV1, unit) &&
      packageMatchesCompatibilityUnit(
        packageV1,
        authoredUnit || unit
      )
    )
  }
  return (
    typeof unit === "string" &&
    normalizeRecipeUnit(authoredUnit || unit) === normalizeRecipeUnit(unit)
  )
}

export function normalizeShoppingItem(
  value: unknown,
  mode: ValidationMode = "hydrate"
): ShoppingItem | null {
  if (!isRecord(value)) return null
  const item = boundedString(value.item, RECIPE_DATA_LIMITS.itemLength)
  const amount = normalizeLegacyAmount(value.amount)
  const unit = boundedString(
    value.unit,
    RECIPE_QUANTITY_LIMITS.unitLength,
    true
  )
  const categoryKey = boundedString(
    value.categoryKey,
    RECIPE_DATA_LIMITS.categoryLength
  )
  if (
    !item ||
    amount === undefined ||
    typeof amount === "string" ||
    unit == null ||
    !categoryKey ||
    !Number.isFinite(value.categoryOrder)
  ) {
    return null
  }
  const rawSources = value.sources
  const sources: NonNullable<ShoppingItem["sources"]> = []
  if (rawSources !== undefined) {
    if (
      !Array.isArray(rawSources) ||
      rawSources.length > RECIPE_DATA_LIMITS.sourcesPerShoppingItem
    ) {
      return null
    }
    for (const source of rawSources) {
      const parsed = normalizeShoppingSource(source, mode)
      if (!parsed) {
        if (mode === "persist") return null
        continue
      }
      sources.push(parsed)
    }
  }
  let exactQuantity = normalizeQuantityV1(value.exactQuantityV1)
  let exactPackage = normalizePackageV1(value.exactPackageV1)
  const parsedExactAuthoredUnit = optionalString(
    value.exactAuthoredUnit,
    RECIPE_QUANTITY_LIMITS.unitLength
  )
  const parsedStructuredSourceKey = optionalString(
    value.structuredSourceKey,
    RECIPE_DATA_LIMITS.originalTextLength
  )
  if (
    mode === "persist" &&
    (parsedExactAuthoredUnit === null ||
      parsedStructuredSourceKey === null ||
      (value.exactQuantityV1 !== undefined && !exactQuantity) ||
      (value.exactPackageV1 !== undefined && !exactPackage))
  ) {
    return null
  }
  const exactAuthoredUnit = parsedExactAuthoredUnit || undefined
  const structuredSourceKey = parsedStructuredSourceKey || undefined
  const structuredCoherent = shoppingStructuredMetadataIsCoherent({
    quantity: exactQuantity,
    packageV1: exactPackage,
    authoredUnit: exactAuthoredUnit,
    amount,
    unit,
  })
  if (!structuredCoherent) {
    if (mode === "persist") return null
    exactQuantity = null
    exactPackage = null
  }
  if (
    exactPackage &&
    (!exactQuantity ||
      !formatStructuredRecipeQuantity(
        exactQuantity,
        exactAuthoredUnit || "",
        exactPackage
      ))
  ) {
    if (mode === "persist") return null
    exactPackage = null
  }
  const additionalAmounts = normalizeAdditionalAmounts(value.additionalAmounts)
  const optionalStringFields = [
    ["rowId", RECIPE_DATA_LIMITS.originalTextLength],
    ["shoppingCategory", RECIPE_DATA_LIMITS.categoryLength],
    ["excludedBy", RECIPE_DATA_LIMITS.itemLength],
    ["contributionKey", RECIPE_DATA_LIMITS.originalTextLength],
  ] as const
  const strings: Record<string, string> = {}
  for (const [key, limit] of optionalStringFields) {
    const parsed = optionalString(value[key], limit)
    if (parsed === null) {
      if (mode === "persist") return null
      continue
    }
    if (parsed) strings[key] = parsed
  }
  if (
    mode === "persist" &&
    (additionalAmounts === null ||
      (value.checked !== undefined && typeof value.checked !== "boolean") ||
      (value.legacyRecipeProvenance !== undefined &&
        typeof value.legacyRecipeProvenance !== "boolean") ||
      (value.bucket !== undefined &&
        !["items", "already_have", "excluded"].includes(String(value.bucket))))
  ) {
    return null
  }
  let derivedQuantity: ShoppingItem["derivedQuantity"]
  if (value.derivedQuantity !== undefined) {
    if (!isRecord(value.derivedQuantity)) {
      if (mode === "persist") return null
    } else {
      const derivedAmount = normalizeLegacyAmount(value.derivedQuantity.amount)
      const derivedUnit = boundedString(
        value.derivedQuantity.unit,
        RECIPE_QUANTITY_LIMITS.unitLength,
        true
      )
      const derivedAdditionalAmounts = normalizeAdditionalAmounts(
        value.derivedQuantity.additionalAmounts
      )
      if (
        derivedAmount === undefined ||
        typeof derivedAmount === "string" ||
        derivedUnit === null ||
        derivedAdditionalAmounts === null
      ) {
        if (mode === "persist") return null
      } else {
        derivedQuantity = {
          amount: derivedAmount,
          unit: derivedUnit,
          ...(derivedAdditionalAmounts
            ? { additionalAmounts: derivedAdditionalAmounts }
            : {}),
        }
      }
    }
  }
  return {
    item,
    amount,
    unit,
    categoryKey,
    categoryOrder: Number(value.categoryOrder),
    ...strings,
    ...(sources.length > 0 ? { sources } : { sources: undefined }),
    ...(additionalAmounts && additionalAmounts.length > 0
      ? { additionalAmounts }
      : {}),
    ...(typeof value.checked === "boolean" ? { checked: value.checked } : {}),
    ...(typeof value.legacyRecipeProvenance === "boolean"
      ? { legacyRecipeProvenance: value.legacyRecipeProvenance }
      : {}),
    ...(derivedQuantity ? { derivedQuantity } : {}),
    ...(exactQuantity ? { exactQuantityV1: exactQuantity } : {}),
    ...(exactPackage ? { exactPackageV1: exactPackage } : {}),
    ...(exactAuthoredUnit && structuredCoherent ? { exactAuthoredUnit } : {}),
    ...(structuredSourceKey && structuredCoherent ? { structuredSourceKey } : {}),
    ...(["items", "already_have", "excluded"].includes(String(value.bucket))
      ? { bucket: value.bucket }
      : {}),
  } as ShoppingItem & { bucket?: "items" | "already_have" | "excluded" }
}

export function normalizeShoppingItems(
  value: unknown,
  mode: ValidationMode = "hydrate"
): ShoppingItem[] | null {
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.shoppingItemsPerList
  ) {
    return mode === "hydrate" ? [] : null
  }
  const normalized: ShoppingItem[] = []
  for (const item of value) {
    const parsed = normalizeShoppingItem(item, mode)
    if (!parsed) {
      if (mode === "persist") return null
      continue
    }
    normalized.push(parsed)
  }
  return normalized
}
