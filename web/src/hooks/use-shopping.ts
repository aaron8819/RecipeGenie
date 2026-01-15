"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem } from "@/types/database"
import { generateShoppingList, ensureCategoryInfo } from "@/lib/shopping-list"

const SHOPPING_KEY = ["shopping_list"]
const PANTRY_KEY = ["pantry"]
const CONFIG_KEY = ["user_config"]
const RECIPES_KEY = ["recipes"]

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Hook to fetch the shopping list
 */
export function useShoppingList() {
  return useQuery({
    queryKey: SHOPPING_KEY,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("shopping_list")
        .select("*")
        .eq("id", 1)
        .maybeSingle()

      if (error) throw error

      // Return empty shopping list if none exists
      if (!data) {
        return {
          id: 1,
          items: [],
          already_have: [],
          excluded: [],
          source_recipes: [],
          scale: 1.0,
          total_servings: 0,
          custom_order: false,
          generated_at: "",
        } as ShoppingList
      }

      return data as ShoppingList
    },
  })
}

/**
 * Hook to generate a shopping list from recipes
 */
export function useGenerateShoppingList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      recipeIds,
      scale = 1.0,
    }: {
      recipeIds: string[]
      scale?: number
    }) => {
      const supabase = getSupabase()

      // Fetch recipes
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")
        .in("id", recipeIds)

      if (recipesError) throw recipesError

      // Fetch pantry items
      const { data: pantryItems, error: pantryError } = await supabase
        .from("pantry_items")
        .select("*")

      if (pantryError) throw pantryError

      // Fetch excluded keywords
      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("id", 1)
        .single()

      const excludedKeywords = (config?.excluded_keywords as string[]) || []

      // Generate shopping list
      const result = generateShoppingList(
        recipes as Recipe[],
        pantryItems as PantryItem[],
        excludedKeywords,
        scale
      )

      // Save to database
      const shoppingListData = {
        id: 1,
        items: result.items,
        already_have: result.alreadyHave,
        excluded: result.excluded,
        source_recipes: recipeIds,
        scale: result.scale,
        total_servings: result.totalServings,
        custom_order: false,
        generated_at: new Date().toISOString(),
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .upsert(shoppingListData)

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

  return useMutation({
    mutationFn: async (shoppingList: Partial<ShoppingList>) => {
      const supabase = getSupabase()

      const { error } = await supabase
        .from("shopping_list")
        .update({
          ...shoppingList,
          generated_at: new Date().toISOString(),
        })
        .eq("id", 1)

      if (error) throw error
      return shoppingList
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to add a manual item to the shopping list
 */
export function useAddShoppingItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      itemName,
      amount,
      unit,
    }: {
      itemName: string
      amount?: number
      unit?: string
    }) => {
      const supabase = getSupabase()

      // Get current list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, custom_order")
        .eq("id", 1)
        .single()

      if (fetchError && fetchError.code !== "PGRST116") throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const customOrder = currentList?.custom_order || false

      // Check if item already exists
      if (currentItems.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
        throw new Error("Item already in shopping list")
      }

      // Create new item with category info
      const newItem = ensureCategoryInfo({
        item: itemName.toLowerCase().trim(),
        amount: amount || null,
        unit: unit || "",
        categoryKey: "",
        categoryOrder: 5,
        sources: [{ recipeName: "Manual" }],
      })

      // Add to items
      let updatedItems = [...currentItems, newItem]

      // Sort if not custom ordered
      if (!customOrder) {
        updatedItems.sort((a, b) => {
          if (a.categoryOrder !== b.categoryOrder) {
            return a.categoryOrder - b.categoryOrder
          }
          return a.item.localeCompare(b.item)
        })
      }

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({ items: updatedItems })
        .eq("id", 1)

      if (saveError) throw saveError

      return newItem
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to remove an item from the shopping list
 */
export function useRemoveShoppingItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (itemName: string) => {
      const supabase = getSupabase()

      // Get current list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items")
        .eq("id", 1)
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []

      // Remove item
      const updatedItems = currentItems.filter(
        (i) => i.item.toLowerCase() !== itemName.toLowerCase()
      )

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({ items: updatedItems })
        .eq("id", 1)

      if (saveError) throw saveError

      return itemName
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

  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabase()

      const { error } = await supabase
        .from("shopping_list")
        .update({
          items: [],
          already_have: [],
          excluded: [],
          source_recipes: [],
          scale: 1.0,
          total_servings: 0,
          custom_order: false,
          generated_at: new Date().toISOString(),
        })
        .eq("id", 1)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
