/**
 * Shopping list generation business logic
 * Ported from app.py:788-865
 * Refactored with unit normalization and unified merging
 */

import type {
  PantryItem,
  RationalV1,
  Recipe,
  ShoppingItem,
} from "@/types/database"
import { categorizeIngredient, getExcludedKeyword } from "./shopping-categories"
import {
  createShoppingPurchaseKey,
  normalizeItemName,
  normalizeShoppingPurchase,
  normalizeUnit,
} from "./shopping-list-normalization"
import type { ShoppingItemOrderPreferences } from "./shopping-item-order"
import { sortShoppingItemsByPreferences } from "./shopping-item-order"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"
import { getIngredientQuantityRange } from "./recipe-parser"
import {
  normalizeScaleRatioV1,
  parseRationalLexeme,
  rationalToNumber,
  resolveIngredientQuantity,
  scalePackageV1,
  scaleQuantityV1,
} from "./recipe-quantity"

export interface ShoppingListResult {
  items: ShoppingItem[]
  alreadyHave: ShoppingItem[]
  excluded: ShoppingItem[]
  scale: number
  totalServings: number
}

const EXACT_RECIPE_FRACTIONS = [
  1 / 6,
  1 / 5,
  1 / 3,
  2 / 5,
  3 / 5,
  2 / 3,
  4 / 5,
  5 / 6,
]

function roundShoppingQuantity(value: number, preserveExactFraction: boolean): number {
  if (preserveExactFraction) {
    const whole = Math.floor(value)
    const fractional = value - whole
    const exactFraction = EXACT_RECIPE_FRACTIONS.find(
      (candidate) => Math.abs(fractional - candidate) < 0.000001
    )
    if (exactFraction !== undefined) {
      return whole + exactFraction
    }
  }

  return roundForDisplay(value)
}

function mergeIntoAdditionalAmounts(
  existing: { amount: number; unit: string }[] | undefined,
  amount: number,
  unit: string
): { amount: number; unit: string }[] {
  const next = [...(existing || [])]

  for (let index = 0; index < next.length; index++) {
    const merged = mergeAmounts(next[index].amount, next[index].unit, amount, unit)
    if (merged) {
      next[index] = {
        amount: merged.amount,
        unit: merged.unit,
      }
      return next
    }
  }

  next.push({ amount, unit })
  return next
}

function createSourceKey(source: NonNullable<ShoppingItem["sources"]>[number]): string {
  return [
    source.recipeId || source.recipeName,
    normalizeItemName(source.originalItem || ""),
    normalizeUnit(source.originalUnit || ""),
    source.prepIntent || "",
    source.optional ? "optional" : "required",
    source.originalText || "",
  ].join("|")
}

function addSource(
  sources: NonNullable<ShoppingItem["sources"]>,
  source: NonNullable<ShoppingItem["sources"]>[number]
) {
  const sourceKey = createSourceKey(source)
  if (!sources.some((candidate) => createSourceKey(candidate) === sourceKey)) {
    sources.push(source)
  }
}

type CitrusPrepNeeds = {
  juiced: number
  zested: number
}

function isOverlappingCitrusPrep(
  itemName: string,
  unit: string,
  prepIntent?: string
): prepIntent is "juiced" | "zested" {
  return (
    (itemName === "lemon" || itemName === "lime") &&
    unit === "count" &&
    (prepIntent === "juiced" || prepIntent === "zested")
  )
}

function getCitrusAmountToMerge(
  prepByRecipe: Map<string, CitrusPrepNeeds>,
  recipeKey: string,
  prepIntent: "juiced" | "zested",
  amount: number
): number {
  const previous = prepByRecipe.get(recipeKey) || { juiced: 0, zested: 0 }
  const previousApplied = Math.max(previous.juiced, previous.zested)
  const next = {
    ...previous,
    [prepIntent]: previous[prepIntent] + amount,
  }
  prepByRecipe.set(recipeKey, next)

  return Math.max(next.juiced, next.zested) - previousApplied
}

/**
 * Generate a shopping list from selected recipes with optional scaling.
 *
 * @param recipes - The recipes to generate the shopping list from
 * @param pantryItems - Items already in the pantry
 * @param excludedKeywords - Keywords for items to auto-exclude
 * @param scale - Multiplier for servings (default 1.0)
 * @param userCategoryOverrides - Optional user category overrides (item name -> category key)
 */
export function generateShoppingList(
  recipes: Recipe[],
  pantryItems: PantryItem[],
  excludedKeywords: string[],
  scale: number = 1.0,
  userCategoryOverrides?: Record<string, string> | null,
  shoppingItemOrder?: ShoppingItemOrderPreferences | null,
  exactScaleV1?: RationalV1
): ShoppingListResult {
  // Get pantry items as a set for quick lookup
  const pantrySet = new Set(
    pantryItems.map((p) => createShoppingPurchaseKey(p.item))
  )

  // Aggregate ingredients from selected recipes
  // Use normalized item name as key (not item+unit) to merge same items with different units
  const ingredientMap = new Map<
    string,
    {
      item: string
      amount: number
      unit: string
      shoppingCategory?: string
      sources: NonNullable<ShoppingItem["sources"]>
      additionalAmounts?: { amount: number; unit: string }[]
      alternatives?: string[]
      identityKey: string
      categoryKey: string
      categoryOrder: number
      citrusPrepByRecipe?: Map<string, CitrusPrepNeeds>
      preserveExactFraction: boolean
      exactQuantityV1?: ShoppingItem["exactQuantityV1"]
      exactPackageV1?: ShoppingItem["exactPackageV1"]
      exactAuthoredUnit?: string
      structuredSourceKey?: string
    }
  >()

  let totalBaseServings = 0
  const validatedScale =
    normalizeScaleRatioV1(exactScaleV1) ||
    normalizeScaleRatioV1(parseRationalLexeme(String(scale))) ||
    undefined

  for (const recipe of recipes) {
    totalBaseServings += recipe.servings || 4

    for (const [ingredientIndex, ingredient] of (
      recipe.ingredients || []
    ).entries()) {
      const quantityRange = getIngredientQuantityRange(ingredient.amount)
      const resolved = resolveIngredientQuantity(ingredient)
      const structuredScale =
        resolved.quantity?.kind === "exact" ||
        resolved.quantity?.kind === "range"
          ? validatedScale
          : undefined
      const exactQuantity =
        structuredScale && resolved.quantity
          ? scaleQuantityV1(resolved.quantity, structuredScale)
          : undefined
      const exactPackage =
        structuredScale && resolved.packageV1
          ? scalePackageV1(resolved.packageV1, structuredScale) || undefined
          : undefined
      const sourceAwareStructured =
        exactQuantity?.kind === "range" || Boolean(exactPackage)
      const exactScalarAmount =
        exactQuantity?.kind === "exact"
          ? rationalToNumber(exactQuantity.value)
          : null
      const compatibilityUnit = exactPackage
        ? `${exactPackage.type} (${exactPackage.size.lexeme} ${exactPackage.size.authoredUnit})`
        : ingredient.unit || ""
      const purchase = normalizeShoppingPurchase({
        item: ingredient.item,
        amount:
          exactQuantity
            ? exactScalarAmount
            : typeof ingredient.amount === "number"
              ? ingredient.amount
              : quantityRange?.start ?? null,
        unit: exactQuantity
          ? compatibilityUnit
          : quantityRange
            ? ingredient.unit || ""
            : ingredient.unit || "",
        modifier: ingredient.modifier,
      })
      const itemName = purchase.purchaseName
      const amount = exactQuantity
        ? purchase.purchaseQuantity || 0
        : (purchase.purchaseQuantity || 0) * scale
      const unit = normalizeUnit(purchase.purchaseUnit || "")
      const preserveExactFraction =
        purchase.purchaseQuantity === purchase.originalQuantity &&
        unit === normalizeUnit(purchase.originalUnit || "")
      const shoppingCategory = ingredient.shoppingCategory
      const recipeKey = recipe.id || recipe.name
      const source = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        originalItem: purchase.originalName,
        originalAmount: purchase.originalQuantity,
        originalUnit: purchase.originalUnit,
        prepIntent: purchase.prepIntent,
        preparationModifiers: purchase.canonical.preparationModifiers,
        optional: purchase.canonical.optional,
        originalText: ingredient.originalText,
        exactScaleV1: structuredScale,
        exactQuantityV1: exactQuantity,
        exactPackageV1: exactPackage,
        exactAuthoredUnit: resolved.authoredUnit,
      }

      // Build display name with alternatives if present (normalized to lowercase)
      const displayItem = ingredient.alternatives?.length
        ? `${itemName} (or ${ingredient.alternatives.map(a => normalizeItemName(a)).join(', ')})`
        : itemName

      const [effectiveCategoryKey, effectiveCategoryOrder] = categorizeIngredient(
        displayItem,
        shoppingCategory,
        userCategoryOverrides
      )

      // Category is part of merge compatibility, but not the public purchase key.
      const structuredSourceKey = sourceAwareStructured
        ? `${recipe.id || recipe.name}:${ingredientIndex}`
        : undefined
      const key = `${purchase.canonical.mergeKey}|category:${effectiveCategoryKey}${
        structuredSourceKey ? `|structured:${structuredSourceKey}` : ""
      }`

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key)!
        let amountToMerge = amount
        existing.preserveExactFraction =
          existing.preserveExactFraction && preserveExactFraction && existing.unit === unit

        if (isOverlappingCitrusPrep(itemName, unit, purchase.prepIntent)) {
          existing.citrusPrepByRecipe ||= new Map<string, CitrusPrepNeeds>()
          amountToMerge = getCitrusAmountToMerge(
            existing.citrusPrepByRecipe,
            recipeKey,
            purchase.prepIntent,
            amount
          )
        }
        
        // Try to merge amounts
        const mergeResult = mergeAmounts(existing.amount, existing.unit, amountToMerge, unit)
        
        if (mergeResult) {
          // Units are compatible, merge amounts
          existing.amount = mergeResult.amount
          existing.unit = mergeResult.unit
        } else {
          // Units are incompatible, use additionalAmounts
          existing.additionalAmounts = mergeIntoAdditionalAmounts(
            existing.additionalAmounts,
            amountToMerge,
            unit
          )
        }
        
        addSource(existing.sources, source)
        
        // Keep the first shopping category override encountered
        if (shoppingCategory && !existing.shoppingCategory) {
          existing.shoppingCategory = shoppingCategory
        }
      } else {
        const citrusPrepByRecipe = isOverlappingCitrusPrep(itemName, unit, purchase.prepIntent)
          ? new Map<string, CitrusPrepNeeds>([
              [
                recipeKey,
                {
                  juiced: purchase.prepIntent === "juiced" ? amount : 0,
                  zested: purchase.prepIntent === "zested" ? amount : 0,
                },
              ],
            ])
          : undefined

        ingredientMap.set(key, {
          item: displayItem,
          amount,
          unit,
          shoppingCategory,
          sources: [source],
          alternatives: ingredient.alternatives?.map(a => normalizeItemName(a)),
          identityKey: purchase.canonical.mergeKey,
          categoryKey: effectiveCategoryKey,
          categoryOrder: effectiveCategoryOrder,
          citrusPrepByRecipe,
          preserveExactFraction,
          exactQuantityV1:
            sourceAwareStructured ? exactQuantity : undefined,
          exactPackageV1:
            sourceAwareStructured ? exactPackage : undefined,
          exactAuthoredUnit:
            sourceAwareStructured ? resolved.authoredUnit : undefined,
          structuredSourceKey,
        })
      }
    }
  }

  // Split into shopping list, already have, and excluded
  const shoppingList: ShoppingItem[] = []
  const alreadyHave: ShoppingItem[] = []
  const excluded: ShoppingItem[] = []

  for (const ingredient of ingredientMap.values()) {
    const shoppingItem: ShoppingItem = {
      item: ingredient.item, // Normalized to lowercase
      amount: ingredient.amount > 0
        ? roundShoppingQuantity(ingredient.amount, ingredient.preserveExactFraction)
        : null,
      unit: ingredient.unit, // Normalized
      categoryKey: ingredient.categoryKey,
      categoryOrder: ingredient.categoryOrder,
      sources: ingredient.sources,
      exactQuantityV1: ingredient.exactQuantityV1,
      exactPackageV1: ingredient.exactPackageV1,
      exactAuthoredUnit: ingredient.exactAuthoredUnit,
      structuredSourceKey: ingredient.structuredSourceKey,
      shoppingCategory: ingredient.shoppingCategory,
      additionalAmounts: ingredient.additionalAmounts?.map(a => ({
        amount: roundForDisplay(a.amount),
        unit: a.unit, // Normalized
      })),
    }

    // Check pantry: match primary item key or any alternative
    const isInPantry =
      pantrySet.has(ingredient.identityKey) ||
      (ingredient.alternatives?.some(alt =>
        pantrySet.has(createShoppingPurchaseKey(alt))
      ) ?? false)

    if (isInPantry) {
      alreadyHave.push(shoppingItem)
    } else {
      const matchingKeyword = getExcludedKeyword(
        ingredient.identityKey,
        excludedKeywords
      )
      if (matchingKeyword) {
        excluded.push({
          ...shoppingItem,
          excludedBy: matchingKeyword,
        })
      } else {
        shoppingList.push(shoppingItem)
      }
    }
  }

  // Sort by category order first, then alphabetically within category
  const sortFn = (a: ShoppingItem, b: ShoppingItem) => {
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder
    }
    return a.item.localeCompare(b.item)
  }

  const sortedShoppingList = shoppingItemOrder
    ? sortShoppingItemsByPreferences(shoppingList, shoppingItemOrder)
    : [...shoppingList].sort(sortFn)
  shoppingList.splice(0, shoppingList.length, ...sortedShoppingList)
  alreadyHave.sort(sortFn)
  excluded.sort(sortFn)

  return {
    items: shoppingList,
    alreadyHave,
    excluded,
    scale,
    totalServings: Math.round(totalBaseServings * scale),
  }
}

/**
 * Re-sort a shopping list by category (used when customOrder is false)
 */
export function sortShoppingList(
  items: ShoppingItem[],
  shoppingItemOrder?: ShoppingItemOrderPreferences | null
): ShoppingItem[] {
  if (shoppingItemOrder) {
    return sortShoppingItemsByPreferences(items, shoppingItemOrder)
  }

  return [...items].sort((a, b) => {
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder
    }
    return a.item.localeCompare(b.item)
  })
}

/**
 * Add category info to an item if missing
 * @param item - The shopping item to add category info to
 * @param userOverrides - Optional user category overrides (item name -> category key)
 */
export function ensureCategoryInfo(
  item: ShoppingItem,
  userOverrides?: Record<string, string> | null
): ShoppingItem {
  if (item.categoryKey && item.categoryOrder !== undefined) {
    return item
  }

  const [catKey, catOrder] = categorizeIngredient(
    item.item,
    item.shoppingCategory,
    userOverrides
  )

  return {
    ...item,
    categoryKey: catKey,
    categoryOrder: catOrder,
  }
}
