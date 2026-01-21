/**
 * Unified shopping list merging logic
 * Handles merging of items with consistent normalization and override preservation
 */

import type { ShoppingItem } from "@/types/database"
import { normalizeItemName, normalizeUnit } from "./shopping-list-normalization"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"
import { ensureCategoryInfo } from "./shopping-list"

export interface MergeOptions {
  preserveUserOverrides?: boolean
  preserveCustomOrder?: boolean
  userCategoryOverrides?: Record<string, string> | null
}

/**
 * Merge new shopping items into existing items
 * 
 * Rules:
 * 1. Normalize all item names and units before comparison
 * 2. Merge by normalized item name (case-insensitive)
 * 3. Merge compatible units using mergeAmounts()
 * 4. Incompatible units → use additionalAmounts[]
 * 5. Combine sources[] arrays (deduplicate by recipeId)
 * 6. Preserve user overrides if preserveUserOverrides === true
 * 7. Preserve custom order if preserveCustomOrder === true
 */
export function mergeShoppingItems(
  existing: ShoppingItem[],
  newItems: ShoppingItem[],
  options: MergeOptions = {}
): ShoppingItem[] {
  const {
    preserveUserOverrides = false,
    preserveCustomOrder = false,
    userCategoryOverrides = null,
  } = options

  // Create a map of existing items by normalized item name
  const existingMap = new Map<string, ShoppingItem>()
  for (const item of existing) {
    const key = normalizeItemName(item.item)
    const existingItem = existingMap.get(key)
    
    if (existingItem) {
      // If multiple items with same name exist, merge them first
      const merged = mergeTwoItems(existingItem, item, userCategoryOverrides)
      existingMap.set(key, merged)
    } else {
      existingMap.set(key, item)
    }
  }

  // Merge new items into existing
  for (const newItem of newItems) {
    const key = normalizeItemName(newItem.item)
    const existingItem = existingMap.get(key)

    if (existingItem) {
      // Merge with existing item
      const merged = mergeTwoItems(
        existingItem,
        newItem,
        userCategoryOverrides,
        preserveUserOverrides
      )
      existingMap.set(key, merged)
    } else {
      // New item, ensure it has category info
      const itemWithCategory = ensureCategoryInfo(newItem, userCategoryOverrides)
      // Normalize unit
      const normalizedItem: ShoppingItem = {
        ...itemWithCategory,
        item: normalizeItemName(itemWithCategory.item),
        unit: normalizeUnit(itemWithCategory.unit),
      }
      existingMap.set(key, normalizedItem)
    }
  }

  const mergedItems = Array.from(existingMap.values())

  // Sort if not preserving custom order
  if (!preserveCustomOrder) {
    mergedItems.sort((a, b) => {
      if (a.categoryOrder !== b.categoryOrder) {
        return a.categoryOrder - b.categoryOrder
      }
      return a.item.localeCompare(b.item)
    })
  }

  return mergedItems
}

/**
 * Merge two shopping items into one
 */
function mergeTwoItems(
  item1: ShoppingItem,
  item2: ShoppingItem,
  userCategoryOverrides?: Record<string, string> | null,
  preserveUserOverrides = false
): ShoppingItem {
  // Normalize both items
  const normalized1: ShoppingItem = {
    ...item1,
    item: normalizeItemName(item1.item),
    unit: normalizeUnit(item1.unit),
  }
  const normalized2: ShoppingItem = {
    ...item2,
    item: normalizeItemName(item2.item),
    unit: normalizeUnit(item2.unit),
  }

  // Merge sources (deduplicate by recipeId or recipeName)
  const sourceMap = new Map<string, { recipeId: string; recipeName: string }>()
  
  for (const source of normalized1.sources || []) {
    const key = (source as any).recipeId || source.recipeName
    sourceMap.set(key, {
      recipeId: (source as any).recipeId || "",
      recipeName: source.recipeName,
    })
  }
  
  for (const source of normalized2.sources || []) {
    const key = (source as any).recipeId || source.recipeName
    if (!sourceMap.has(key)) {
      sourceMap.set(key, {
        recipeId: (source as any).recipeId || "",
        recipeName: source.recipeName,
      })
    }
  }

  const combinedSources = Array.from(sourceMap.values())

  // Merge amounts
  const mergeResult = mergeAmounts(
    normalized1.amount,
    normalized1.unit,
    normalized2.amount,
    normalized2.unit
  )

  // Determine which item to use as base (preserve overrides if requested)
  const baseItem = preserveUserOverrides ? normalized1 : normalized2

  // Determine category (preserve from base item if preserving overrides)
  let categoryKey = baseItem.categoryKey
  let categoryOrder = baseItem.categoryOrder

  // Apply user category overrides if provided
  if (userCategoryOverrides) {
    const override = userCategoryOverrides[normalized1.item]
    if (override) {
      // Get category order from shopping-categories
      const { categorizeIngredient } = require("./shopping-categories")
      const [catKey, catOrder] = categorizeIngredient(normalized1.item, override, userCategoryOverrides)
      categoryKey = catKey
      categoryOrder = catOrder
    }
  }

  if (mergeResult) {
    // Units are compatible, merge amounts
    return {
      ...baseItem,
      item: normalized1.item,
      amount: roundForDisplay(mergeResult.amount),
      unit: mergeResult.unit,
      categoryKey,
      categoryOrder,
      sources: combinedSources,
      additionalAmounts: undefined, // Clear additional amounts if we successfully merged
    }
  } else {
    // Units are incompatible, use additionalAmounts
    const existingAdditional = normalized1.additionalAmounts || []
    const newAdditional = normalized2.amount
      ? [{ amount: normalized2.amount, unit: normalized2.unit }]
      : []

    return {
      ...baseItem,
      item: normalized1.item,
      amount: normalized1.amount,
      unit: normalized1.unit,
      categoryKey,
      categoryOrder,
      sources: combinedSources,
      additionalAmounts: [...existingAdditional, ...newAdditional],
    }
  }
}

/**
 * Remove a recipe from shopping items
 * Returns items with the recipe removed from sources, and items with no sources removed
 */
export function removeRecipeFromItems(
  items: ShoppingItem[],
  recipeId: string
): ShoppingItem[] {
  return items
    .map((item) => {
      // Remove recipe from sources
      const updatedSources = (item.sources || []).filter((source) => {
        // Support both recipeId and recipeName matching
        const sourceId = (source as any).recipeId
        const sourceName = source.recipeName
        
        // If we have recipeId, match by ID; otherwise match by name
        if (sourceId) {
          return sourceId !== recipeId
        }
        // For backward compatibility, if no recipeId, we can't match by ID
        // This will be handled by the caller providing recipe name
        return true
      })

      return {
        ...item,
        sources: updatedSources,
      }
    })
    .filter((item) => {
      // Remove items with no sources (unless they're manual)
      const hasSources = (item.sources || []).length > 0
      const isManual = (item.sources || []).some(
        (s) => s.recipeName === "Manual"
      )
      return hasSources || isManual
    })
}

/**
 * Remove a recipe by name (for backward compatibility)
 */
export function removeRecipeByNameFromItems(
  items: ShoppingItem[],
  recipeName: string
): ShoppingItem[] {
  return items
    .map((item) => {
      const updatedSources = (item.sources || []).filter(
        (s) => s.recipeName !== recipeName
      )
      return {
        ...item,
        sources: updatedSources,
      }
    })
    .filter((item) => {
      const hasSources = (item.sources || []).length > 0
      const isManual = (item.sources || []).some(
        (s) => s.recipeName === "Manual"
      )
      return hasSources || isManual
    })
}
