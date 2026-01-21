"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { ShoppingList, ShoppingItem, Recipe, PantryItem, UserConfig } from "@/types/database"
import { generateShoppingList, ensureCategoryInfo } from "@/lib/shopping-list"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultShoppingList, getDefaultConfig } from "@/lib/guest-storage"

const SHOPPING_KEY = ["shopping_list"]
const PANTRY_KEY = ["pantry"]
const CONFIG_KEY = ["user_config"]

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Guest mode cache helper
function getGuestList(queryClient: ReturnType<typeof useQueryClient>): ShoppingList {
  return queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY, true]) || getDefaultShoppingList() as ShoppingList
}

function setGuestList(queryClient: ReturnType<typeof useQueryClient>, list: Partial<ShoppingList>) {
  const current = getGuestList(queryClient)
  queryClient.setQueryData([...SHOPPING_KEY, true], { ...current, ...list, generated_at: new Date().toISOString() })
}

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
      return data as ShoppingList || getDefaultShoppingList() as ShoppingList
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

      const result = generateShoppingList(
        recipes as Recipe[],
        pantryItems as PantryItem[],
        (config?.excluded_keywords as string[]) || [],
        scale
      )

      const shoppingListData = {
        user_id: user?.id,
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
          .update(shoppingListData)
          .eq("user_id", user?.id)
        saveError = error
      } else {
        // Row doesn't exist, use insert
        const { error } = await supabase
          .from("shopping_list")
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
        .eq("user_id", user?.id)
        .maybeSingle()

      if (existingList) {
        // Update existing list
        const { error } = await supabase
          .from("shopping_list")
          .update({ ...shoppingList, generated_at: new Date().toISOString() })
          .eq("user_id", user?.id)
        if (error) throw error
      } else {
        // Insert new list
        const { error } = await supabase
          .from("shopping_list")
          .insert({ ...shoppingList, user_id: user?.id, generated_at: new Date().toISOString() })
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
        : (await getSupabase().from("user_config").select("category_overrides").single()).data?.category_overrides as Record<string, string> || {}

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

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      if (currentItems.some((i) => i.item.toLowerCase() === itemName.toLowerCase())) {
        throw new Error("Item already in shopping list")
      }

      let updatedItems = [...currentItems, newItem]
      if (!currentList?.custom_order) {
        updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({ items: updatedItems })
        .eq("user_id", user?.id)

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
        : (await getSupabase().from("user_config").select("category_overrides").single()).data?.category_overrides as Record<string, string> || {}

      const optimisticItem = ensureCategoryInfo(
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

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: ((currentList?.items as ShoppingItem[]) || []).filter(
            (i) => i.item.toLowerCase() !== itemName.toLowerCase()
          ),
        })
        .eq("user_id", user?.id)

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
 * Hook to remove all items associated with a specific recipe
 */
export function useRemoveRecipeItems() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeName: string) => {
      const filterItems = (items: ShoppingItem[]) =>
        items
          .map((item) => {
            if (!item.sources) return item
            const newSources = item.sources.filter((s) => s.recipeName !== recipeName)
            return newSources.length === 0 ? null : { ...item, sources: newSources }
          })
          .filter((item): item is ShoppingItem => item !== null)

      if (isGuest) {
        const current = getGuestList(queryClient)
        const filteredActiveItems = filterItems(current.items)
        const filteredAlreadyHave = filterItems(current.already_have)
        
        // Check if any items (checked or unchecked) still reference this recipe
        const allItems = [...filteredActiveItems, ...filteredAlreadyHave]
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
          source_recipes: updatedSourceRecipes,
        })
        return { recipeName, removedCount: 0 }
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, source_recipes")
        .single()

      if (fetchError) throw fetchError

      const filteredActiveItems = filterItems((currentList?.items as ShoppingItem[]) || [])
      const filteredAlreadyHave = filterItems((currentList?.already_have as ShoppingItem[]) || [])
      
      // Check if any items (checked or unchecked) still reference this recipe
      const allItems = [...filteredActiveItems, ...filteredAlreadyHave]
      const hasRecipeItems = allItems.some((item) => 
        item.sources?.some((s) => s.recipeName === recipeName)
      )
      
      // Remove recipe ID from source_recipes if no items remain
      let updatedSourceRecipes = (currentList?.source_recipes as string[]) || []
      if (!hasRecipeItems) {
        // Find recipe ID from recipe name
        const { data: recipe } = await supabase
          .from("recipes")
          .select("id, name")
          .eq("user_id", user?.id)
          .eq("name", recipeName)
          .maybeSingle()
        
        if (recipe) {
          updatedSourceRecipes = updatedSourceRecipes.filter((id) => id !== recipe.id)
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: filteredActiveItems,
          already_have: filteredAlreadyHave,
          source_recipes: updatedSourceRecipes,
        })
        .eq("user_id", user?.id)

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
        excludedKeywords = (configRes.data?.excluded_keywords as string[]) || []
        currentList = listRes.data as ShoppingList || getDefaultShoppingList() as ShoppingList
        listExists = !!listRes.data
      }

      const result = generateShoppingList(recipes, pantryItems, excludedKeywords, scale)

      // Merge items
      const currentItemMap = new Map(currentList.items.map((item) => [item.item.toLowerCase(), item]))
      let addedCount = 0
      let mergedCount = 0

      for (const newItem of result.items) {
        const key = newItem.item.toLowerCase()
        const existingItem = currentItemMap.get(key)

        if (existingItem) {
          const existingSources = existingItem.sources || []
          const newSources = newItem.sources || []
          const sourceSet = new Set(existingSources.map((s) => s.recipeName))
          const combinedSources = [...existingSources]
          for (const source of newSources) {
            if (!sourceSet.has(source.recipeName)) {
              combinedSources.push(source)
            }
          }

          const mergeResult = mergeAmounts(existingItem.amount, existingItem.unit, newItem.amount, newItem.unit)
          if (mergeResult) {
            currentItemMap.set(key, {
              ...existingItem,
              amount: roundForDisplay(mergeResult.amount),
              unit: mergeResult.unit,
              sources: combinedSources,
              additionalAmounts: undefined,
            })
          } else {
            currentItemMap.set(key, {
              ...existingItem,
              sources: combinedSources,
              additionalAmounts: [...(existingItem.additionalAmounts || []), { amount: newItem.amount || 0, unit: newItem.unit }],
            })
          }
          mergedCount++
        } else {
          currentItemMap.set(key, newItem)
          addedCount++
        }
      }

      let updatedItems = Array.from(currentItemMap.values())
      // Ensure no duplicates by item name after merge (case-insensitive)
      const seenItems = new Set<string>()
      updatedItems = updatedItems.filter(item => {
        const normalizedItemName = item.item.toLowerCase()
        if (seenItems.has(normalizedItemName)) {
          return false
        }
        seenItems.add(normalizedItemName)
        return true
      })
      if (!currentList.custom_order) {
        updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
      }

      const mergedSourceRecipes = [...new Set([...currentList.source_recipes, ...recipeIds])]

      const shoppingListData: Partial<ShoppingList> = {
        items: updatedItems,
        already_have: result.alreadyHave,
        excluded: result.excluded,
        source_recipes: mergedSourceRecipes,
        scale,
        total_servings: (currentList.total_servings || 0) + result.totalServings,
        custom_order: currentList.custom_order,
      }

      if (isGuest) {
        setGuestList(queryClient, shoppingListData)
      } else {
        const supabase = getSupabase()
        const saveData = { ...shoppingListData, user_id: user?.id, generated_at: new Date().toISOString() }
        let saveError
        if (listExists) {
          // Row exists, use update (RLS will filter by user_id, but PostgREST requires a WHERE clause)
          const { error } = await supabase
            .from("shopping_list")
            .update(saveData)
            .eq("user_id", user?.id)
          saveError = error
        } else {
          // Row doesn't exist, use insert
          const { error } = await supabase
            .from("shopping_list")
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

/**
 * Hook to check off a shopping item
 */
/**
 * Hook to check off an item (move from items to already_have)
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
        const updatedItems = current.items.filter((i) => i.item.toLowerCase() !== normalizedItem)
        const updatedAlreadyHave = current.already_have.some((i) => i.item.toLowerCase() === normalizedItem)
          ? current.already_have
          : [...current.already_have, item]
        
        // Auto-clear source_recipes when all items are checked
        let updatedSourceRecipes = current.source_recipes || []
        if (updatedItems.length === 0 && updatedAlreadyHave.length > 0) {
          updatedSourceRecipes = []
        }
        
        setGuestList(queryClient, {
          items: updatedItems,
          already_have: updatedAlreadyHave,
          source_recipes: updatedSourceRecipes,
        })
        return item
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, source_recipes")
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []
      const updatedItems = currentItems.filter((i) => i.item.toLowerCase() !== normalizedItem)
      const updatedAlreadyHave = alreadyHave.some((i) => i.item.toLowerCase() === normalizedItem) ? alreadyHave : [...alreadyHave, item]

      // Auto-clear source_recipes when all items are checked
      let updatedSourceRecipes = currentList?.source_recipes || []
      if (updatedItems.length === 0 && updatedAlreadyHave.length > 0) {
        updatedSourceRecipes = []
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          already_have: updatedAlreadyHave,
          source_recipes: updatedSourceRecipes,
        })
        .eq("user_id", user?.id)

      if (saveError) throw saveError
      return item
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
          const alreadyHave = old.already_have || []
          const updatedItems = currentItems.filter((i) => i.item.toLowerCase() !== normalizedItem)
          const updatedAlreadyHave = alreadyHave.some((i) => i.item.toLowerCase() === normalizedItem)
            ? alreadyHave
            : [...alreadyHave, item]
          
          // Auto-clear source_recipes when all items are checked
          let updatedSourceRecipes = old.source_recipes || []
          if (updatedItems.length === 0 && updatedAlreadyHave.length > 0) {
            updatedSourceRecipes = []
          }
          
          return {
            ...old,
            items: updatedItems,
            already_have: updatedAlreadyHave,
            source_recipes: updatedSourceRecipes,
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
        .update({ ...emptyList, generated_at: new Date().toISOString() })
        .eq("user_id", user?.id)

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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()

      if (isGuest) {
        const current = getGuestList(queryClient)
        
        // Find all items with the same name in already_have and merge them
        const itemsToMerge = current.already_have.filter((i) => i.item.toLowerCase() === normalizedItem)
        if (itemsToMerge.length === 0) return item
        
        // Merge all items with the same name
        let mergedItem = itemsToMerge[0]
        for (let i = 1; i < itemsToMerge.length; i++) {
          const nextItem = itemsToMerge[i]
          
          // Merge sources
          const existingSources = mergedItem.sources || []
          const newSources = nextItem.sources || []
          const sourceSet = new Set(existingSources.map((s) => s.recipeName))
          const combinedSources = [...existingSources]
          for (const source of newSources) {
            if (!sourceSet.has(source.recipeName)) {
              combinedSources.push(source)
            }
          }
          
          // Merge amounts
          const mergeResult = mergeAmounts(mergedItem.amount, mergedItem.unit, nextItem.amount, nextItem.unit)
          if (mergeResult) {
            mergedItem = {
              ...mergedItem,
              amount: roundForDisplay(mergeResult.amount),
              unit: mergeResult.unit,
              sources: combinedSources,
            }
          } else {
            // Units incompatible, keep existing but combine sources
            mergedItem = {
              ...mergedItem,
              sources: combinedSources,
            }
          }
        }
        
        let updatedItems = current.items
        if (!current.items.some((i) => i.item.toLowerCase() === normalizedItem)) {
          updatedItems = [...current.items, mergedItem]
          if (!current.custom_order) {
            updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
          }
        }
        
        setGuestList(queryClient, {
          items: updatedItems,
          already_have: current.already_have.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        return mergedItem
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, custom_order")
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []

      // Find all items with the same name in already_have and merge them
      const itemsToMerge = alreadyHave.filter((i) => i.item.toLowerCase() === normalizedItem)
      if (itemsToMerge.length === 0) return item
      
      // Merge all items with the same name
      let mergedItem = itemsToMerge[0]
      for (let i = 1; i < itemsToMerge.length; i++) {
        const nextItem = itemsToMerge[i]
        
        // Merge sources
        const existingSources = mergedItem.sources || []
        const newSources = nextItem.sources || []
        const sourceSet = new Set(existingSources.map((s) => s.recipeName))
        const combinedSources = [...existingSources]
        for (const source of newSources) {
          if (!sourceSet.has(source.recipeName)) {
            combinedSources.push(source)
          }
        }
        
        // Merge amounts
        const mergeResult = mergeAmounts(mergedItem.amount, mergedItem.unit, nextItem.amount, nextItem.unit)
        if (mergeResult) {
          mergedItem = {
            ...mergedItem,
            amount: roundForDisplay(mergeResult.amount),
            unit: mergeResult.unit,
            sources: combinedSources,
          }
        } else {
          // Units incompatible, keep existing but combine sources
          mergedItem = {
            ...mergedItem,
            sources: combinedSources,
          }
        }
      }

      let updatedItems = currentItems
      if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
        updatedItems = [...currentItems, mergedItem]
        if (!currentList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          already_have: alreadyHave.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        .eq("user_id", user?.id)

      if (saveError) throw saveError
      return mergedItem
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (item: ShoppingItem) => {
      const normalizedItem = item.item.toLowerCase().trim()

      if (isGuest) {
        const current = getGuestList(queryClient)
        let updatedItems = current.items
        if (!current.items.some((i) => i.item.toLowerCase() === normalizedItem)) {
          updatedItems = [...current.items, item]
          if (!current.custom_order) {
            updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
          }
        }
        setGuestList(queryClient, {
          items: updatedItems,
          excluded: current.excluded.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        return item
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, excluded, custom_order")
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const excluded = (currentList?.excluded as ShoppingItem[]) || []

      let updatedItems = currentItems
      if (!currentItems.some((i) => i.item.toLowerCase() === normalizedItem)) {
        updatedItems = [...currentItems, item]
        if (!currentList?.custom_order) {
          updatedItems.sort((a, b) => a.categoryOrder - b.categoryOrder || a.item.localeCompare(b.item))
        }
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: updatedItems,
          excluded: excluded.filter((i) => i.item.toLowerCase() !== normalizedItem),
        })
        .eq("user_id", user?.id)

      if (saveError) throw saveError
      return item
    },
    onSuccess: () => {
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
        .update({ items: newItems, custom_order: true })
        .eq("user_id", user?.id)

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
      const { data: config, error: fetchError } = await supabase
        .from("user_config")
        .select("category_overrides")
        .eq("user_id", user?.id)
        .maybeSingle()

      if (fetchError) throw fetchError

      const updatedOverrides = {
        ...((config?.category_overrides as Record<string, string>) || {}),
        [normalizedItem]: categoryKey,
      }

      if (config) {
        // Update existing config
        const { error: saveError } = await supabase
          .from("user_config")
          .update({ category_overrides: updatedOverrides })
          .eq("user_id", user?.id)
        if (saveError) throw saveError
      } else {
        // Insert new config (shouldn't happen normally, but handle it)
        const { error: saveError } = await supabase
          .from("user_config")
          .insert({
            user_id: user?.id,
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
        .update({ items: updatedItems, custom_order: true })
        .eq("user_id", user?.id)

      if (saveError) throw saveError
      return updatedItems
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SHOPPING_KEY })
    },
  })
}

/**
 * Hook to fetch user config for shopping settings
 */
export function useShoppingConfig() {
  const { isGuest } = useAuthContext()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: [...CONFIG_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) {
        return getDefaultConfig() as UserConfig
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("*")
        .maybeSingle()

      if (error) throw error
      return data as UserConfig | null
    },
  })
}

/**
 * Hook to update user config for shopping settings
 */
export function useUpdateShoppingConfig() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (updates: Partial<UserConfig>) => {
      if (isGuest) {
        // Guest mode doesn't persist config changes
        return updates
      }

      const supabase = getSupabase()

      // Check if config exists
      const { data: existingConfig } = await supabase
        .from("user_config")
        .select("user_id")
        .eq("user_id", user?.id)
        .maybeSingle()

      if (existingConfig) {
        const { error } = await supabase
          .from("user_config")
          .update(updates)
          .eq("user_id", user?.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("user_config")
          .insert({
            user_id: user?.id,
            ...updates,
          })
        if (error) throw error
      }

      return updates
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY })
    },
  })
}

/**
 * Hook to check off multiple items at once (move from items to already_have)
 * Used for "Check All" in a category
 */
export function useBulkCheckOff() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (itemsToCheck: ShoppingItem[]) => {
      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      if (isGuest) {
        const current = getGuestList(queryClient)
        // Remove items from items array
        const remainingItems = current.items.filter(i => !itemNames.has(i.item.toLowerCase().trim()))
        // Add items to already_have (avoid duplicates)
        const existingAlreadyHave = new Set(current.already_have.map(i => i.item.toLowerCase().trim()))
        const newAlreadyHave = [
          ...current.already_have,
          ...itemsToCheck.filter(i => !existingAlreadyHave.has(i.item.toLowerCase().trim()))
        ]
        
        // Auto-clear source_recipes when all items are checked
        let updatedSourceRecipes = current.source_recipes || []
        if (remainingItems.length === 0 && newAlreadyHave.length > 0) {
          updatedSourceRecipes = []
        }
        
        setGuestList(queryClient, {
          items: remainingItems,
          already_have: newAlreadyHave,
          source_recipes: updatedSourceRecipes,
        })
        return { count: itemsToCheck.length }
      }

      const supabase = getSupabase()
      const { data: currentList, error: fetchError } = await supabase
        .from("shopping_list")
        .select("items, already_have, source_recipes")
        .single()

      if (fetchError) throw fetchError

      const currentItems = (currentList?.items as ShoppingItem[]) || []
      const alreadyHave = (currentList?.already_have as ShoppingItem[]) || []

      // Remove items from items array
      const remainingItems = currentItems.filter(i => !itemNames.has(i.item.toLowerCase().trim()))

      // Add items to already_have (avoid duplicates)
      const existingAlreadyHave = new Set(alreadyHave.map(i => i.item.toLowerCase().trim()))
      const newAlreadyHave = [
        ...alreadyHave,
        ...itemsToCheck.filter(i => !existingAlreadyHave.has(i.item.toLowerCase().trim()))
      ]

      // Auto-clear source_recipes when all items are checked
      let updatedSourceRecipes = (currentList?.source_recipes as string[]) || []
      if (remainingItems.length === 0 && newAlreadyHave.length > 0) {
        updatedSourceRecipes = []
      }

      const { error: saveError } = await supabase
        .from("shopping_list")
        .update({
          items: remainingItems,
          already_have: newAlreadyHave,
          source_recipes: updatedSourceRecipes,
        })
        .eq("user_id", user?.id)

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
          const alreadyHave = old.already_have || []

          const remainingItems = currentItems.filter(i => !itemNames.has(i.item.toLowerCase().trim()))
          const existingAlreadyHave = new Set(alreadyHave.map(i => i.item.toLowerCase().trim()))
          const newAlreadyHave = [
            ...alreadyHave,
            ...itemsToCheck.filter(i => !existingAlreadyHave.has(i.item.toLowerCase().trim()))
          ]

          // Auto-clear source_recipes when all items are checked
          let updatedSourceRecipes = old.source_recipes || []
          if (remainingItems.length === 0 && newAlreadyHave.length > 0) {
            updatedSourceRecipes = []
          }

          return {
            ...old,
            items: remainingItems,
            already_have: newAlreadyHave,
            source_recipes: updatedSourceRecipes,
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
