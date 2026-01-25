"use client"

/**
 * Recipe-related shopping list operations
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem } from "@/types/database"
import { generateShoppingList } from "@/lib/shopping-list"
import { mergeShoppingItems, removeRecipeByNameFromItems } from "@/lib/shopping-list-merging"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultShoppingList, getDefaultConfig } from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"
import { SHOPPING_KEY, PANTRY_KEY, CONFIG_KEY, getGuestList, setGuestList } from "./shared"

/**
 * Hook to remove all items associated with a specific recipe
 */
export function useRemoveRecipeItems() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeName: string) => {
      // Use the unified remove function
      const filterItems = (items: ShoppingItem[]) => removeRecipeByNameFromItems(items, recipeName)

      if (isGuest) {
        const current = getGuestList(queryClient)
        const filteredActiveItems = filterItems(current.items)
        const filteredAlreadyHave = filterItems(current.already_have)
        const filteredExcluded = filterItems(current.excluded || [])

        // Check if any items (checked or unchecked) still reference this recipe
        const allItems = [...filteredActiveItems, ...filteredAlreadyHave, ...filteredExcluded]
        const hasRecipeItems = allItems.some((item) =>
          item.sources?.some((s) => s.recipeName === recipeName)
        )

        // Remove recipe ID from source_recipes if no items remain
        let updatedSourceRecipes = current.source_recipes || []
        if (!hasRecipeItems) {
          // For guest mode, we need to find recipe ID from name
          // Since we don't have easy access, we'll clear all if we can't match
          // In practice, this is fine since guest mode is temporary
          const allRecipes = getDefaultRecipes()
          const recipe = allRecipes.find((r) => r.name === recipeName)
          if (recipe) {
            updatedSourceRecipes = updatedSourceRecipes.filter((id) => id !== recipe.id)
          }
        }

        setGuestList(queryClient, {
          items: filteredActiveItems,
          already_have: filteredAlreadyHave,
          excluded: filteredExcluded,
          source_recipes: updatedSourceRecipes,
        })
        return { recipeName, removedCount: 0 }
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, excluded, source_recipes")
        .single()

      if (fetchError) throw fetchError

      const typedList = currentList as { items?: ShoppingItem[]; already_have?: ShoppingItem[]; excluded?: ShoppingItem[]; source_recipes?: string[] } | null
      const filteredActiveItems = filterItems(typedList?.items || [])
      const filteredAlreadyHave = filterItems(typedList?.already_have || [])
      const filteredExcluded = filterItems(typedList?.excluded || [])

      // Check if any items (checked or unchecked) still reference this recipe
      const allItems = [...filteredActiveItems, ...filteredAlreadyHave, ...filteredExcluded]
      const hasRecipeItems = allItems.some((item) =>
        item.sources?.some((s) => s.recipeName === recipeName)
      )

      // Remove recipe ID from source_recipes if no items remain
      let updatedSourceRecipes = typedList?.source_recipes || []
      if (!hasRecipeItems) {
        // Find recipe ID from recipe name
        const { data: recipe } = await supabase
          .from("recipes")
          .select("id, name")
          .eq("user_id", user!.id)
          .eq("name", recipeName)
          .maybeSingle()

        const typedRecipe = recipe as { id: string; name: string } | null
        if (typedRecipe) {
          updatedSourceRecipes = updatedSourceRecipes.filter((id) => id !== typedRecipe.id)
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({
          items: filteredActiveItems,
          already_have: filteredAlreadyHave,
          excluded: filteredExcluded,
          source_recipes: updatedSourceRecipes,
        })
        .eq("user_id", user!.id)

      if (saveError) throw saveError
      return { recipeName, removedCount: 0 }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to add meal plan ingredients to existing shopping list
 */
export function useAddToShoppingList() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ recipeIds, scale = 1.0 }: { recipeIds: string[]; scale?: number }) => {
      let recipes: Recipe[]
      let pantryItems: PantryItem[]
      let excludedKeywords: string[]
      let currentList: ShoppingList
      let listExists = false

      if (isGuest) {
        const allRecipes = getDefaultRecipes()
        recipes = allRecipes.filter((r) => recipeIds.includes(r.id))
        pantryItems = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY, true]) || []
        excludedKeywords = queryClient.getQueryData<string[]>([...CONFIG_KEY, "excluded_keywords", true]) || []
        currentList = getGuestList(queryClient)
      } else {
        const supabase = getSupabase()
        const [recipesRes, pantryRes, configRes, listRes] = await Promise.all([
          supabase.from("recipes").select("*").in("id", recipeIds),
          supabase.from("pantry_items").select("*"),
          supabase.from("user_config").select("excluded_keywords").single(),
          supabase.from("shopping_list").select("*").maybeSingle(),
        ])

        if (recipesRes.error) throw recipesRes.error
        if (pantryRes.error) throw pantryRes.error

        recipes = recipesRes.data as Recipe[]
        pantryItems = pantryRes.data as PantryItem[]
        const typedConfig = configRes.data as { excluded_keywords?: string[] } | null
        excludedKeywords = typedConfig?.excluded_keywords || []
        currentList = (listRes.data as ShoppingList | null) || (getDefaultShoppingList() as ShoppingList)
        listExists = !!listRes.data
      }

      const result = generateShoppingList(recipes, pantryItems, excludedKeywords, scale)

      // Get user category overrides for merging (already fetched above for excluded keywords)
      let categoryOverrides: Record<string, string> = {}
      if (isGuest) {
        categoryOverrides = getDefaultConfig().category_overrides || {}
      } else {
        // Reuse configRes from above if available, otherwise fetch
        const configRes = await getSupabase().from("user_config").select("category_overrides").single()
        const typedConfigRes = configRes.data as { category_overrides?: Record<string, string> } | null
        categoryOverrides = typedConfigRes?.category_overrides || {}
      }

      // Merge items using unified merging function
      const existingCount = currentList.items.length
      const updatedItems = mergeShoppingItems(
        currentList.items,
        result.items,
        {
          preserveUserOverrides: true,
          preserveCustomOrder: currentList.custom_order || false,
          userCategoryOverrides: categoryOverrides,
        }
      )

      // If custom order is enabled, insert new items at end of their category section
      // This maintains the user's category grouping
      if (currentList.custom_order && updatedItems.length > existingCount) {
        const existingItems = updatedItems.slice(0, existingCount)
        const newItems = updatedItems.slice(existingCount)

        // Group new items by category
        const newItemsByCategory = new Map<string, ShoppingItem[]>()
        for (const item of newItems) {
          const category = item.categoryKey
          if (!newItemsByCategory.has(category)) {
            newItemsByCategory.set(category, [])
          }
          newItemsByCategory.get(category)!.push(item)
        }

        // Find the last index of each category in existing items
        const categoryLastIndex = new Map<string, number>()
        for (let i = existingItems.length - 1; i >= 0; i--) {
          const category = existingItems[i].categoryKey
          if (!categoryLastIndex.has(category)) {
            categoryLastIndex.set(category, i)
          }
        }

        // Build reordered list: insert new items after their category's last item
        const reordered: ShoppingItem[] = []
        const insertedCategories = new Set<string>()

        for (let i = 0; i < existingItems.length; i++) {
          reordered.push(existingItems[i])

          // Check if this is the last item of its category
          const category = existingItems[i].categoryKey
          const lastIndex = categoryLastIndex.get(category)!
          if (i === lastIndex && newItemsByCategory.has(category)) {
            // Insert new items from this category
            reordered.push(...newItemsByCategory.get(category)!)
            insertedCategories.add(category)
          }
        }

        // Add any remaining new items (categories not in existing list)
        for (const [category, items] of newItemsByCategory.entries()) {
          if (!insertedCategories.has(category)) {
            reordered.push(...items)
          }
        }

        updatedItems.splice(0, updatedItems.length, ...reordered)
      }

      const addedCount = updatedItems.length - existingCount
      const mergedCount = Math.max(0, existingCount - (updatedItems.length - result.items.length))

      // Merge already_have arrays (preserve items from previous recipes)
      const mergedAlreadyHave = mergeShoppingItems(
        currentList.already_have || [],
        result.alreadyHave,
        {
          preserveUserOverrides: true,
          preserveCustomOrder: false, // already_have doesn't need custom order
          userCategoryOverrides: categoryOverrides,
        }
      )

      // Merge excluded arrays (preserve items from previous recipes)
      const mergedExcluded = mergeShoppingItems(
        currentList.excluded || [],
        result.excluded,
        {
          preserveUserOverrides: true,
          preserveCustomOrder: false, // excluded doesn't need custom order
          userCategoryOverrides: categoryOverrides,
        }
      )

      const mergedSourceRecipes = [...new Set([...currentList.source_recipes, ...recipeIds])]

      const shoppingListData: Partial<ShoppingList> = {
        items: updatedItems,
        already_have: mergedAlreadyHave,
        excluded: mergedExcluded,
        source_recipes: mergedSourceRecipes,
        scale,
        total_servings: (currentList.total_servings || 0) + result.totalServings,
        custom_order: currentList.custom_order,
      }

      if (isGuest) {
        setGuestList(queryClient, shoppingListData)
      } else {
        const supabase = getSupabase()
        const saveData = { ...shoppingListData, user_id: user!.id, generated_at: new Date().toISOString() }
        let saveError
        if (listExists) {
          // Row exists, use update (RLS will filter by user_id, but PostgREST requires a WHERE clause)
          const { error } = await supabase
            .from("shopping_list")
            // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
            .update(saveData)
            .eq("user_id", user!.id)
          saveError = error
        } else {
          // Row doesn't exist, use insert
          const { error } = await supabase
            .from("shopping_list")
            // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
            .insert(saveData)
          saveError = error
        }
        if (saveError) throw saveError
      }

      return { added: addedCount, merged: mergedCount, shoppingList: shoppingListData as ShoppingList }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}
