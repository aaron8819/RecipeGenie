"use client"

/**
 * Shopping list category operations
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingItem, UserConfig } from "@/types/database"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, CONFIG_KEY, setGuestList, getGuestList } from "./shared"

/**
 * Hook to save a category override for an item
 */
export function useSaveCategoryOverride() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ itemName, categoryKey }: { itemName: string; categoryKey: string }) => {
      const normalizedItem = itemName.toLowerCase().trim()

      if (isGuest) {
        // Guest mode doesn't persist category overrides
        return { itemName: normalizedItem, categoryKey }
      }

      const supabase = getSupabase()
      const { data, error: fetchError } = await supabase
        .from("user_config")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle()

      if (fetchError) throw fetchError

      const config = data as UserConfig | null
      const updatedOverrides = {
        ...((config?.category_overrides as Record<string, string>) || {}),
        [normalizedItem]: categoryKey,
      }

      if (config) {
        // Update existing config - get fresh client to avoid type issues
        const updateSupabase = getSupabase()
        const { error: saveError } = await updateSupabase
          .from("user_config")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          // This is a known issue with Supabase type inference in certain contexts
          .update({ category_overrides: updatedOverrides })
          .eq("user_id", user!.id)
        if (saveError) throw saveError
      } else {
        // Insert new config (shouldn't happen normally, but handle it)
        const insertSupabase = getSupabase()
        const { error: saveError } = await insertSupabase
          .from("user_config")
          // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
          // This is a known issue with Supabase type inference in certain contexts
          .insert({
            user_id: user!.id,
            category_overrides: updatedOverrides,
            categories: ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"],
            default_selection: { chicken: 2, turkey: 1, steak: 1 },
            excluded_keywords: [],
            history_exclusion_days: 10,
            week_start_day: 1,
          })
        if (saveError) throw saveError
      }
      return { itemName: normalizedItem, categoryKey }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY })
    },
  })
}

/**
 * Hook to update an item's category in the shopping list
 */
export function useUpdateItemCategory() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ itemName, newCategoryKey, items }: {
      itemName: string; newCategoryKey: string; items: ShoppingItem[]
    }) => {
      const normalizedItem = itemName.toLowerCase().trim()
      const categoryData = SHOPPING_CATEGORIES[newCategoryKey]

      const updatedItems = items.map((item) =>
        item.item.toLowerCase() === normalizedItem
          ? { ...item, categoryKey: newCategoryKey, categoryOrder: categoryData?.order || 8 }
          : item
      )

      if (isGuest) {
        setGuestList(queryClient, { items: updatedItems, custom_order: true })
        return updatedItems
      }

      const supabase = getSupabase()
      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        // This is a known issue with Supabase type inference in certain contexts
        .update({ items: updatedItems, custom_order: true })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return updatedItems
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
