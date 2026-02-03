"use client"

/**
 * Core shopping list queries and generation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem } from "@/types/database"
import { generateShoppingList } from "@/lib/shopping-list"
import { normalizeItemName } from "@/lib/shopping-list-normalization"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, PANTRY_KEY, CONFIG_KEY } from "./shared"

/**
 * Hook to fetch the shopping list
 */
export function useShoppingList() {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: [...SHOPPING_KEY],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("shopping_list")
        .select("*")
        .maybeSingle()

      if (error) throw error
      if (data) return data as ShoppingList
      return {
        user_id: user?.id || "",
        items: [],
        already_have: [],
        excluded: [],
        source_recipes: [],
        scale: 1.0,
        total_servings: 0,
        custom_order: false,
        generated_at: new Date().toISOString(),
      } as ShoppingList
    },
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    enabled: !!user,
  })
}

/**
 * Hook to generate a shopping list from recipes
 */
export function useGenerateShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ recipeIds, scale = 1.0 }: { recipeIds: string[]; scale?: number }) => {
      const supabase = getSupabase()

      // Fetch current list, recipes, pantry, and config in parallel
      const [recipesRes, pantryRes, configRes, currentListRes] = await Promise.all([
        supabase.from("recipes").select("*").in("id", recipeIds),
        supabase.from("pantry_items").select("*"),
        supabase.from("user_config").select("excluded_keywords, category_overrides").single(),
        supabase.from("shopping_list").select("already_have").maybeSingle(),
      ])

      if (recipesRes.error) throw recipesRes.error
      if (pantryRes.error) throw pantryRes.error

      const recipes = recipesRes.data as Recipe[]
      const pantryItems = pantryRes.data as PantryItem[]
      const typedConfig = configRes.data as { excluded_keywords?: string[]; category_overrides?: Record<string, string> } | null
      const currentList = currentListRes.data as { already_have?: ShoppingItem[] } | null

      // Get currently checked item names to preserve
      const checkedItemNames = new Set(
        (currentList?.already_have || []).map(item => normalizeItemName(item.item))
      )

      const result = generateShoppingList(
        recipes,
        pantryItems,
        typedConfig?.excluded_keywords || [],
        scale,
        typedConfig?.category_overrides || null
      )

      // Preserve checked states: move items that were previously checked to already_have
      const preservedItems: ShoppingItem[] = []
      const preservedAlreadyHave: ShoppingItem[] = [...result.alreadyHave]

      for (const item of result.items) {
        if (checkedItemNames.has(normalizeItemName(item.item))) {
          preservedAlreadyHave.push(item)
        } else {
          preservedItems.push(item)
        }
      }

      const shoppingListData = {
        user_id: user!.id,
        items: preservedItems,
        already_have: preservedAlreadyHave,
        excluded: result.excluded,
        source_recipes: recipeIds,
        scale: result.scale,
        total_servings: result.totalServings,
        custom_order: false,
        generated_at: new Date().toISOString(),
      }

      // Check if list exists first (we already fetched it above)
      const existingList = currentList

      let saveError
      if (existingList) {
        // Row exists, use update (RLS will filter by user_id, but PostgREST requires a WHERE clause)
        const { error } = await supabase
          .from("shopping_list")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update(shoppingListData)
          .eq("user_id", user!.id)
        saveError = error
      } else {
        // Row doesn't exist, use insert
        const { error } = await supabase
          .from("shopping_list")
          // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
          .insert(shoppingListData)
        saveError = error
      }
      if (saveError) throw saveError

      return shoppingListData as ShoppingList
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to save the shopping list
 */
export function useSaveShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (shoppingList: Partial<ShoppingList>) => {
      const supabase = getSupabase()

      // Check if list exists
      const { data: existingList } = await supabase
        .from("shopping_list")
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle()

      if (existingList) {
        // Update existing list
        const { error } = await supabase
          .from("shopping_list")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ ...shoppingList, generated_at: new Date().toISOString() })
          .eq("user_id", user!.id)
        if (error) throw error
      } else {
        // Insert new list
        const { error } = await supabase
          .from("shopping_list")
          // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
          .insert({ ...shoppingList, user_id: user!.id, generated_at: new Date().toISOString() })
        if (error) throw error
      }

      return shoppingList
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to clear the shopping list
 */
export function useClearShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async () => {
      const emptyList = {
        items: [],
        already_have: [],
        excluded: [],
        source_recipes: [],
        scale: 1.0,
        total_servings: 0,
        custom_order: false,
      }

      const supabase = getSupabase()
      const { error } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ ...emptyList, generated_at: new Date().toISOString() })
        .eq("user_id", user!.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
