/**
 * Shopping list generation business logic
 * Ported from app.py:788-865
 */

import type { Recipe, ShoppingItem, PantryItem } from "@/types/database"
import { categorizeIngredient, isExcludedIngredient } from "./shopping-categories"

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
  const ingredientMap = new Map<
    string,
    {
      item: string
      amount: number
      unit: string
      shoppingCategory?: string
      sources: { recipeName: string }[]
    }
  >()

  let totalBaseServings = 0

  for (const recipe of recipes) {
    totalBaseServings += recipe.servings || 4

    for (const ingredient of recipe.ingredients || []) {
      const itemName = ingredient.item.toLowerCase().trim()
      const amount = (ingredient.amount || 0) * scale
      const unit = ingredient.unit || ""
      const shoppingCategory = ingredient.shoppingCategory

      const key = `${itemName}|${unit}`

      if (ingredientMap.has(key)) {
        const existing = ingredientMap.get(key)!
        existing.amount += amount
        existing.sources.push({ recipeName: recipe.name })
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
          sources: [{ recipeName: recipe.name }],
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
      item: ingredient.item,
      amount: ingredient.amount > 0 ? ingredient.amount : null,
      unit: ingredient.unit,
      categoryKey: catKey,
      categoryOrder: catOrder,
      sources: ingredient.sources,
      shoppingCategory: ingredient.shoppingCategory,
    }

    if (pantrySet.has(ingredient.item)) {
      alreadyHave.push(shoppingItem)
    } else if (isExcludedIngredient(ingredient.item, excludedKeywords)) {
      excluded.push(shoppingItem)
    } else {
      shoppingList.push(shoppingItem)
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
 */
export function ensureCategoryInfo(item: ShoppingItem): ShoppingItem {
  if (item.categoryKey && item.categoryOrder !== undefined) {
    return item
  }

  const [catKey, catOrder] = categorizeIngredient(
    item.item,
    item.shoppingCategory
  )

  return {
    ...item,
    categoryKey: catKey,
    categoryOrder: catOrder,
  }
}
