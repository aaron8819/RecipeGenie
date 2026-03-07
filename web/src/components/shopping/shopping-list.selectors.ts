import { getAllShoppingCategories } from "@/lib/shopping-categories"
import type { CustomShoppingCategory, ShoppingItem, ShoppingList } from "@/types/database"

export type ShoppingCategoryMeta = ReturnType<typeof getAllShoppingCategories>[number]

export type ShoppingCategoryViewModel = ShoppingCategoryMeta & {
  items: ShoppingItem[]
  checkedCount: number
  uncheckedCount: number
  totalCount: number
}

export function createDisplayShoppingList(shoppingList: ShoppingList | null | undefined): ShoppingList {
  return shoppingList || {
    user_id: "",
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1.0,
    total_servings: 0,
    custom_order: false,
    generated_at: new Date().toISOString(),
  }
}

export function mergeAlreadyHaveItems(alreadyHave: ShoppingItem[]): ShoppingItem[] {
  return [...alreadyHave]
}

export function deriveVisibleShoppingItems(items: ShoppingItem[]): ShoppingItem[] {
  return items
}

export function groupItemsByCategory(items: ShoppingItem[]): Record<string, ShoppingItem[]> {
  return items.reduce((acc, item) => {
    const category = item.categoryKey || "misc"
    if (!acc[category]) acc[category] = []
    acc[category].push(item)
    return acc
  }, {} as Record<string, ShoppingItem[]>)
}

export function sortItemsWithinGroups(groupedItems: Record<string, ShoppingItem[]>): Record<string, ShoppingItem[]> {
  const sorted: Record<string, ShoppingItem[]> = {}
  for (const [key, items] of Object.entries(groupedItems)) {
    sorted[key] = [...items]
  }
  return sorted
}

export function deriveOrderedCategories(params: {
  customCategories: CustomShoppingCategory[] | null | undefined
  categoryOrder: unknown
}): ShoppingCategoryMeta[] {
  const categoryOrder = Array.isArray(params.categoryOrder)
    ? params.categoryOrder.filter((value): value is string => typeof value === "string")
    : null

  return getAllShoppingCategories(params.customCategories || null, categoryOrder)
}

export function deriveCheckedPartition(items: ShoppingItem[]): {
  totalCount: number
  checkedCount: number
  uncheckedCount: number
  allChecked: boolean
} {
  const totalCount = items.length
  const checkedCount = items.filter((item) => item.checked === true).length
  const uncheckedCount = totalCount - checkedCount
  return {
    totalCount,
    checkedCount,
    uncheckedCount,
    allChecked: totalCount > 0 && uncheckedCount === 0,
  }
}

export function buildCategoryViewModel(
  groupedItems: Record<string, ShoppingItem[]>,
  orderedCategories: ShoppingCategoryMeta[]
): ShoppingCategoryViewModel[] {
  return orderedCategories
    .map((category) => {
      const items = groupedItems[category.key] || []
      const partition = deriveCheckedPartition(items)
      return {
        ...category,
        items,
        checkedCount: partition.checkedCount,
        uncheckedCount: partition.uncheckedCount,
        totalCount: partition.totalCount,
      }
    })
    .filter((category) => category.totalCount > 0)
}

export function deriveSortableItemIds(items: ShoppingItem[]): string[] {
  return items.map((item, index) => item.rowId || `missing-row-${index}`)
}

export function deriveUniqueRecipeNames(items: ShoppingItem[]): string[] {
  if (items.length === 0) return []

  const recipeSet = new Set<string>()
  for (const item of items) {
    if (!item.sources) continue
    for (const source of item.sources) {
      if (source.recipeName !== "Manual") {
        recipeSet.add(source.recipeName)
      }
    }
  }
  return Array.from(recipeSet).sort()
}
