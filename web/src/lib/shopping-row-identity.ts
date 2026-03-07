import type { ShoppingItem, ShoppingList } from "@/types/database"

export function createShoppingRowId(): string {
  return `shoprow_${crypto.randomUUID()}`
}

export function requireShoppingRowId(item: ShoppingItem, context = "shopping item"): string {
  if (typeof item.rowId === "string" && item.rowId.length > 0) {
    return item.rowId
  }

  throw new Error(`Missing rowId for ${context}`)
}

export function findShoppingItemIndexByRowId(items: ShoppingItem[], rowId: string): number {
  return items.findIndex((item) => item.rowId === rowId)
}

export function ensureShoppingItemRowId<T extends ShoppingItem>(item: T): T & { rowId: string } {
  if (typeof item.rowId === "string" && item.rowId.length > 0) {
    return item as T & { rowId: string }
  }

  return {
    ...item,
    rowId: createShoppingRowId(),
  }
}

export function ensureShoppingItemsHaveRowIds(items: ShoppingItem[]): {
  items: ShoppingItem[]
  changed: boolean
} {
  let changed = false

  return {
    items: items.map((item) => {
      if (typeof item.rowId === "string" && item.rowId.length > 0) {
        return item
      }

      changed = true
      return ensureShoppingItemRowId(item)
    }),
    changed,
  }
}

export function ensureShoppingListRowIds(shoppingList: ShoppingList): {
  shoppingList: ShoppingList
  changed: boolean
} {
  const ensuredItems = ensureShoppingItemsHaveRowIds(shoppingList.items || [])
  const ensuredAlreadyHave = ensureShoppingItemsHaveRowIds(shoppingList.already_have || [])
  const ensuredExcluded = ensureShoppingItemsHaveRowIds(shoppingList.excluded || [])
  const changed = ensuredItems.changed || ensuredAlreadyHave.changed || ensuredExcluded.changed

  if (!changed) {
    return { shoppingList, changed: false }
  }

  return {
    shoppingList: {
      ...shoppingList,
      items: ensuredItems.items,
      already_have: ensuredAlreadyHave.items,
      excluded: ensuredExcluded.items,
    },
    changed: true,
  }
}
