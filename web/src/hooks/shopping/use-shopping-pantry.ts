"use client"

/**
 * Pantry integration hooks for shopping list
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, PantryItem } from "@/types/database"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, PANTRY_KEY } from "./shared"

/**
 * Hook to move an item from "already have" back to the shopping list
 */
export function useMoveToShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
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

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()

      const supabase = getSupabase()

      // Track whether we added a new pantry item (vs duplicate)
      let addedToPantry = false

      // Add to pantry
      const { error: pantryError } = await supabase
        .from("pantry_items")
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        .insert({ user_id: user!.id, item: normalizedItem })
        .select()
        .single()

      // If item already exists in pantry, that's okay - just continue
      if (pantryError && pantryError.code !== "23505") { // 23505 is unique violation
        throw pantryError
      }
      addedToPantry = !pantryError // True if insert succeeded (no error)

      // Remove from shopping list items and add to already_have
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have")
        .single()

      if (fetchError) {
        // Attempt rollback — track error so caller can surface it
        if (addedToPantry) {
          const { error: rollbackErr } = await supabase
            .from("pantry_items")
            .delete()
            .eq("user_id", user!.id)
            .eq("item", normalizedItem)
          const err = new Error(`Failed to load shopping list: ${fetchError.message}`)
          if (rollbackErr) {
            err.cause = new Error(`Pantry rollback also failed: ${rollbackErr.message}`)
          }
          throw err
        }
        throw fetchError
      }

      const typedList = currentList as { items?: ShoppingItem[]; already_have?: ShoppingItem[] } | null
      const currentItems = typedList?.items || []
      const alreadyHave = typedList?.already_have || []

      // Remove from items
      const updatedItems = currentItems.filter((i) => i.item.toLowerCase() !== normalizedItem)

      // Add to already_have (preserving all item properties)
      // Check if item already exists in already_have
      const existingInAlreadyHave = alreadyHave.find((i) => i.item.toLowerCase() === normalizedItem)
      const updatedAlreadyHave = existingInAlreadyHave
        ? alreadyHave // Item already in already_have, keep as is
        : [...alreadyHave, item] // Add item to already_have

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
          already_have: updatedAlreadyHave,
        })
        .eq("user_id", user!.id)

      if (saveError) {
        // Attempt rollback — track error so caller can surface it
        if (addedToPantry) {
          const { error: rollbackErr } = await supabase
            .from("pantry_items")
            .delete()
            .eq("user_id", user!.id)
            .eq("item", normalizedItem)
          const err = new Error(`Failed to save shopping list: ${saveError.message}`)
          if (rollbackErr) {
            err.cause = new Error(`Pantry rollback also failed: ${rollbackErr.message}`)
          }
          throw err
        }
        throw saveError
      }
      return { itemName: normalizedItem, wasAdded: addedToPantry }
    },
    // Optimistic update
    onMutate: async (item) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })
      await queryClient.cancelQueries({ queryKey: PANTRY_KEY })

      // Snapshot previous values for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      const previousPantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY])

      const normalizedItem = item.item.toLowerCase().trim()

      // Optimistically remove from shopping list items and add to already_have
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY],
        (old) => {
          if (!old) return old
          const alreadyHave = old.already_have || []
          // Check if item already exists in already_have
          const existingInAlreadyHave = alreadyHave.find((i) => i.item.toLowerCase() === normalizedItem)
          const updatedAlreadyHave = existingInAlreadyHave
            ? alreadyHave // Item already in already_have, keep as is
            : [...alreadyHave, item] // Add item to already_have

          return {
            ...old,
            items: old.items.filter((i) => i.item.toLowerCase() !== normalizedItem),
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
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY], context.previousList)
      }
      if (context?.previousPantry) {
        queryClient.setQueryData([...PANTRY_KEY], context.previousPantry)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
      queryClient.invalidateQueries({ queryKey: PANTRY_KEY })
    },
  })
}
