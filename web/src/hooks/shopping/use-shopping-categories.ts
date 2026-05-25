"use client"

/**
 * Shopping list category operations
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingItem, UserConfig } from "@/types/database"
import { requireShoppingRowId } from "@/lib/shopping-row-identity"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import { createShoppingPurchaseKey } from "@/lib/shopping-list-normalization"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { DEFAULT_RECIPE_CATEGORIES, DEFAULT_RECIPE_SELECTION, DEFAULT_USER_CONFIG } from "@/lib/user-config"
import { SHOPPING_KEY, CONFIG_KEY, SHOPPING_LIST_WRITE_SCOPE_ID } from "./shared"

/**
 * Hook to save a category override for an item
 */
export function useSaveCategoryOverride() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ itemName, categoryKey }: { itemName: string; categoryKey: string }) => {
      const normalizedItem = createShoppingPurchaseKey(itemName)

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
        const userConfigUpdate = updateSupabase.from("user_config") as unknown as {
          update: (values: { category_overrides: Record<string, string> }) => {
            eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>
          }
        }
        const { error: saveError } = await userConfigUpdate
          .update({ category_overrides: updatedOverrides })
          .eq("user_id", user!.id)
        if (saveError) throw saveError
      } else {
        // Insert new config (shouldn't happen normally, but handle it)
        const insertSupabase = getSupabase()
        const userConfigInsert = insertSupabase.from("user_config") as unknown as {
          insert: (values: {
            user_id: string
            category_overrides: Record<string, string>
            categories: string[]
            default_selection: Record<string, number>
            excluded_keywords: unknown[]
            history_exclusion_days: number | null
            week_start_day: number | null
          }) => Promise<{ error: { message: string } | null }>
        }
        const { error: saveError } = await userConfigInsert
          .insert({
            user_id: user!.id,
            category_overrides: updatedOverrides,
            categories: [...DEFAULT_RECIPE_CATEGORIES],
            default_selection: { ...DEFAULT_RECIPE_SELECTION },
            excluded_keywords: [...(DEFAULT_USER_CONFIG.excluded_keywords ?? [])],
            history_exclusion_days: DEFAULT_USER_CONFIG.history_exclusion_days,
            week_start_day: DEFAULT_USER_CONFIG.week_start_day,
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
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async ({ item, newCategoryKey, items }: {
      item: ShoppingItem; newCategoryKey: string; items: ShoppingItem[]
    }) => {
      const rowId = requireShoppingRowId(item, "recategorized shopping item")
      const categoryData = SHOPPING_CATEGORIES[newCategoryKey]

      const updatedItems = items.map((item) =>
        item.rowId === rowId
          ? { ...item, categoryKey: newCategoryKey, categoryOrder: categoryData?.order || 8 }
          : item
      )

      const supabase = getSupabase()
      const shoppingListUpdate = supabase.from("shopping_list") as unknown as {
        update: (values: { items: ShoppingItem[]; custom_order: boolean }) => {
          eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>
        }
      }
      const { error: saveError } = await shoppingListUpdate
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
