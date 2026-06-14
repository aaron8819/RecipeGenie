"use client"

/**
 * Core shopping list queries and generation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem } from "@/types/database"
import { ensureShoppingItemsHaveRowIds, ensureShoppingListRowIds } from "@/lib/shopping-row-identity"
import { generateShoppingList } from "@/lib/shopping-list"
import { normalizeShoppingItemOrderPreferences } from "@/lib/shopping-item-order"
import { normalizeItemName } from "@/lib/shopping-list-normalization"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, SHOPPING_LIST_WRITE_SCOPE_ID } from "./shared"
import { fetchShoppingGenerationConfig } from "./user-config-read"

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
      if (data) {
        const typedList = data as ShoppingList
        const ensured = ensureShoppingListRowIds(typedList)

        if (ensured.changed) {
          const { error: saveError } = await supabase
            .from("shopping_list")
            // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
            .update({
              items: ensured.shoppingList.items,
              already_have: ensured.shoppingList.already_have,
              excluded: ensured.shoppingList.excluded,
            })
            .eq("user_id", user!.id)

          if (saveError) throw saveError
        }

        return ensured.shoppingList
      }
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

export function preserveCheckedItemsFromExisting(
  generatedItems: ShoppingItem[],
  existingItems: ShoppingItem[]
): ShoppingItem[] {
  const checkedItemNames = new Set(
    existingItems
      .filter((item) => item.checked)
      .map((item) => normalizeItemName(item.item))
  )

  if (checkedItemNames.size === 0) return generatedItems

  return generatedItems.map((item) =>
    checkedItemNames.has(normalizeItemName(item.item))
      ? { ...item, checked: true }
      : item
  )
}

/**
 * Hook to generate a shopping list from recipes
 */
export function useGenerateShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async ({ recipeIds, scale = 1.0 }: { recipeIds: string[]; scale?: number }) => {
      const supabase = getSupabase()

      // Fetch current list, recipes, pantry, and config in parallel
      const [recipesRes, pantryRes, config, currentListRes] = await Promise.all([
        supabase.from("recipes").select("*").in("id", recipeIds),
        supabase.from("pantry_items").select("*"),
        fetchShoppingGenerationConfig(),
        supabase.from("shopping_list").select("items, already_have").maybeSingle(),
      ])

      if (recipesRes.error) throw recipesRes.error
      if (pantryRes.error) throw pantryRes.error

      const recipes = recipesRes.data as Recipe[]
      const pantryItems = pantryRes.data as PantryItem[]
      const currentList = currentListRes.data as { items?: ShoppingItem[]; already_have?: ShoppingItem[] } | null

      const result = generateShoppingList(
        recipes,
        pantryItems,
        config.excluded_keywords || [],
        scale,
        config.category_overrides || null,
        normalizeShoppingItemOrderPreferences(config.shopping_item_order)
      )

      // Preserve checked states without moving items into pantry
      const preservedItems = preserveCheckedItemsFromExisting(
        result.items,
        currentList?.items || []
      )
      const preservedAlreadyHave: ShoppingItem[] = [...result.alreadyHave]
      const ensuredItems = ensureShoppingItemsHaveRowIds(preservedItems)
      const ensuredAlreadyHave = ensureShoppingItemsHaveRowIds(preservedAlreadyHave)
      const ensuredExcluded = ensureShoppingItemsHaveRowIds(result.excluded)

      const shoppingListData = {
        user_id: user!.id,
        items: ensuredItems.items,
        already_have: ensuredAlreadyHave.items,
        excluded: ensuredExcluded.items,
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
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
    mutationFn: async (shoppingList: Partial<ShoppingList>) => {
      const supabase = getSupabase()
      // shopping_list.user_id is the PRIMARY KEY — upsert resolves in 1 RTT
      const { error } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers upsert parameter type as 'never'
        .upsert(
          { ...shoppingList, user_id: user!.id, generated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
      if (error) throw error
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
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: SHOPPING_LIST_WRITE_SCOPE_ID },
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
      return undefined
    },
  })
}
