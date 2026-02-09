import type { ShoppingItem } from "@/types/database"

export interface ReorderByFilteredResult {
  newItems: ShoppingItem[]
  draggedItem: ShoppingItem
  overItem: ShoppingItem
  actualActiveIndex: number
  actualOverIndex: number
}

export function reorderByFilteredIndices(
  items: ShoppingItem[],
  filteredItems: ShoppingItem[],
  activeIndex: number,
  overIndex: number
): ReorderByFilteredResult | null {
  if (
    activeIndex < 0 ||
    overIndex < 0 ||
    activeIndex >= filteredItems.length ||
    overIndex >= filteredItems.length
  ) {
    return null
  }

  const activeItemFromFiltered = filteredItems[activeIndex]
  const overItemFromFiltered = filteredItems[overIndex]
  const actualActiveIndex = items.findIndex((i) => i.item === activeItemFromFiltered.item)
  const actualOverIndex = items.findIndex((i) => i.item === overItemFromFiltered.item)

  if (actualActiveIndex === -1 || actualOverIndex === -1) {
    return null
  }

  const draggedItem = items[actualActiveIndex]
  const overItem = items[actualOverIndex]
  const newItems = [...items]
  newItems.splice(actualActiveIndex, 1)
  newItems.splice(actualOverIndex, 0, draggedItem)

  return {
    newItems,
    draggedItem,
    overItem,
    actualActiveIndex,
    actualOverIndex,
  }
}
