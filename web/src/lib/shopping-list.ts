/**
 * Shopping list generation business logic
 * Ported from app.py:788-865
 * Refactored with unit normalization and unified merging
 */

import type { Recipe, ShoppingItem, PantryItem } from "@/types/database"
import { categorizeIngredient, getExcludedKeyword } from "./shopping-categories"
import { normalizeItemName, normalizeUnit } from "./shopping-list-normalization"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"

export interface ShoppingListResult {
  items: ShoppingItem[]
  alreadyHave: ShoppingItem[]
  excluded: ShoppingItem[]
  scale: number
  totalServings: number
}

/**
 * Generate a shopping list from selected recipes with optional scaling.
 *
 * @param recipes - The recipes to generate the shopping list from
 * @param pantryItems - Items already in the pantry
 * @param excludedKeywords - Keywords for items to auto-exclude
 * @param scale - Multiplier for servings (default 1.0)
 */
export function generateShoppingList(
  recipes: Recipe[],
  pantryItems: PantryItem[],
  excludedKeywords: string[],
  scale: number = 1.0
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
      sources: { recipeId: string; recipeName: string }[]
      additionalAmounts?: { amount: number; unit: string }[]
    }
  >()

  let totalBaseServings = 0

  for (const recipe of recipes) {
    totalBaseServings += recipe.servings || 4

    for (const ingredient of recipe.ingredients || []) {
      // Normalize item name and unit
      const itemName = normalizeItemName(ingredient.item)
      const amount = (ingredient.amount || 0) * scale
      const unit = normalizeUnit(ingredient.unit || "")
      const shoppingCategory = ingredient.shoppingCategory

      // Use normalized item name as key (merge by item, not item+unit)
      const key = itemName

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key)!
        
        // Try to merge amounts
        const mergeResult = mergeAmounts(existing.amount, existing.unit, amount, unit)
        
        if (mergeResult) {
          // Units are compatible, merge amounts
          existing.amount = mergeResult.amount
          existing.unit = mergeResult.unit
          existing.additionalAmounts = undefined // Clear if we successfully merged
        } else {
          // Units are incompatible, use additionalAmounts
          if (!existing.additionalAmounts) {
            existing.additionalAmounts = []
          }
          existing.additionalAmounts.push({ amount, unit })
        }
        
        // Add source (deduplicate by recipeId)
        const hasSource = existing.sources.some(s => s.recipeId === recipe.id)
        if (!hasSource) {
          existing.sources.push({ recipeId: recipe.id, recipeName: recipe.name })
        }
        
        // Keep the first shopping category override encountered
        if (shoppingCategory && !existing.shoppingCategory) {
          existing.shoppingCategory = shoppingCategory
        }
      } else {
        ingredientMap.set(key, {
          item: itemName,
          amount,
          unit,
          shoppingCategory,
          sources: [{ recipeId: recipe.id, recipeName: recipe.name }],
        })
      }
    }
  }

  // Split into shopping list, already have, and excluded
  const shoppingList: ShoppingItem[] = []
  const alreadyHave: ShoppingItem[] = []
  const excluded: ShoppingItem[] = []

  for (const ingredient of ingredientMap.values()) {
    // Categorize the ingredient for sorting
    const [catKey, catOrder] = categorizeIngredient(
      ingredient.item,
      ingredient.shoppingCategory
    )

    const shoppingItem: ShoppingItem = {
      item: ingredient.item, // Already normalized
      amount: ingredient.amount > 0 ? roundForDisplay(ingredient.amount) : null,
      unit: ingredient.unit, // Already normalized
      categoryKey: catKey,
      categoryOrder: catOrder,
      sources: ingredient.sources,
      shoppingCategory: ingredient.shoppingCategory,
      additionalAmounts: ingredient.additionalAmounts?.map(a => ({
        amount: roundForDisplay(a.amount),
        unit: a.unit, // Already normalized
      })),
    }

    if (pantrySet.has(ingredient.item)) {
      alreadyHave.push(shoppingItem)
    } else {
      const matchingKeyword = getExcludedKeyword(ingredient.item, excludedKeywords)
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

  shoppingList.sort(sortFn)
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
export function sortShoppingList(items: ShoppingItem[]): ShoppingItem[] {
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
