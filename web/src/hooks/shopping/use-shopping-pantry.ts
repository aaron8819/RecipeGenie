"use client"

/**
 * Pantry integration hooks for shopping list
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef } from "react"
import type { ShoppingList, ShoppingItem, PantryItem } from "@/types/database"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, PANTRY_KEY, SHOPPING_LIST_WRITE_SCOPE_ID } from "./shared"

/**
 * Hook to move an item from "already have" back to the shopping list
 */
export function useMoveToShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, custom_order")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[]; already_have?: ShoppingItem[]; custom_order?: boolean } | null
      const currentItems = typedList?.items || []
      const alreadyHave = typedList?.already_have || []

      // Find all items with the same name in already_have and merge them
      const itemsToMerge = alreadyHave.filter((i) => i.item.toLowerCase() === normalizedItem)
      if (itemsToMerge.length === 0) return item

      // Merge all items with the same name
      let mergedItem = itemsToMerge[0]
      for (let i = 1; i < itemsToMerge.length; i++) {
        const nextItem = itemsToMerge[i]

        // Merge sources
        const existingSources = mergedItem.sources || []
        const newSources = nextItem.sources || []
        const sourceSet = new Set(existingSources.map((s) => s.recipeName))
        const combinedSources = [...existingSources]
        for (const source of newSources) {
          if (!sourceSet.has(source.recipeName)) {
            combinedSources.push(source)
          }
        }

        // Merge amounts
        const mergeResult = mergeAmounts(mergedItem.amount, mergedItem.unit, nextItem.amount, nextItem.unit)
        if (mergeResult) {
          mergedItem = {
            ...mergedItem,
            amount: roundForDisplay(mergeResult.amount),
            unit: mergeResult.unit,
            sources: combinedSources,
          }
        } else {
          // Units incompatible, keep existing but combine sources
          mergedItem = {
            ...mergedItem,
            sources: combinedSources,
          }
        }
      }

      let updatedItems = currentItems
      if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
        updatedItems = [...currentItems, mergedItem]
        if (!typedList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
          already_have: alreadyHave.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return mergedItem
    },
    // Optimistic update
    onMutate: async (item) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])

      const normalizedItem = item.item.toLowerCase().trim()

      // Optimistically update cache
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY],
        (old) => {
          if (!old) return old

          const alreadyHave = old.already_have || []
          const currentItems = old.items || []

          // Find all items with the same name in already_have and merge them
          const itemsToMerge = alreadyHave.filter((i) => i.item.toLowerCase() === normalizedItem)
          if (itemsToMerge.length === 0) return old

          // Merge all items with the same name (same logic as mutationFn)
          let mergedItem = itemsToMerge[0]
          for (let i = 1; i < itemsToMerge.length; i++) {
            const nextItem = itemsToMerge[i]

            const existingSources = mergedItem.sources || []
            const newSources = nextItem.sources || []
            const sourceSet = new Set(existingSources.map((s) => s.recipeName))
            const combinedSources = [...existingSources]
            for (const source of newSources) {
              if (!sourceSet.has(source.recipeName)) {
                combinedSources.push(source)
              }
            }

            const mergeResult = mergeAmounts(mergedItem.amount, mergedItem.unit, nextItem.amount, nextItem.unit)
            if (mergeResult) {
              mergedItem = {
                ...mergedItem,
                amount: roundForDisplay(mergeResult.amount),
                unit: mergeResult.unit,
                sources: combinedSources,
              }
            } else {
              mergedItem = {
                ...mergedItem,
                sources: combinedSources,
              }
            }
          }

          let updatedItems = currentItems
          if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
            updatedItems = [...currentItems, mergedItem]
            if (!old.custom_order) {
              updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
            }
          }

          return {
            ...old,
            items: updatedItems,
            already_have: alreadyHave.filter((i) => i.item.toLowerCase() !== normalizedItem),
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
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
      const normalizedItem = item.item.toLowerCase().trim()

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, excluded, custom_order")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[]; excluded?: ShoppingItem[]; custom_order?: boolean } | null
      const currentItems = typedList?.items || []
      const excluded = typedList?.excluded || []

      let updatedItems = currentItems
      if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
        updatedItems = [...currentItems, item]
        if (!typedList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
          excluded: excluded.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return item
    },
    // Optimistic update
    onMutate: async (item) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])

      const normalizedItem = item.item.toLowerCase().trim()

      // Optimistically update cache
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY],
        (old) => {
          if (!old) return old

          const currentItems = old.items || []
          const excluded = old.excluded || []

          let updatedItems = currentItems
          if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
            updatedItems = [...currentItems, item]
            if (!old.custom_order) {
              updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
            }
          }

          return {
            ...old,
            items: updatedItems,
            excluded: excluded.filter((i) => i.item.toLowerCase() !== normalizedItem),
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
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
  const resolvedItemIndexes = useRef(new WeakMap<ShoppingItem, number>())

  const resolveShoppingItemIndex = (items: ShoppingItem[], input: ShoppingItem): number => {
    const itemIndex = (input as ShoppingItem & { itemIndex?: number }).itemIndex
    if (typeof itemIndex === "number") {
      const candidate = items[itemIndex]
      if (!candidate) throw new Error("Shopping item index out of bounds")
      if (candidate.item !== input.item) throw new Error("Item mismatch")
      return itemIndex
    }

    const matchingIndexes = items
      .map((candidate, idx) => ({ candidate, idx }))
      .filter(({ candidate }) =>
        candidate.item === input.item &&
        candidate.amount === input.amount &&
        candidate.unit === input.unit &&
        candidate.categoryKey === input.categoryKey &&
        candidate.categoryOrder === input.categoryOrder
      )
      .map(({ idx }) => idx)

    if (matchingIndexes.length === 1) return matchingIndexes[0]
    if (matchingIndexes.length === 0) {
      throw new Error(`Shopping item not found: ${input.item}`)
    }
    throw new Error(`Ambiguous shopping item match: ${input.item}. Provide itemIndex.`)
  }

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()
      const supabase = getSupabase()

      const resolvedIndex = resolvedItemIndexes.current.get(item)
      if (resolvedIndex === undefined) {
        throw new Error("Unable to resolve shopping item index for pantry move")
      }

      const rpcClient = supabase as unknown as {
        rpc: (
          fn: "move_shopping_item_to_pantry",
          args: {
            p_item_name: string
            p_item_index: number
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
        p_item_name: item.item,
        p_item_index: resolvedIndex,
        p_pantry_qty: item.amount,
        p_pantry_unit: item.unit || null,
      })

      resolvedItemIndexes.current.delete(item)

      if (error) throw error

      const row = data?.[0]
      if (!row) throw new Error(`Failed to move item to pantry: ${item.item}`)

      return {
        itemName: normalizedItem,
        wasAdded: row.pantry_was_inserted,
        removedItem: row.removed_item,
        pantryItem: row.pantry_item,
        shoppingListUpdatedAt: row.shopping_list_updated_at,
        itemIndex: resolvedIndex,
      }
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })
      await queryClient.cancelQueries({ queryKey: PANTRY_KEY })

      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      const previousPantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY])

      const normalizedItem = item.item.toLowerCase().trim()
      const resolvedIndex = resolveShoppingItemIndex(previousList?.items || [], item)
      resolvedItemIndexes.current.set(item, resolvedIndex)

      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY],
        (old) => {
          if (!old) return old
          const alreadyHave = old.already_have || []
          const existingInAlreadyHave = alreadyHave.find((i) => i.item.toLowerCase() === normalizedItem)
          const updatedAlreadyHave = existingInAlreadyHave
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
        user_id: user!.id,
        item: normalizedItem,
        created_at: now,
      }
      queryClient.setQueryData<PantryItem[]>(
        [...PANTRY_KEY],
        (old) => {
          if (!old) return [optimisticItem]
          if (old.some((p) => p.item === normalizedItem)) return old
          return [...old, optimisticItem].sort((a, b) => a.item.localeCompare(b.item))
        }
      )

      return { previousList, previousPantry }
    },
    onError: (err, item, context) => {
      resolvedItemIndexes.current.delete(item)
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY], context.previousList)
      }
      if (context?.previousPantry) {
        queryClient.setQueryData([...PANTRY_KEY], context.previousPantry)
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY],
        (old) => {
          if (!old) return old

          const existingAlreadyHave = old.already_have || []
          const normalized = result.itemName.toLowerCase().trim()
          const alreadyExists = existingAlreadyHave.some((i) => i.item.toLowerCase() === normalized)
          const removed = result.removedItem
          const mergedRemovedItem = removed
            ? {
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
            already_have: !alreadyExists && mergedRemovedItem
              ? [...existingAlreadyHave, mergedRemovedItem]
              : existingAlreadyHave,
          }
        }
      )

      if (result.pantryItem) {
        const pantryItem = result.pantryItem
        queryClient.setQueryData<PantryItem[]>(
          [...PANTRY_KEY],
          (old) => {
            const pantryRow: PantryItem = {
              user_id: pantryItem.user_id,
              item: pantryItem.item,
              created_at: pantryItem.created_at,
            }
            if (!old) return [pantryRow]
            const existingIndex = old.findIndex((p) => p.item === pantryRow.item)
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

