import type {
  CanonicalIngredient,
  PackageV1,
  QuantityV1,
  RationalV1,
  ShoppingItem,
} from "@/types/database"
import { categorizeIngredient } from "./shopping-categories"
import {
  matchIngredientExclusionFamily,
  type IngredientExclusionFamily,
} from "./ingredient-exclusion-families"
import { getIngredientQuantityRange } from "./recipe-parser"
import {
  normalizeQuantityV1,
  normalizeScaleRatioV1,
  parseRationalLexeme,
  rationalToNumber,
  resolveIngredientQuantity,
  scalePackageV1,
  scaleQuantityV1,
} from "./recipe-quantity"
import { flattenRecipeIngredients } from "./recipe-structure"
import {
  createShoppingPurchaseKey,
  normalizeItemName,
  normalizeShoppingPurchase,
  normalizeUnit,
} from "./shopping-list-normalization"

export type IngredientKey = string
export type AggregateKey = string

export type ShoppingQuantity = {
  amount: number | null
  unit: string
  exactQuantityV1?: QuantityV1
  exactPackageV1?: PackageV1
  exactAuthoredUnit?: string
}

export type ResolvedShoppingIngredient = {
  ingredientKey: IngredientKey
  aggregateKey: AggregateKey
  displayName: string
  quantity: ShoppingQuantity | null
  purchaseUnit: string
  defaultCategoryKey: string
  defaultCategoryOrder: number
  pantryMatchKeys: IngredientKey[]
  exclusionFamily?: IngredientExclusionFamily
  citrusPrep?: "juiced" | "zested"
  sourceOrdinal: number
  runtime: {
    amount: number
    unit: string
    shoppingCategory?: string
    alternatives?: string[]
    preserveExactFraction: boolean
    sourceAwareStructured: boolean
    exactQuantityV1?: ShoppingItem["exactQuantityV1"]
    exactPackageV1?: ShoppingItem["exactPackageV1"]
    exactAuthoredUnit?: string
    exactScaleV1?: RationalV1
    purchase: ReturnType<typeof normalizeShoppingPurchase>
  }
}

export type ResolveShoppingIngredientInput = {
  ingredient: CanonicalIngredient
  scale?: number
  exactScaleV1?: RationalV1
  recipeId?: string
  sourceOrdinal?: number
}

export function createShoppingAggregateDiscriminator(
  recipeId: string | undefined,
  quantity: QuantityV1 | null,
  packageV1: PackageV1 | undefined,
  purchaseUnit: string
): readonly unknown[] | null {
  if (packageV1) {
    return [
      "package",
      recipeId || "unknown-recipe",
      packageV1.type,
      packageV1.size.value.numerator,
      packageV1.size.value.denominator,
      normalizeUnit(packageV1.size.unit),
    ]
  }
  if (quantity?.kind === "range") {
    return [
      "range",
      recipeId || "unknown-recipe",
      normalizeUnit(purchaseUnit),
      quantity.start.numerator,
      quantity.start.denominator,
      quantity.end.numerator,
      quantity.end.denominator,
    ]
  }
  return null
}

export function createShoppingAggregateKey(
  ingredientKey: IngredientKey,
  discriminator: readonly unknown[] | null
): AggregateKey {
  return JSON.stringify(
    discriminator
      ? ["shopping-aggregate", 1, ingredientKey, discriminator]
      : ["shopping-aggregate", 1, ingredientKey]
  )
}

/**
 * The single canonical recipe-ingredient to Shopping-input boundary.
 *
 * The nested `runtime` fields are temporary compatibility output consumed by
 * the current generator. They keep PR 1 behavior-neutral and are not part of
 * ShoppingDocumentV1.
 */
export function resolveShoppingIngredient({
  ingredient,
  scale = 1,
  exactScaleV1,
  recipeId,
  sourceOrdinal = 0,
}: ResolveShoppingIngredientInput): ResolvedShoppingIngredient {
  const quantityRange = getIngredientQuantityRange(ingredient.amount)
  const resolved = resolveIngredientQuantity(ingredient)
  const structuredQuantity = normalizeQuantityV1(resolved.quantity)
  const validatedScale =
    normalizeScaleRatioV1(exactScaleV1) ||
    normalizeScaleRatioV1(parseRationalLexeme(String(scale))) ||
    undefined
  const structuredScale =
    structuredQuantity?.kind === "exact" ||
    structuredQuantity?.kind === "range"
      ? validatedScale
      : undefined
  const exactQuantity =
    structuredScale && structuredQuantity
      ? scaleQuantityV1(structuredQuantity, structuredScale)
      : undefined
  const exactPackage =
    structuredScale && resolved.packageV1
      ? scalePackageV1(resolved.packageV1, structuredScale) || undefined
      : undefined
  const exactScalarAmount =
    exactQuantity?.kind === "exact"
      ? rationalToNumber(exactQuantity.value)
      : null
  const compatibilityUnit = exactPackage
    ? `${exactPackage.type} (${exactPackage.size.lexeme} ${exactPackage.size.authoredUnit})`
    : ingredient.unit || ""
  const purchase = normalizeShoppingPurchase({
    item: ingredient.item,
    amount: exactQuantity
      ? exactScalarAmount
      : typeof ingredient.amount === "number"
        ? ingredient.amount
        : quantityRange?.start ?? null,
    unit: exactQuantity ? compatibilityUnit : ingredient.unit || "",
    modifier: ingredient.modifier,
  })
  const amount = exactQuantity
    ? purchase.purchaseQuantity || 0
    : (purchase.purchaseQuantity || 0) * scale
  const purchaseUnit = normalizeUnit(purchase.purchaseUnit || "")
  const alternatives = ingredient.alternatives?.map(normalizeItemName)
  const displayName = alternatives?.length
    ? `${purchase.purchaseName} (or ${alternatives.join(", ")})`
    : purchase.purchaseName
  const ingredientKey = purchase.canonical.mergeKey
  const pantryMatchKeys = [
    ingredientKey,
    ...(alternatives || []).map((alternative) =>
      createShoppingPurchaseKey(alternative)
    ),
  ].filter((value, index, values) => values.indexOf(value) === index)
  const [defaultCategoryKey, defaultCategoryOrder] = categorizeIngredient(
    displayName,
    ingredient.shoppingCategory
  )
  const sourceAwareStructured =
    exactQuantity?.kind === "range" || Boolean(exactPackage)
  const discriminator = createShoppingAggregateDiscriminator(
    recipeId,
    structuredQuantity,
    resolved.packageV1,
    purchaseUnit
  )
  const exclusionFamily = matchIngredientExclusionFamily(ingredient)
  const citrusPrep =
    (purchase.purchaseName === "lemon" || purchase.purchaseName === "lime") &&
    purchaseUnit === "count" &&
    (purchase.prepIntent === "juiced" || purchase.prepIntent === "zested")
      ? purchase.prepIntent
      : undefined

  return {
    ingredientKey,
    aggregateKey: createShoppingAggregateKey(ingredientKey, discriminator),
    displayName,
    quantity:
      purchase.purchaseQuantity == null && !exactQuantity && !exactPackage
        ? null
        : {
            amount,
            unit: purchaseUnit,
            exactQuantityV1: exactQuantity,
            exactPackageV1: exactPackage,
            exactAuthoredUnit: resolved.authoredUnit || undefined,
          },
    purchaseUnit,
    defaultCategoryKey,
    defaultCategoryOrder,
    pantryMatchKeys,
    exclusionFamily: exclusionFamily || undefined,
    citrusPrep,
    sourceOrdinal,
    runtime: {
      amount,
      unit: purchaseUnit,
      shoppingCategory: ingredient.shoppingCategory,
      alternatives,
      preserveExactFraction:
        purchase.purchaseQuantity === purchase.originalQuantity &&
        purchaseUnit === normalizeUnit(purchase.originalUnit || ""),
      sourceAwareStructured,
      exactQuantityV1: exactQuantity,
      exactPackageV1: sourceAwareStructured ? exactPackage : undefined,
      exactAuthoredUnit: resolved.authoredUnit,
      exactScaleV1: structuredScale,
      purchase,
    },
  }
}

export function resolveRecipeShoppingIngredients(
  ingredientSections: Parameters<typeof flattenRecipeIngredients>[0],
  options: Omit<ResolveShoppingIngredientInput, "ingredient" | "sourceOrdinal"> = {}
): ResolvedShoppingIngredient[] {
  return flattenRecipeIngredients(ingredientSections).map(
    (ingredient, sourceOrdinal) =>
      resolveShoppingIngredient({ ...options, ingredient, sourceOrdinal })
  )
}
