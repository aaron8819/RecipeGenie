"use client"

/**
 * Shopping list item operations: add, remove, check, reorder
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem } from "@/types/database"
import {
  ensureShoppingItemRowId,
  ensureShoppingItemsHaveRowIds,
  requireShoppingRowId,
} from "@/lib/shopping-row-identity"
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

      const newItem = ensureShoppingItemRowId(
        ensureCategoryInfo(
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
      )

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, custom_order")
        .single()

      if (fetchError && fetchError.code !== "PGRST116") throw fetchError

      const currentItems = ensureShoppingItemsHaveRowIds(
        ((currentList as { items?: ShoppingItem[]; custom_order?: boolean } | null)?.items) || []
      ).items
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
    onMutate: async ({ itemName, amount, unit }) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const categoryOverrides =
        ((await getSupabase().from("user_config").select("category_overrides").single()).data as { category_overrides?: Record<string, string> } | null)?.category_overrides || {}

      const optimisticItem = ensureShoppingItemRowId(
        ensureCategoryInfo(
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
      )

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
            return old
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
 */
export function useRemoveShoppingItem() {
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (rowId: string) => {
      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const currentItems = ensureShoppingItemsHaveRowIds(
        ((currentList as { items?: ShoppingItem[] } | null)?.items) || []
      ).items

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: currentItems.filter((item) => item.rowId !== rowId),
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return rowId
    },
    onSuccess: () => {
      return undefined
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
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (item: ShoppingItem) => {
      const rowId = requireShoppingRowId(item, "checked shopping item")
      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const currentItems = ensureShoppingItemsHaveRowIds(
        ((currentList as { items?: ShoppingItem[] } | null)?.items) || []
      ).items
      const targetIndex = currentItems.findIndex((candidate) => candidate.rowId === rowId)
      if (targetIndex === -1) {
        throw new Error(`Shopping item not found: ${rowId}`)
      }

      const nextChecked = !currentItems[targetIndex].checked
      const updatedItems = currentItems.map((candidate) =>
        candidate.rowId === rowId
          ? { ...candidate, checked: nextChecked }
          : candidate
      )

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: updatedItems,
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError

      return {
        rowId,
        checked: nextChecked,
        updated_at: new Date().toISOString(),
      }
    },
    onMutate: async (item) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const rowId = requireShoppingRowId(item, "optimistic checked shopping item")

      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((candidate) =>
              candidate.rowId === rowId
                ? { ...candidate, checked: !candidate.checked }
                : candidate
            ),
          }
        }
      )

      return { previousList }
    },
    onError: (err, item, context) => {
      rollbackQueryData(queryClient, SHOPPING_KEY, context?.previousList)
    },
    onSuccess: (result) => {
      reconcileQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((candidate) =>
              candidate.rowId === result.rowId
                ? { ...candidate, checked: result.checked }
                : candidate
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
      const rowIds = new Set(itemsToCheck.map((item) => requireShoppingRowId(item, "bulk checked shopping item")))

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const currentItems = ensureShoppingItemsHaveRowIds(
        ((currentList as { items?: ShoppingItem[] } | null)?.items) || []
      ).items

      const updatedItems = currentItems.map((item) =>
        item.rowId && rowIds.has(item.rowId)
          ? { ...item, checked: true }
          : item
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
    onMutate: async (itemsToCheck) => {
      const { previousData: previousList } =
        await cancelQueriesAndSnapshot<ShoppingList>(queryClient, SHOPPING_KEY)

      const rowIds = new Set(itemsToCheck.map((item) => requireShoppingRowId(item, "optimistic bulk checked shopping item")))

      setOptimisticQueryData<ShoppingList>(
        queryClient,
        SHOPPING_KEY,
        (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map((item) =>
              item.rowId && rowIds.has(item.rowId)
                ? { ...item, checked: true }
                : item
            ),
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
      const ensuredItems = ensureShoppingItemsHaveRowIds(newItems).items
      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ items: ensuredItems, custom_order: true })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return ensuredItems
    },
    onSuccess: () => {
      return invalidateQuery(queryClient, SHOPPING_KEY)
    },
  })
}
