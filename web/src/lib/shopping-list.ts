/**
 * Shopping list generation business logic
 * Ported from app.py:788-865
 * Refactored with unit normalization and unified merging
 */

import type { Recipe, ShoppingItem, PantryItem } from "@/types/database"
import { categorizeIngredient, getExcludedKeyword } from "./shopping-categories"
import {
  normalizeItemName,
  normalizeShoppingPurchase,
  normalizeUnit,
} from "./shopping-list-normalization"
import type { ShoppingItemOrderPreferences } from "./shopping-item-order"
import { sortShoppingItemsByPreferences } from "./shopping-item-order"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"

export interface ShoppingListResult {
  items: ShoppingItem[]
  alreadyHave: ShoppingItem[]
  excluded: ShoppingItem[]
  scale: number
  totalServings: number
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
  shoppingItemOrder?: ShoppingItemOrderPreferences | null
): ShoppingListResult {
  // Get pantry items as a set for quick lookup
  const pantrySet = new Set(
    pantryItems.map((p) => p.item.toLowerCase().trim())
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
      citrusPrepByRecipe?: Map<string, CitrusPrepNeeds>
    }
  >()

  let totalBaseServings = 0

  for (const recipe of recipes) {
    totalBaseServings += recipe.servings || 4

    for (const ingredient of recipe.ingredients || []) {
      const purchase = normalizeShoppingPurchase({
        item: ingredient.item,
        amount: ingredient.amount,
        unit: ingredient.unit || "",
      })
      const itemName = purchase.purchaseName
      const amount = (purchase.purchaseQuantity || 0) * scale
      const unit = normalizeUnit(purchase.purchaseUnit || "")
      const shoppingCategory = ingredient.shoppingCategory
      const recipeKey = recipe.id || recipe.name
      const source = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        originalItem: purchase.originalName,
        originalAmount: purchase.originalQuantity,
        originalUnit: purchase.originalUnit,
        prepIntent: purchase.prepIntent,
      }

      // Build display name with alternatives if present (normalized to lowercase)
      const displayItem = ingredient.alternatives?.length
        ? `${itemName} (or ${ingredient.alternatives.map(a => normalizeItemName(a)).join(', ')})`
        : itemName

      // Use normalized item name as key (merge by item, not item+unit)
      const key = itemName

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key)!
        let amountToMerge = amount

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
          existing.additionalAmounts = undefined // Clear if we successfully merged
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
          citrusPrepByRecipe,
        })
      }
    }
  }

  // Split into shopping list, already have, and excluded
  const shoppingList: ShoppingItem[] = []
  const alreadyHave: ShoppingItem[] = []
  const excluded: ShoppingItem[] = []

  for (const [primaryKey, ingredient] of ingredientMap.entries()) {
    // Categorize the ingredient for sorting (apply user overrides)
    const [catKey, catOrder] = categorizeIngredient(
      ingredient.item,
      ingredient.shoppingCategory,
      userCategoryOverrides
    )

    const shoppingItem: ShoppingItem = {
      item: ingredient.item, // Normalized to lowercase
      amount: ingredient.amount > 0 ? roundForDisplay(ingredient.amount) : null,
      unit: ingredient.unit, // Normalized
      categoryKey: catKey,
      categoryOrder: catOrder,
      sources: ingredient.sources,
      shoppingCategory: ingredient.shoppingCategory,
      additionalAmounts: ingredient.additionalAmounts?.map(a => ({
        amount: roundForDisplay(a.amount),
        unit: a.unit, // Normalized
      })),
    }

    // Check pantry: match primary item key or any alternative
    const isInPantry =
      pantrySet.has(primaryKey) ||
      (ingredient.alternatives?.some(alt => pantrySet.has(alt)) ?? false)

    if (isInPantry) {
      alreadyHave.push(shoppingItem)
    } else {
      const matchingKeyword = getExcludedKeyword(primaryKey, excludedKeywords)
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
