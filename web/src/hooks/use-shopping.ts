"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem, UserConfig } from "@/types/database"
import { generateShoppingList, ensureCategoryInfo } from "@/lib/shopping-list"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"

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

      // Fetch user's category overrides
      const { data: config } = await supabase
        .from("user_config")
        .select("category_overrides")
        .eq("id", 1)
        .single()

      const categoryOverrides = (config?.category_overrides as Record<string, string>) || {}

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const customOrder = currentList?.custom_order || false

      // Check if item already exists
      if (currentItems.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
        throw new Error("Item already in shopping list")
      }

      // Create new item with category info (using saved category overrides)
      const newItem = ensureCategoryInfo(
        {
          item: itemName.toLowerCase().trim(),
          amount: amount || null,
          unit: unit || "",
          categoryKey: "",
          categoryOrder: 5,
          sources: [{ recipeName: "Manual" }],
        },
        categoryOverrides
      )

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
 * Hook to remove all items associated with a specific recipe from the shopping list
 * - Items that only have this recipe as a source are removed entirely
 * - Items with multiple sources have this recipe removed from their sources
 */
export function useRemoveRecipeItems() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (recipeName: string) => {
      const supabase = getSupabase()

      // Get current list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have")
        .eq("id", 1)
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []

      // Process items: remove recipe from sources, remove item if no sources left
      const updatedItems = currentItems
        .map((item) => {
          if (!item.sources) return item
          
          // Filter out the recipe from sources
          const newSources = item.sources.filter(
            (s) => s.recipeName !== recipeName
          )
          
          // If no sources left, mark for removal by returning null
          if (newSources.length === 0) return null
          
          return { ...item, sources: newSources }
        })
        .filter((item): item is ShoppingItem => item !== null)

      // Also process already_have items the same way
      const updatedAlreadyHave = alreadyHave
        .map((item) => {
          if (!item.sources) return item
          
          const newSources = item.sources.filter(
            (s) => s.recipeName !== recipeName
          )
          
          if (newSources.length === 0) return null
          
          return { ...item, sources: newSources }
        })
        .filter((item): item is ShoppingItem => item !== null)

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({ 
          items: updatedItems,
          already_have: updatedAlreadyHave,
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return { 
        recipeName, 
        removedCount: currentItems.length - updatedItems.length 
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to add meal plan ingredients to existing shopping list
 * (excludes pantry items, excluded keywords, and items already in the list)
 */
export function useAddToShoppingList() {
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

      // Fetch current shopping list
      const { data: currentList, error: listError } = await supabase
        .from("shopping_list")
        .select("*")
        .eq("id", 1)
        .maybeSingle()

      if (listError) throw listError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const customOrder = currentList?.custom_order || false

      // Generate shopping list from recipes
      const result = generateShoppingList(
        recipes as Recipe[],
        pantryItems as PantryItem[],
        excludedKeywords,
        scale
      )

      // Build a map of current items for quick lookup (by item name only)
      const currentItemMap = new Map<string, ShoppingItem>()
      for (const item of currentItems) {
        const key = item.item.toLowerCase()
        currentItemMap.set(key, item)
      }

      // Merge new items with existing items
      let addedCount = 0
      let mergedCount = 0
      
      for (const newItem of result.items) {
        const key = newItem.item.toLowerCase()
        const existingItem = currentItemMap.get(key)
        
        if (existingItem) {
          // Combine sources, avoiding duplicates
          const existingSources = existingItem.sources || []
          const newSources = newItem.sources || []
          const sourceSet = new Set(existingSources.map(s => s.recipeName))
          const combinedSources = [...existingSources]
          for (const source of newSources) {
            if (!sourceSet.has(source.recipeName)) {
              combinedSources.push(source)
              sourceSet.add(source.recipeName)
            }
          }

          // Try to merge amounts using unit conversion
          const mergeResult = mergeAmounts(
            existingItem.amount,
            existingItem.unit,
            newItem.amount,
            newItem.unit
          )

          if (mergeResult) {
            // Units are compatible - merge into single amount
            currentItemMap.set(key, {
              ...existingItem,
              amount: roundForDisplay(mergeResult.amount),
              unit: mergeResult.unit,
              sources: combinedSources,
              // Clear any previous additionalAmounts since we merged successfully
              additionalAmounts: undefined,
            })
          } else {
            // Units are incompatible - add to additionalAmounts
            const existingAdditional = existingItem.additionalAmounts || []
            const newAmount = { amount: newItem.amount || 0, unit: newItem.unit }
            
            currentItemMap.set(key, {
              ...existingItem,
              sources: combinedSources,
              additionalAmounts: [...existingAdditional, newAmount],
            })
          }
          mergedCount++
        } else {
          // New item - add to map
          currentItemMap.set(key, newItem)
          addedCount++
        }
      }

      // Convert map back to array
      let updatedItems = Array.from(currentItemMap.values())

      // Sort if not custom ordered
      if (!customOrder) {
        updatedItems.sort((a, b) => {
          if (a.categoryOrder !== b.categoryOrder) {
            return a.categoryOrder - b.categoryOrder
          }
          return a.item.localeCompare(b.item)
        })
      }

      // Merge source recipes
      const existingSourceRecipes = (currentList?.source_recipes as string[]) || []
      const mergedSourceRecipes = [...new Set([...existingSourceRecipes, ...recipeIds])]

      // Save to database
      const shoppingListData = {
        id: 1,
        items: updatedItems,
        already_have: result.alreadyHave,
        excluded: result.excluded,
        source_recipes: mergedSourceRecipes,
        scale: scale,
        total_servings: (currentList?.total_servings || 0) + result.totalServings,
        custom_order: customOrder,
        generated_at: new Date().toISOString(),
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .upsert(shoppingListData)

      if (saveError) throw saveError

      return { 
        added: addedCount, 
        merged: mergedCount,
        shoppingList: shoppingListData as ShoppingList 
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to check off a shopping item (move to "already have" section)
 */
export function useCheckOffItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const supabase = getSupabase()

      const normalizedItem = item.item.toLowerCase().trim()

      // Get current shopping list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have")
        .eq("id", 1)
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []

      // Remove from items
      const updatedItems = currentItems.filter(
        (i) => i.item.toLowerCase() !== normalizedItem
      )

      // Add to already_have if not already there
      const alreadyInHave = alreadyHave.some(
        (i) => i.item.toLowerCase() === normalizedItem
      )
      const updatedAlreadyHave = alreadyInHave 
        ? alreadyHave 
        : [...alreadyHave, item]

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({ 
          items: updatedItems,
          already_have: updatedAlreadyHave 
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return item
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

/**
 * Hook to move an item from "already have" back to the shopping list
 */
export function useMoveToShoppingList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const supabase = getSupabase()

      // Get current shopping list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, custom_order")
        .eq("id", 1)
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []
      const customOrder = currentList?.custom_order || false

      const normalizedItem = item.item.toLowerCase().trim()

      // Remove from already_have
      const updatedAlreadyHave = alreadyHave.filter(
        (i) => i.item.toLowerCase() !== normalizedItem
      )

      // Add to items if not already there
      const alreadyInItems = currentItems.some(
        (i) => i.item.toLowerCase() === normalizedItem
      )

      let updatedItems = currentItems
      if (!alreadyInItems) {
        updatedItems = [...currentItems, item]

        // Sort if not custom ordered
        if (!customOrder) {
          updatedItems.sort((a, b) => {
            if (a.categoryOrder !== b.categoryOrder) {
              return a.categoryOrder - b.categoryOrder
            }
            return a.item.localeCompare(b.item)
          })
        }
      }

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          already_have: updatedAlreadyHave,
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to move an item from "excluded" back to the shopping list
 */
export function useMoveExcludedToShoppingList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const supabase = getSupabase()

      // Get current shopping list
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, excluded, custom_order")
        .eq("id", 1)
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const excluded = (currentList?.excluded as ShoppingItem[]) || []
      const customOrder = currentList?.custom_order || false

      const normalizedItem = item.item.toLowerCase().trim()

      // Remove from excluded
      const updatedExcluded = excluded.filter(
        (i) => i.item.toLowerCase() !== normalizedItem
      )

      // Add to items if not already there
      const alreadyInItems = currentItems.some(
        (i) => i.item.toLowerCase() === normalizedItem
      )

      let updatedItems = currentItems
      if (!alreadyInItems) {
        updatedItems = [...currentItems, item]

        // Sort if not custom ordered
        if (!customOrder) {
          updatedItems.sort((a, b) => {
            if (a.categoryOrder !== b.categoryOrder) {
              return a.categoryOrder - b.categoryOrder
            }
            return a.item.localeCompare(b.item)
          })
        }
      }

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          excluded: updatedExcluded,
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return item
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to reorder shopping list items (via drag and drop)
 */
export function useReorderShoppingList() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (newItems: ShoppingItem[]) => {
      const supabase = getSupabase()

      // Save the new order with custom_order flag set to true
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: newItems,
          custom_order: true,
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return newItems
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to save a category override for an item
 * This learns the user's preference for item categorization
 */
export function useSaveCategoryOverride() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      itemName,
      categoryKey,
    }: {
      itemName: string
      categoryKey: string
    }) => {
      const supabase = getSupabase()

      // Get current config
      const { data: config, error: fetchError } = await supabase
        .from("user_config")
        .select("category_overrides")
        .eq("id", 1)
        .single()

      if (fetchError && fetchError.code !== "PGRST116") throw fetchError

      const currentOverrides = (config?.category_overrides as Record<string, string>) || {}

      // Add/update the override
      const normalizedItem = itemName.toLowerCase().trim()
      const updatedOverrides = {
        ...currentOverrides,
        [normalizedItem]: categoryKey,
      }

      // Save
      const { error: saveError } = await supabase
        .from("user_config")
        .update({ category_overrides: updatedOverrides })
        .eq("id", 1)

      if (saveError) throw saveError

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

  return useMutation({
    mutationFn: async ({
      itemName,
      newCategoryKey,
      items,
    }: {
      itemName: string
      newCategoryKey: string
      items: ShoppingItem[]
    }) => {
      const supabase = getSupabase()

      const normalizedItem = itemName.toLowerCase().trim()
      const categoryData = SHOPPING_CATEGORIES[newCategoryKey]
      
      // Update the item's category in the list
      const updatedItems = items.map((item) => {
        if (item.item.toLowerCase() === normalizedItem) {
          return {
            ...item,
            categoryKey: newCategoryKey,
            categoryOrder: categoryData?.order || 8,
          }
        }
        return item
      })

      // Save
      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          custom_order: true,
        })
        .eq("id", 1)

      if (saveError) throw saveError

      return updatedItems
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
