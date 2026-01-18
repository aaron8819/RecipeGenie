"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { Recipe, RecipeInsert, RecipeUpdate } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultConfig } from "@/lib/guest-storage"

const RECIPES_KEY = ["recipes"]

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Hook to fetch all recipes with optional filtering
 */
export function useRecipes(options?: {
  category?: string | null
  search?: string | null
  favoritesOnly?: boolean
}) {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: [...RECIPES_KEY, options, isGuest],
    queryFn: async () => {
      if (isGuest) {
        // Return from cache (initialized by auth context)
        return [] as Recipe[]
      }

      const supabase = getSupabase()
      let query = supabase
        .from("recipes")
        .select("*")
        .order("name", { ascending: true })

      if (options?.category) {
        query = query.eq("category", options.category)
      }

      if (options?.search) {
        query = query.ilike("name", `%${options.search}%`)
      }

      if (options?.favoritesOnly) {
        query = query.eq("favorite", true)
      }

      const { data, error } = await query
      if (error) throw error
      return data as Recipe[]
    },
    initialData: isGuest ? () => {
      let recipes = getDefaultRecipes()
      if (options?.category) {
        recipes = recipes.filter((r) => r.category === options.category)
      }
      if (options?.search) {
        const searchLower = options.search.toLowerCase()
        recipes = recipes.filter((r) => r.name.toLowerCase().includes(searchLower))
      }
      if (options?.favoritesOnly) {
        recipes = recipes.filter((r) => r.favorite)
      }
      return recipes.sort((a, b) => a.name.localeCompare(b.name))
    } : undefined,
    enabled: !isGuest,
  })
}

/**
 * Hook to fetch a single recipe by ID
 */
export function useRecipe(id: string | null) {
  const { isGuest, user } = useAuthContext()

  return useQuery({
    queryKey: [...RECIPES_KEY, id, isGuest],
    queryFn: async () => {
      if (!id) return null

      if (isGuest) {
        const recipes = getDefaultRecipes()
        return recipes.find((r) => r.id === id) || null
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .eq("user_id", user?.id)
        .single()

      if (error) throw error
      return data as Recipe
    },
    enabled: !!id,
  })
}

/**
 * Hook to create a new recipe
 */
export function useCreateRecipe() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipe: RecipeInsert) => {
      const id = recipe.id || recipe.name.toLowerCase().replace(/\s+/g, "-")
      const now = new Date().toISOString()

      if (isGuest) {
        const newRecipe: Recipe = {
          id,
          user_id: "guest",
          name: recipe.name,
          category: recipe.category,
          servings: recipe.servings ?? 4,
          favorite: recipe.favorite ?? false,
          tags: recipe.tags ?? [],
          ingredients: recipe.ingredients ?? [],
          instructions: recipe.instructions ?? [],
          created_at: now,
          updated_at: now,
        }
        return newRecipe
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .insert({ ...recipe, id, user_id: user?.id })
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: (newRecipe) => {
      // Update cache for all recipe queries
      queryClient.setQueriesData<Recipe[]>(
        { queryKey: RECIPES_KEY },
        (old) => old ? [...old, newRecipe].sort((a, b) => a.name.localeCompare(b.name)) : [newRecipe]
      )
    },
  })
}

/**
 * Hook to update an existing recipe
 */
export function useUpdateRecipe() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: RecipeUpdate }) => {
      if (isGuest) {
        // Get from cache and apply updates
        const recipes = queryClient.getQueryData<Recipe[]>([...RECIPES_KEY, null, true]) || []
        const existing = recipes.find((r) => r.id === id)
        if (!existing) throw new Error("Recipe not found")
        return { ...existing, ...updates, updated_at: new Date().toISOString() } as Recipe
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .update(updates)
        .eq("id", id)
        .eq("user_id", user?.id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<Recipe[]>(
        { queryKey: RECIPES_KEY },
        (old) => old?.map((r) => (r.id === updated.id ? updated : r))
      )
    },
  })
}

/**
 * Hook to delete a recipe
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (id: string) => {
      if (isGuest) {
        return id
      }

      const supabase = getSupabase()
      const { error } = await supabase.from("recipes").delete().eq("id", id).eq("user_id", user?.id)
      if (error) throw error
      return id
    },
    onSuccess: (deletedId) => {
      queryClient.setQueriesData<Recipe[]>(
        { queryKey: RECIPES_KEY },
        (old) => old?.filter((r) => r.id !== deletedId)
      )
    },
  })
}

/**
 * Hook to toggle favorite status
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      if (isGuest) {
        const recipes = queryClient.getQueryData<Recipe[]>([...RECIPES_KEY, null, true]) || []
        const existing = recipes.find((r) => r.id === id)
        if (!existing) throw new Error("Recipe not found")
        return { ...existing, favorite: !favorite, updated_at: new Date().toISOString() } as Recipe
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .update({ favorite: !favorite })
        .eq("id", id)
        .eq("user_id", user?.id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<Recipe[]>(
        { queryKey: RECIPES_KEY },
        (old) => old?.map((r) => (r.id === updated.id ? updated : r))
      )
    },
  })
}

// Preferred display order for recipe categories
const CATEGORY_ORDER = ["chicken", "beef", "lamb", "turkey", "vegetarian"]

function sortCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a)
    const indexB = CATEGORY_ORDER.indexOf(b)
    if (indexA === -1 && indexB === -1) return a.localeCompare(b)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })
}

/**
 * Hook to fetch all categories
 */
export function useCategories() {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: ["user_config", "categories", isGuest],
    queryFn: async () => {
      if (isGuest) {
        return sortCategories(getDefaultConfig().categories)
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("categories")
        .single()

      if (error) {
        console.warn("Config not found, using defaults:", error.message)
        return sortCategories(["chicken", "beef", "lamb", "turkey", "vegetarian"])
      }
      return sortCategories((data?.categories as string[]) || ["chicken", "turkey", "beef"])
    },
    staleTime: Infinity,
  })
}
