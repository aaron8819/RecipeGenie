import type { ShoppingItem } from '@/types/database'
import type { RowRef } from './shopping-document'

export function createShoppingManualItemId(): string {
  return crypto.randomUUID()
}

export function requireShoppingRowRef(
  item: ShoppingItem,
  context = 'shopping item'
): RowRef {
  if (
    typeof item.rowId === 'string' &&
    (item.rowId.startsWith('derived:') || item.rowId.startsWith('manual:'))
  ) {
    return item.rowId as RowRef
  }

  throw new Error(`Missing row reference for ${context}`)
}
