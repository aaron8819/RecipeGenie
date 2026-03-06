"use client"

/**
 * Shopping list item operations: add, remove, check, reorder
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem } from "@/types/database"
import { ensureCategoryInfo } from "@/lib/shopping-list"
import { normalizeItemName, normalizeUnit } from "@/lib/shopping-list-normalization"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import {
  cancelQueriesAndSnapshot,
  invalidateQuery,
  reconcileQueryData,
  rollbackQueryData,
  setOptimisticQueryData,
  SHOPPING_KEY,
  SHOPPING_LIST_WRITE_SCOPE_ID,
} from "./shared"

/**
 * Hook to add a manual item to the shopping list
 * Implements optimistic updates for instant UI feedback
 */
export function useAddShoppingItem() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async ({ itemName, amount, unit }: { itemName: string; amount?: number; unit?: string }) => {
      const categoryOverrides =
        ((await getSupabase().from("user_config").select("category_overrides").single()).data as { category_overrides?: Record<string, string> } | null)?.category_overrides || {}

      const newItem = ensureCategoryInfo(
        {
          item: normalizeItemName(itemName),
          amount: amount || null,
          unit: normalizeUnit(unit || ""),
          categoryKey: "",
          categoryOrder: 5,
          sources: [{ recipeId: "", recipeName: "Manual" }],
        },
        categoryOverrides
      )

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, custom_order")
        .single()

      if (fetchError && fetchError.code !== "PGRST116") throw fetchError

      const currentItems = ((currentList as { items?: ShoppingItem[]; custom_order?: boolean } | null)?.items) || []
      if (currentItems.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
        throw new Error("Item already in shopping list")
      }

      let updatedItems = [...currentItems, newItem]
      const typedList = currentList as { items?: ShoppingItem[]; custom_order?: boolean } | null
      if (!typedList?.custom_order) {
        updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ items: updatedItems })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return newItem
    },
    // Optimistic update
    onMutate: async ({ itemName, amount, unit }) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      // Get category overrides for optimistic item creation
      const categoryOverrides =
        ((await getSupabase().from("user_config").select("category_overrides").single()).data as { category_overrides?: Record<string, string> } | null)?.category_overrides || {}

      const optimisticItem = ensureCategoryInfo(
        {
          item: normalizeItemName(itemName),
          amount: amount || null,
          unit: normalizeUnit(unit || ""),
          categoryKey: "",
          categoryOrder: 5,
          sources: [{ recipeId: "", recipeName: "Manual" }],
        },
        categoryOverrides
      )

      // Optimistically update cache
      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) {
            return {
              user_id: user?.id || "",
              items: [optimisticItem],
              already_have: [],
              excluded: [],
              source_recipes: [],
              scale: 1.0,
              total_servings: 0,
              custom_order: false,
              generated_at: new Date().toISOString(),
            }
          }
          if (old.items.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
            return old // Don't add duplicate
          }
          let updatedItems = [...old.items, optimisticItem]
          if (!old.custom_order) {
            updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
          }
          return { ...old, items: updatedItems }
        }
      )

      return { previousList }
    },
    onError: (err, variables, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}

/**
 * Hook to remove an item from the shopping list
 * Implements optimistic updates for instant UI feedback
 */
export function useRemoveShoppingItem() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (itemName: string) => {
      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[] } | null
      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: (typedList?.items || []).filter(
            (i) => i.item.toLowerCase() !== itemName.toLowerCase()
          ),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return itemName
    },
    // Optimistic update
    onMutate: async (itemName) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      // Optimistically remove from cache
      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.filter((i) => i.item.toLowerCase() !== itemName.toLowerCase()),
          }
        }
      )

      return { previousList }
    },
    onError: (err, itemName, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}

/**
 * Hook to toggle checked state of a shopping item
 * Items stay in the list but are marked as checked/unchecked
 * Implements optimistic updates for instant UI feedback
 */
export function useCheckOffItem() {
  const queryClient = useQueryClient()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const supabase = getSupabase()
      const rpcClient = supabase as unknown as {
        rpc: (
          fn: "toggle_shopping_item_checked",
          args: { p_item_name: string }
        ) => Promise<{
          data: Array<{
            item_name: string
            checked: boolean | null
            updated_at: string
          }> | null
          error: { message: string } | null
        }>
      }

      const { data, error } = await rpcClient.rpc("toggle_shopping_item_checked", {
        p_item_name: item.item,
      })

      if (error) throw error

      const rpcRows = data as
        | Array<{
            item_name: string
            checked: boolean | null
            updated_at: string
          }>
        | null

      const row = rpcRows?.[0]
      if (!row || row.checked === null) {
        throw new Error(`Shopping item not found: ${item.item}`)
      }

      return {
        item_name: row.item_name,
        checked: row.checked,
        updated_at: row.updated_at,
      }
    },
    // Optimistic update
    onMutate: async (item) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const normalizedItem = item.item.toLowerCase().trim()

      // Optimistically update cache
      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          const currentItems = old.items || []
          const updatedItems = currentItems.map((i) =>
            i.item.toLowerCase() === normalizedItem
              ? { ...i, checked: !i.checked }
              : i
          )

          return {
            ...old,
            items: updatedItems,
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: (result) => {
      const normalizedItem = result.item_name.toLowerCase().trim()
      reconcileQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((i) =>
              i.item.toLowerCase().trim() === normalizedItem
                ? { ...i, checked: result.checked }
                : i
            ),
          }
        }
      )
    },
  })
}

/**
 * Hook to check off multiple items at once (toggle checked state)
 * Used for "Check All" in a category - checks all items in the category
 */
export function useBulkCheckOff() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (itemsToCheck: ShoppingItem[]) => {
      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[] } | null
      const currentItems = typedList?.items || []

      // Check all items (set checked to true)
      const updatedItems = currentItems.map(i =>
        itemNames.has(i.item.toLowerCase().trim())
          ? { ...i, checked: true }
          : i
      )

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return { count: itemsToCheck.length }
    },
    // Optimistic update
    onMutate: async (itemsToCheck) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      // Optimistically update cache
      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          const currentItems = old.items || []

          const updatedItems = currentItems.map(i =>
            itemNames.has(i.item.toLowerCase().trim())
              ? { ...i, checked: true }
              : i
          )

          return {
            ...old,
            items: updatedItems,
          }
        }
      )

      return { previousList }
    },
    onError: (err, itemsToCheck, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}

/**
 * Hook to reorder shopping list items
 */
export function useReorderShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (newItems: ShoppingItem[]) => {
      const supabase = getSupabase()
      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ items: newItems, custom_order: true })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return newItems
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}
