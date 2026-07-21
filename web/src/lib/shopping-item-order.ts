import type { ShoppingItem } from "@/types/database"
import { createShoppingPurchaseKey } from "./shopping-list-normalization"

export type ShoppingItemOrderPreferences = Record<string, string[]>

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== "string") continue
    const normalized = createShoppingPurchaseKey(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function normalizeShoppingItemOrderPreferences(
  value: unknown
): ShoppingItemOrderPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  const preferences: ShoppingItemOrderPreferences = {}

  for (const [categoryKey, order] of Object.entries(value)) {
    if (!Array.isArray(order)) continue
    const normalizedOrder = uniqueStrings(order)
    if (normalizedOrder.length > 0) {
      preferences[categoryKey] = normalizedOrder
    }
  }

  return preferences
}

export function getShoppingItemOrderKey(item: Pick<ShoppingItem, "item" | "amount" | "unit">): string {
  return createShoppingPurchaseKey(item.item, item.amount, item.unit)
}

function getCategoryItemKeys(items: ShoppingItem[], categoryKey: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  for (const item of items) {
    if ((item.categoryKey || "misc") !== categoryKey) continue

    const key = getShoppingItemOrderKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    keys.push(key)
  }

  return keys
}

function mergeCategoryOrder(
  existingOrder: string[],
  currentOrder: string[]
): string[] {
  if (currentOrder.length === 0) return existingOrder
  if (existingOrder.length === 0) return currentOrder

  const currentKeys = new Set(currentOrder)
  const firstKnownIndex = existingOrder.findIndex((key) => currentKeys.has(key))
  const insertIndex = firstKnownIndex >= 0 ? firstKnownIndex : existingOrder.length
  const retainedExisting = existingOrder.filter((key) => !currentKeys.has(key))
  const nextOrder = [
    ...retainedExisting.slice(0, insertIndex),
    ...currentOrder,
    ...retainedExisting.slice(insertIndex),
  ]

  return uniqueStrings(nextOrder)
}

export function learnShoppingItemOrderPreferences(
  existingPreferences: unknown,
  items: ShoppingItem[]
): ShoppingItemOrderPreferences {
  const preferences = normalizeShoppingItemOrderPreferences(existingPreferences)
  const categoryKeys = new Set(items.map((item) => item.categoryKey || "misc"))
  const nextPreferences: ShoppingItemOrderPreferences = { ...preferences }

  for (const categoryKey of categoryKeys) {
    const currentOrder = getCategoryItemKeys(items, categoryKey)
    const nextOrder = mergeCategoryOrder(preferences[categoryKey] || [], currentOrder)

    if (nextOrder.length > 0) {
      nextPreferences[categoryKey] = nextOrder
    }
  }

  return nextPreferences
}

export function sortShoppingItemsByPreferences(
  items: ShoppingItem[],
  preferences: unknown
): ShoppingItem[] {
  const normalizedPreferences = normalizeShoppingItemOrderPreferences(preferences)
  const rankByCategory = new Map<string, Map<string, number>>()

  for (const [categoryKey, order] of Object.entries(normalizedPreferences)) {
    rankByCategory.set(
      categoryKey,
      new Map(order.map((itemKey, index) => [itemKey, index]))
    )
  }

  return [...items].sort((a, b) => {
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder
    }

    const categoryKey = a.categoryKey || b.categoryKey || "misc"
    const rankMap = rankByCategory.get(categoryKey)
    const rankA = rankMap?.get(getShoppingItemOrderKey(a))
    const rankB = rankMap?.get(getShoppingItemOrderKey(b))

    if (rankA !== undefined || rankB !== undefined) {
      if (rankA === undefined) return 1
      if (rankB === undefined) return -1
      if (rankA !== rankB) return rankA - rankB
    }

    return a.item.localeCompare(b.item)
  })
}
