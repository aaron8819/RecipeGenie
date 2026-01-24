"use client"

/**
 * Shopping list item operations: add, remove, check, reorder
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem } from "@/types/database"
import { ensureCategoryInfo } from "@/lib/shopping-list"
import { normalizeItemName, normalizeUnit } from "@/lib/shopping-list-normalization"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultShoppingList, getDefaultConfig } from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, getGuestList, setGuestList } from "./shared"

/**
 * Hook to add a manual item to the shopping list
 * Implements optimistic updates for instant UI feedback
 */
export function useAddShoppingItem() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ itemName, amount, unit }: { itemName: string; amount?: number; unit?: string }) => {
      const categoryOverrides = isGuest
        ? getDefaultConfig().category_overrides
        : ((await getSupabase().from("user_config").select("category_overrides").single()).data as { category_overrides?: Record<string, string> } | null)?.category_overrides || {}

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

      if (isGuest) {
        const current = getGuestList(queryClient)
        if (current.items.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
          throw new Error("Item already in shopping list")
        }
        let updatedItems = [...current.items, newItem]
        if (!current.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
        setGuestList(queryClient, { items: updatedItems })
        return newItem
      }

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
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, isGuest])

      // Get category overrides for optimistic item creation
      const categoryOverrides = isGuest
        ? getDefaultConfig().category_overrides
        : ((await getSupabase().from("user_config").select("category_overrides").single()).data as { category_overrides?: Record<string, string> } | null)?.category_overrides || {}

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
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY, isGuest],
        (old) => {
          if (!old) {
            const defaultList = getDefaultShoppingList() as ShoppingList
            return { ...defaultList, items: [optimisticItem] }
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
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY, isGuest], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to remove an item from the shopping list
 * Implements optimistic updates for instant UI feedback
 */
export function useRemoveShoppingItem() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (itemName: string) => {
      if (isGuest) {
        const current = getGuestList(queryClient)
        setGuestList(queryClient, {
          items: current.items.filter((i) => i.item.toLowerCase() !== itemName.toLowerCase()),
        })
        return itemName
      }

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
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, isGuest])

      // Optimistically remove from cache
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY, isGuest],
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
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY, isGuest], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()

      if (isGuest) {
        const current = getGuestList(queryClient)
        const updatedItems = current.items.map((i) =>
          i.item.toLowerCase() === normalizedItem
            ? { ...i, checked: !i.checked }
            : i
        )

        setGuestList(queryClient, {
          items: updatedItems,
        })
        return { ...item, checked: !item.checked }
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[] } | null
      const currentItems = typedList?.items || []
      const updatedItems = currentItems.map((i) =>
        i.item.toLowerCase() === normalizedItem
          ? { ...i, checked: !i.checked }
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
      return updatedItems.find((i) => i.item.toLowerCase() === normalizedItem) || item
    },
    // Optimistic update
    onMutate: async (item) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, isGuest])

      const normalizedItem = item.item.toLowerCase().trim()

      // Optimistically update cache
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY, isGuest],
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
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY, isGuest], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to check off multiple items at once (toggle checked state)
 * Used for "Check All" in a category - checks all items in the category
 */
export function useBulkCheckOff() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (itemsToCheck: ShoppingItem[]) => {
      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      if (isGuest) {
        const current = getGuestList(queryClient)
        // Check all items (set checked to true)
        const updatedItems = current.items.map(i =>
          itemNames.has(i.item.toLowerCase().trim())
            ? { ...i, checked: true }
            : i
        )

        setGuestList(queryClient, {
          items: updatedItems,
        })
        return { count: itemsToCheck.length }
      }

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
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: SHOPPING_KEY })

      // Snapshot previous value for rollback
      const previousList = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, isGuest])

      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      // Optimistically update cache
      queryClient.setQueryData<ShoppingList>(
        [...SHOPPING_KEY, isGuest],
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
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData([...SHOPPING_KEY, isGuest], context.previousList)
      }
    },
    onSuccess: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to reorder shopping list items
 */
export function useReorderShoppingList() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (newItems: ShoppingItem[]) => {
      if (isGuest) {
        setGuestList(queryClient, { items: newItems, custom_order: true })
        return newItems
      }

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
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
