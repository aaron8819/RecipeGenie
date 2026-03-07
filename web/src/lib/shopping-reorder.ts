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
  activeRowId: string,
  overRowId: string
): ReorderByFilteredResult | null {
  if (!activeRowId || !overRowId) {
    return null
  }

  const actualActiveIndex = items.findIndex((item) => item.rowId === activeRowId)
  const actualOverIndex = items.findIndex((item) => item.rowId === overRowId)

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
