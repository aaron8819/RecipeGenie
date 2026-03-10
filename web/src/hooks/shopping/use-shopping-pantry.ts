"use client"

/**
 * Pantry integration hooks for shopping list
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, PantryItem } from "@/types/database"
import {
  ensureShoppingItemsHaveRowIds,
  findShoppingItemIndexByRowId,
  requireShoppingRowId,
} from "@/lib/shopping-row-identity"
import { normalizePantryItemName } from "@/lib/pantry"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import {
  cancelQueriesAndSnapshot,
  cancelQueriesAndSnapshotMany,
  invalidateQuery,
  reconcileQueryData,
  rollbackQueryData,
  rollbackQueryDataMany,
  setOptimisticQueryData,
  SHOPPING_KEY,
  PANTRY_KEY,
  SHOPPING_LIST_WRITE_SCOPE_ID,
} from "./shared"

/**
 * Hook to move an item from "already have" back to the shopping list
 */
export function useMoveToShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const rowId = requireShoppingRowId(item, "pantry restore shopping item")

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, custom_order")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[]; already_have?: ShoppingItem[]; custom_order?: boolean } | null
      const currentItems = ensureShoppingItemsHaveRowIds(typedList?.items || []).items
      const alreadyHave = ensureShoppingItemsHaveRowIds(typedList?.already_have || []).items
      const restoredItem = alreadyHave.find((candidate) => candidate.rowId === rowId)
      if (!restoredItem) return item

      let updatedItems = currentItems
      if (!currentItems.some((candidate) => candidate.rowId === rowId)) {
        updatedItems = [...currentItems, restoredItem]
        if (!typedList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
          already_have: alreadyHave.filter((candidate) => candidate.rowId !== rowId),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return restoredItem
    },
    onMutate: async (item) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const rowId = requireShoppingRowId(item, "optimistic pantry restore shopping item")

      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old

          const alreadyHave = old.already_have || []
          const restoredItem = alreadyHave.find((candidate) => candidate.rowId === rowId)
          if (!restoredItem) return old

          let updatedItems = old.items || []
          if (!updatedItems.some((candidate) => candidate.rowId === rowId)) {
            updatedItems = [...updatedItems, restoredItem]
            if (!old.custom_order) {
              updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
            }
          }

          return {
            ...old,
            items: updatedItems,
            already_have: alreadyHave.filter((candidate) => candidate.rowId !== rowId),
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}

/**
 * Hook to move an item from "excluded" back to the shopping list
 */
export function useMoveExcludedToShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const rowId = requireShoppingRowId(item, "excluded restore shopping item")

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, excluded, custom_order")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[]; excluded?: ShoppingItem[]; custom_order?: boolean } | null
      const currentItems = ensureShoppingItemsHaveRowIds(typedList?.items || []).items
      const excluded = ensureShoppingItemsHaveRowIds(typedList?.excluded || []).items
      const restoredItem = excluded.find((candidate) => candidate.rowId === rowId)
      if (!restoredItem) return item

      let updatedItems = currentItems
      if (!currentItems.some((candidate) => candidate.rowId === rowId)) {
        updatedItems = [...currentItems, restoredItem]
        if (!typedList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
          excluded: excluded.filter((candidate) => candidate.rowId !== rowId),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return restoredItem
    },
    onMutate: async (item) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const rowId = requireShoppingRowId(item, "optimistic excluded restore shopping item")

      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old

          const excluded = old.excluded || []
          const restoredItem = excluded.find((candidate) => candidate.rowId === rowId)
          if (!restoredItem) return old

          let updatedItems = old.items || []
          if (!updatedItems.some((candidate) => candidate.rowId === rowId)) {
            updatedItems = [...updatedItems, restoredItem]
            if (!old.custom_order) {
              updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
            }
          }

          return {
            ...old,
            items: updatedItems,
            excluded: excluded.filter((candidate) => candidate.rowId !== rowId),
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}

/**
 * Hook to add an item to pantry and remove it from shopping list
 * Implements optimistic updates for instant UI feedback
 */
export function useAddToPantryAndRemove() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const rowId = requireShoppingRowId(item, "pantry move shopping item")
      const normalizedItem = normalizePantryItemName(item.item)
      const supabase = getSupabase()

      const rpcClient = supabase as unknown as {
        rpc: (
          fn: "move_shopping_item_to_pantry",
          args: {
            p_row_id: string
            p_pantry_qty: number | null
            p_pantry_unit: string | null
          }
        ) => Promise<{
          data: Array<{
            removed_item: {
              item?: string
              amount?: number
              unit?: string
              categoryKey?: string
              categoryOrder?: number
            } | null
            pantry_item: {
              id: string
              user_id: string
              item: string
              created_at: string
            } | null
            shopping_list_updated_at: string
            pantry_was_inserted: boolean
          }> | null
          error: { message: string } | null
        }>
      }

      const { data, error } = await rpcClient.rpc("move_shopping_item_to_pantry", {
        p_row_id: rowId,
        p_pantry_qty: item.amount,
        p_pantry_unit: item.unit || null,
      })

      if (error) throw error

      const row = data?.[0]
      if (!row) throw new Error(`Failed to move item to pantry: ${item.item}`)

      return {
        rowId,
        itemName: normalizedItem,
        wasAdded: row.pantry_was_inserted,
        removedItem: row.removed_item,
        pantryItem: row.pantry_item,
        shoppingListUpdatedAt: row.shopping_list_updated_at,
      }
    },
    onMutate: async (item) => {
      const { previousList, previousPantry } = await cancelQueriesAndSnapshotMany<{
        previousList: ShoppingList
        previousPantry: PantryItem[]
      }>(queryClient, {
        previousList: SHOPPING_KEY,
        previousPantry: PANTRY_KEY,
      })

      const rowId = requireShoppingRowId(item, "optimistic pantry move shopping item")
      const normalizedItem = normalizePantryItemName(item.item)
      const resolvedIndex = findShoppingItemIndexByRowId(previousList?.items || [], rowId)
      if (resolvedIndex === -1) {
        throw new Error(`Shopping item not found: ${rowId}`)
      }

      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          const alreadyHave = old.already_have || []
          const updatedAlreadyHave = alreadyHave.some((candidate) => candidate.rowId === rowId)
            ? alreadyHave
            : [...alreadyHave, item]

          return {
            ...old,
            items: old.items.filter((_, idx) => idx !== resolvedIndex),
            already_have: updatedAlreadyHave,
          }
        }
      )

      const now = new Date().toISOString()
      const optimisticItem: PantryItem = {
        id: `temp-${crypto.randomUUID()}`,
        user_id: user!.id,
        item: normalizedItem,
        created_at: now,
      }
      setOptimisticQueryData<PantryItem[]>(
        queryClient,
        PANTRY_KEY,
        (old) => {
          if (!old) return [optimisticItem]
          if (old.some((p) => p.item === normalizedItem)) return old
          return [...old, optimisticItem].sort((a, b) => a.item.localeCompare(b.item))
        }
      )

      return { previousList, previousPantry }
    },
    onError: (err, item, context) => {
      rollbackQueryDataMany(
        queryClient,
        {
          previousList: SHOPPING_KEY,
          previousPantry: PANTRY_KEY,
        },
        {
          previousList: context?.previousList,
          previousPantry: context?.previousPantry,
        }
      )
    },
    onSuccess: (result) => {
      reconcileQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old

          const existingAlreadyHave = old.already_have || []
          const removed = result.removedItem
          const restoredRow = removed
            ? {
                rowId: result.rowId,
                item: removed.item || result.itemName,
                amount: removed.amount ?? null,
                unit: removed.unit || "",
                categoryKey: removed.categoryKey || "",
                categoryOrder: removed.categoryOrder ?? 5,
                sources: [{ recipeId: "", recipeName: "Manual" }],
              }
            : null

          return {
            ...old,
            generated_at: result.shoppingListUpdatedAt,
            already_have: restoredRow && !existingAlreadyHave.some((candidate) => candidate.rowId === result.rowId)
              ? [...existingAlreadyHave, restoredRow]
              : existingAlreadyHave,
          }
        }
      )

      if (result.pantryItem) {
        const pantryItem = result.pantryItem
        reconcileQueryData<PantryItem[]>(
          queryClient,
          PANTRY_KEY,
          (old) => {
            const pantryRow: PantryItem = {
              id: pantryItem.id,
              user_id: pantryItem.user_id,
              item: pantryItem.item,
              created_at: pantryItem.created_at,
            }
            if (!old) return [pantryRow]
            const existingIndex = old.findIndex((candidate) => candidate.id === pantryRow.id || candidate.item === pantryRow.item)
            if (existingIndex === -1) {
              return [...old, pantryRow].sort((a, b) => a.item.localeCompare(b.item))
            }
            const next = [...old]
            next[existingIndex] = pantryRow
            return next
          }
        )
      }
    },
  })
}
