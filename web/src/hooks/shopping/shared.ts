/**
 * Shared constants and helpers for shopping hooks
 */

import { useQueryClient } from "@tanstack/react-query"
import type { ShoppingList } from "@/types/database"
import { getDefaultShoppingList } from "@/lib/guest-storage"

// Query keys
export const SHOPPING_KEY = ["shopping_list"]
export const PANTRY_KEY = ["pantry"]
export const CONFIG_KEY = ["user_config"]

/**
 * Get guest shopping list from React Query cache
 */
export function getGuestList(queryClient: ReturnType<typeof useQueryClient>): ShoppingList {
  return queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, true]) || getDefaultShoppingList() as ShoppingList
}

/**
 * Set guest shopping list in React Query cache
 */
export function setGuestList(queryClient: ReturnType<typeof useQueryClient>, list: Partial<ShoppingList>) {
  const current = getGuestList(queryClient)
  queryClient.setQueryData([...SHOPPING_KEY, true], { ...current, ...list, generated_at: new Date().toISOString() })
}
