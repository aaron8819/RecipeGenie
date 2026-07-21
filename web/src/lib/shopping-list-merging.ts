/**
 * Unified shopping list merging logic
 * Handles merging of items with consistent normalization and override preservation
 */

import type { ShoppingItem } from "@/types/database"
import {
  createShoppingPurchaseKey,
  normalizeItemName,
  normalizeShoppingPurchase,
  normalizeUnit,
} from "./shopping-list-normalization"
import type { ShoppingItemOrderPreferences } from "./shopping-item-order"
import { sortShoppingItemsByPreferences } from "./shopping-item-order"
import { mergeAmounts, roundForDisplay } from "./unit-conversion"
import { ensureCategoryInfo } from "./shopping-list"
import { categorizeIngredient } from "./shopping-categories"

export interface MergeOptions {
  preserveUserOverrides?: boolean
  preserveCustomOrder?: boolean
  userCategoryOverrides?: Record<string, string> | null
  shoppingItemOrder?: ShoppingItemOrderPreferences | null
}

type ShoppingItemSource = NonNullable<ShoppingItem["sources"]>[number]

function isManualItem(item: ShoppingItem): boolean {
  return Boolean(
    item.sources?.some(
      (source) => source.recipeName === "Manual" && !source.recipeId
    )
  )
}

function createMergeMapKey(
  item: ShoppingItem,
  position: string
): string {
  const identity = createShoppingPurchaseKey(item.item, item.amount, item.unit)
  const category = item.categoryKey || ""
  if (isManualItem(item)) {
    return `${identity}|category:${category}|manual:${item.rowId || position}`
  }
  return `${identity}|category:${category}|recipe`
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
        amount: roundForDisplay(merged.amount),
        unit: merged.unit,
      }
      return next
    }
  }

  next.push({
    amount: roundForDisplay(amount),
    unit,
  })
  return next
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
    shoppingItemOrder = null,
  } = options

  // Create a map of existing items by normalized item name
  const existingMap = new Map<string, ShoppingItem>()
  for (const [index, item] of existing.entries()) {
    const itemWithCategory = ensureCategoryInfo(item, userCategoryOverrides)
    const key = createMergeMapKey(itemWithCategory, `existing:${index}`)
    const existingItem = existingMap.get(key)
    
    if (existingItem) {
      // If multiple items with same name exist, merge them first
      const merged = mergeTwoItems(existingItem, itemWithCategory, userCategoryOverrides)
      existingMap.set(key, merged)
    } else {
      existingMap.set(key, itemWithCategory)
    }
  }

  // Merge new items into existing
  for (const [index, newItem] of newItems.entries()) {
    const itemWithCategory = ensureCategoryInfo(newItem, userCategoryOverrides)
    const key = createMergeMapKey(itemWithCategory, `new:${index}`)
    const existingItem = existingMap.get(key)

    if (existingItem) {
      // Merge with existing item
      const merged = mergeTwoItems(
        existingItem,
        itemWithCategory,
        userCategoryOverrides,
        preserveUserOverrides
      )
      existingMap.set(key, merged)
    } else {
      // New item, ensure it has category info
      // Normalize unit
      const normalizedItem: ShoppingItem = {
        ...itemWithCategory,
        item: isManualItem(itemWithCategory)
          ? itemWithCategory.item
          : normalizeShoppingPurchase({
              item: itemWithCategory.item,
              amount: itemWithCategory.amount,
              unit: itemWithCategory.unit,
            }).purchaseName,
        unit: normalizeUnit(itemWithCategory.unit),
      }
      existingMap.set(key, normalizedItem)
    }
  }

  const mergedItems = Array.from(existingMap.values())

  // Sort if not preserving custom order
  if (!preserveCustomOrder) {
    const sortedItems = shoppingItemOrder
      ? sortShoppingItemsByPreferences(mergedItems, shoppingItemOrder)
      : [...mergedItems].sort((a, b) => {
          if (a.categoryOrder !== b.categoryOrder) {
            return a.categoryOrder - b.categoryOrder
          }
          return a.item.localeCompare(b.item)
        })
    mergedItems.splice(0, mergedItems.length, ...sortedItems)
  }

  return mergedItems
}

function createSourceKey(source: ShoppingItemSource): string {
  return [
    source.recipeId || source.recipeName,
    normalizeItemName(source.originalItem || ""),
    normalizeUnit(source.originalUnit || ""),
    source.prepIntent || "",
    source.optional ? "optional" : "required",
    source.originalText || "",
  ].join("|")
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
  const purchase1 = normalizeShoppingPurchase({
    item: item1.item,
    amount: item1.amount,
    unit: item1.unit,
  })
  const purchase2 = normalizeShoppingPurchase({
    item: item2.item,
    amount: item2.amount,
    unit: item2.unit,
  })
  const normalized1: ShoppingItem = {
    ...item1,
    item: purchase1.purchaseName,
    amount: purchase1.purchaseQuantity,
    unit: normalizeUnit(purchase1.purchaseUnit || ""),
  }
  const normalized2: ShoppingItem = {
    ...item2,
    item: purchase2.purchaseName,
    amount: purchase2.purchaseQuantity,
    unit: normalizeUnit(purchase2.purchaseUnit || ""),
  }

  // Merge sources (deduplicate by recipeId or recipeName)
  const sourceMap = new Map<string, ShoppingItemSource>()
  
  for (const source of normalized1.sources || []) {
    sourceMap.set(createSourceKey(source), source)
  }
  
  for (const source of normalized2.sources || []) {
    const key = createSourceKey(source)
    if (!sourceMap.has(key)) {
      sourceMap.set(key, source)
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
      const [catKey, catOrder] = categorizeIngredient(normalized1.item, override, userCategoryOverrides)
      categoryKey = catKey
      categoryOrder = catOrder
    }
  }

  if (mergeResult) {
    let additionalAmounts = normalized1.additionalAmounts
    for (const additional of normalized2.additionalAmounts || []) {
      additionalAmounts = mergeIntoAdditionalAmounts(
        additionalAmounts,
        additional.amount,
        additional.unit
      )
    }

    // Units are compatible, merge amounts
    return {
      ...baseItem,
      item: normalized1.item,
      amount: roundForDisplay(mergeResult.amount),
      unit: mergeResult.unit,
      categoryKey,
      categoryOrder,
      sources: combinedSources,
      additionalAmounts:
        additionalAmounts && additionalAmounts.length > 0
          ? additionalAmounts
          : undefined,
    }
  } else {
    // Units are incompatible, use additionalAmounts
    let additionalAmounts = normalized2.amount
      ? mergeIntoAdditionalAmounts(
          normalized1.additionalAmounts,
          normalized2.amount,
          normalized2.unit
        )
      : normalized1.additionalAmounts

    for (const additional of normalized2.additionalAmounts || []) {
      additionalAmounts = mergeIntoAdditionalAmounts(
        additionalAmounts,
        additional.amount,
        additional.unit
      )
    }

    return {
      ...baseItem,
      item: normalized1.item,
      amount: normalized1.amount,
      unit: normalized1.unit,
      categoryKey,
      categoryOrder,
      sources: combinedSources,
      additionalAmounts,
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
