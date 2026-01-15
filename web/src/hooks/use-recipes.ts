"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { Recipe, RecipeInsert, RecipeUpdate } from "@/types/database"

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
  return useQuery({
    queryKey: [...RECIPES_KEY, options],
    queryFn: async () => {
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
  })
}

/**
 * Hook to fetch a single recipe by ID
 */
export function useRecipe(id: string | null) {
  return useQuery({
    queryKey: [...RECIPES_KEY, id],
    queryFn: async () => {
      if (!id) return null

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
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

  return useMutation({
    mutationFn: async (recipe: RecipeInsert) => {
      const supabase = getSupabase()
      // Generate ID from name if not provided
      const id = recipe.id || recipe.name.toLowerCase().replace(/\s+/g, "-")

      const { data, error } = await supabase
        .from("recipes")
        .insert({ ...recipe, id })
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to update an existing recipe
 */
export function useUpdateRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: RecipeUpdate
    }) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .update(updates)
        .eq("id", id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
      queryClient.setQueryData([...RECIPES_KEY, data.id], data)
    },
  })
}

/**
 * Hook to delete a recipe
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabase()
      const { error } = await supabase.from("recipes").delete().eq("id", id)

      if (error) throw error
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to toggle favorite status
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .update({ favorite: !favorite })
        .eq("id", id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
      queryClient.setQueryData([...RECIPES_KEY, data.id], data)
    },
  })
}

/**
 * Hook to fetch all categories
 */
export function useCategories() {
  return useQuery({
    queryKey: ["user_config", "categories"],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("categories")
        .eq("id", 1)
        .single()

      if (error) {
        // Return defaults if config doesn't exist yet
        console.warn("Config not found, using defaults:", error.message)
        return ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"]
      }
      return (data?.categories as string[]) || ["chicken", "turkey", "steak"]
    },
  })
}
