"use client"

/**
 * Core shopping list queries and generation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem } from "@/types/database"
import { generateShoppingList } from "@/lib/shopping-list"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultShoppingList } from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, PANTRY_KEY, CONFIG_KEY, getGuestList, setGuestList } from "./shared"

/**
 * Hook to fetch the shopping list
 */
export function useShoppingList() {
  const { isGuest } = useAuthContext()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: [...SHOPPING_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) {
        return getGuestList(queryClient)
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("shopping_list")
        .select("*")
        .maybeSingle()

      if (error) throw error
      return (data as ShoppingList | null) || (getDefaultShoppingList() as ShoppingList)
    },
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
  })
}

/**
 * Hook to generate a shopping list from recipes
 */
export function useGenerateShoppingList() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ recipeIds, scale = 1.0 }: { recipeIds: string[]; scale?: number }) => {
      if (isGuest) {
        const allRecipes = getDefaultRecipes()
        const recipes = allRecipes.filter((r) => recipeIds.includes(r.id))
        const pantryItems = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY, true]) || []
        const excludedKeywords = queryClient.getQueryData<string[]>([...CONFIG_KEY, "excluded_keywords", true]) || []

        const result = generateShoppingList(recipes, pantryItems, excludedKeywords, scale)

        const list: ShoppingList = {
          user_id: "guest",
          items: result.items,
          already_have: result.alreadyHave,
          excluded: result.excluded,
          source_recipes: recipeIds,
          scale: result.scale,
          total_servings: result.totalServings,
          custom_order: false,
          generated_at: new Date().toISOString(),
        }
        setGuestList(queryClient, list)
        return list
      }

      const supabase = getSupabase()

      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")
        .in("id", recipeIds)
      if (recipesError) throw recipesError

      const { data: pantryItems, error: pantryError } = await supabase
        .from("pantry_items")
        .select("*")
      if (pantryError) throw pantryError

      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .single()

      const typedConfig = config as { excluded_keywords?: string[] } | null
      const result = generateShoppingList(
        recipes as Recipe[],
        pantryItems as PantryItem[],
        typedConfig?.excluded_keywords || [],
        scale
      )

      const shoppingListData = {
        user_id: user!.id,
        items: result.items,
        already_have: result.alreadyHave,
        excluded: result.excluded,
        source_recipes: recipeIds,
        scale: result.scale,
        total_servings: result.totalServings,
        custom_order: false,
        generated_at: new Date().toISOString(),
      }

      // Check if list exists first
      const { data: existingList } = await supabase
        .from("shopping_list")
        .select("user_id")
        .maybeSingle()

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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (shoppingList: Partial<ShoppingList>) => {
      if (isGuest) {
        setGuestList(queryClient, shoppingList)
        return shoppingList
      }

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
  const { isGuest, user } = useAuthContext()

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

      if (isGuest) {
        setGuestList(queryClient, emptyList)
        return
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
