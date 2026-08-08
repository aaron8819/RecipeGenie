import type { ShoppingItem } from "@/types/database"

export interface ShoppingDropIntent {
  draggedItem: ShoppingItem
  targetItem: ShoppingItem
  placement: "before" | "after"
}

export function resolveShoppingDropIntent(
  items: ShoppingItem[],
  activeRowId: string,
  overRowId: string
): ShoppingDropIntent | null {
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
  return {
    draggedItem,
    targetItem: overItem,
    placement: actualActiveIndex < actualOverIndex ? "after" : "before",
  }
}
