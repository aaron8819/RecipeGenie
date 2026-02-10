"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Recipe, RecipeInsert, RecipeUpdate } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { useUpdateUserConfig } from "@/hooks/use-planner"
import { getSupabase } from "@/lib/supabase/client"

const RECIPES_KEY = ["recipes"]

function buildRecipesKey(options?: {
  category?: string | null
  search?: string | null
  favoritesOnly?: boolean
  tags?: string[]
  select?: string
  limit?: number
}) {
  const normalizedTags = options?.tags ? [...options.tags].sort() : []
  return [
    ...RECIPES_KEY,
    {
      category: options?.category ?? null,
      search: options?.search ?? null,
      favoritesOnly: options?.favoritesOnly ?? false,
      tags: normalizedTags,
      select: options?.select ?? "*",
      limit: options?.limit ?? null,
    },
  ]
}

export function normalizeRecipeUpdates(updates: RecipeUpdate): RecipeUpdate {
  return {
    ...updates,
    ...(updates.tags !== undefined ? { tags: updates.tags ?? [] } : {}),
  }
}

/**
 * Helper to safely update recipe queries that may be arrays or single recipes
 */
function updateRecipeQuery(
  old: Recipe[] | Recipe | null | undefined,
  updater: (recipe: Recipe) => Recipe
): Recipe[] | Recipe | null | undefined {
  if (Array.isArray(old)) {
    return old.map(updater)
  }
  if (old && typeof old === 'object' && 'id' in old) {
    return updater(old as Recipe)
  }
  return old
}

/**
 * Hook to fetch all recipes with optional filtering
 */
export function useRecipes(options?: {
  category?: string | null
  search?: string | null
  favoritesOnly?: boolean
  tags?: string[]
  select?: string
  limit?: number
}) {
  return useQuery({
    queryKey: buildRecipesKey(options),
    queryFn: async () => {
      const supabase = getSupabase()
      let query = supabase
        .from("recipes")
        .select(options?.select || "*")
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

      if (options?.limit !== undefined) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query
      if (error) throw error
      
      // Filter by tags client-side for OR logic (recipes with ANY of the selected tags)
      // Supabase contains() uses AND logic, so we filter for OR manually
      let filteredData = (data as Recipe[]) || []
      if (options?.tags && options.tags.length > 0) {
        filteredData = filteredData.filter((recipe) => {
          if (!recipe.tags || recipe.tags.length === 0) return false
          // Check if recipe has at least one of the selected tags
          return options.tags!.some((tag) => recipe.tags!.includes(tag))
        })
      }
      
      return filteredData
    },
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
  })
}

/**
 * Hook to fetch a single recipe by ID
 */
export function useRecipe(id: string | null) {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: [...RECIPES_KEY, id],
    queryFn: async () => {
      if (!id || !user) return null

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("id", id)
        .eq("user_id", user!.id)
        .single()

      if (error) throw error
      return data as Recipe
    },
    enabled: !!id && !!user,
  })
}

/**
 * Hook to create a new recipe
 * Implements optimistic updates for instant UI feedback
 */
export function useCreateRecipe() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipe: RecipeInsert) => {
      const id = recipe.id || recipe.name.toLowerCase().replace(/\s+/g, "-")
      const now = new Date().toISOString()

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        .insert({ ...recipe, id, user_id: user!.id })
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    // Optimistic update
    onMutate: async (recipe) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: RECIPES_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: RECIPES_KEY })

      // Create optimistic recipe
      const id = recipe.id || recipe.name.toLowerCase().replace(/\s+/g, "-")
      const now = new Date().toISOString()
      const optimisticRecipe: Recipe = {
        id,
        user_id: user?.id || "",
        name: recipe.name,
        category: recipe.category,
        servings: recipe.servings ?? 4,
        favorite: recipe.favorite ?? false,
        tags: recipe.tags ?? [],
        ingredients: recipe.ingredients ?? [],
        instructions: recipe.instructions ?? [],
        image_url: recipe.image_url ?? null,
        created_at: now,
        updated_at: now,
      }

      // Optimistically add to all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => {
          if (Array.isArray(old)) {
            return [...old, optimisticRecipe].sort((a, b) => {
              const nameA = a.name || ""
              const nameB = b.name || ""
              return nameA.localeCompare(nameB)
            })
          }
          // For single recipe queries, don't modify them
          return old
        }
      )

      return { previousQueries }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (newRecipe) => {
      // Update with server response (replace optimistic with real data)
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => {
          if (Array.isArray(old)) {
            // Replace optimistic recipe with server response
            const filtered = old.filter((r) => r.id !== newRecipe.id)
            return [...filtered, newRecipe].sort((a, b) => {
              const nameA = a.name || ""
              const nameB = b.name || ""
              return nameA.localeCompare(nameB)
            })
          }
          // For single recipe queries, update if it matches
          if (old && typeof old === 'object' && 'id' in old && (old as Recipe).id === newRecipe.id) {
            return newRecipe
          }
          return old
        }
      )
      // Invalidate tags queries to refresh tag lists
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to update an existing recipe
 * Implements optimistic updates for instant UI feedback
 */
export function useUpdateRecipe() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: RecipeUpdate }) => {
      const normalizedUpdates = normalizeRecipeUpdates(updates)

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update(normalizedUpdates)
        .eq("id", id)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    // Optimistic update
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: RECIPES_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: RECIPES_KEY })

      const normalizedUpdates = normalizeRecipeUpdates(updates)

      // Optimistically update all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === id 
            ? { ...r, ...normalizedUpdates, updated_at: new Date().toISOString() }
            : r
        )
      )

      return { previousQueries }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (updated) => {
      // Update with server response
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === updated.id ? updated : r
        )
      )
      // Invalidate tags queries to refresh tag lists
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to delete a recipe
 * Implements optimistic updates for instant UI feedback
 */
export function useDeleteRecipe() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = getSupabase()
      const { error } = await supabase.from("recipes").delete().eq("id", id).eq("user_id", user!.id)
      if (error) throw error
      return id
    },
    // Optimistic update
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: RECIPES_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: RECIPES_KEY })

      // Optimistically remove from all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => {
          if (Array.isArray(old)) {
            return old.filter((r) => r.id !== id)
          }
          // For single recipe queries, if it matches the ID, return null
          if (old && typeof old === 'object' && 'id' in old && (old as Recipe).id === id) {
            return null
          }
          return old
        }
      )

      return { previousQueries }
    },
    onError: (err, id, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (deletedId) => {
      // Invalidate tags queries to refresh tag lists
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to toggle favorite status
 * Implements optimistic updates for instant UI feedback
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ favorite: !favorite })
        .eq("id", id)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (error) throw error
      return data as Recipe
    },
    // Optimistic update
    onMutate: async ({ id, favorite }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: RECIPES_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: RECIPES_KEY })

      // Optimistically update all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === id ? { ...r, favorite: !favorite } : r
        )
      )

      return { previousQueries }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (updated) => {
      // Update with server response
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: RECIPES_KEY },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === updated.id ? updated : r
        )
      )
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

// Preferred display order for recipe categories (fallback for default categories)
const DEFAULT_CATEGORY_ORDER = ["chicken", "beef", "lamb", "turkey", "vegetarian"]

function sortDefaultCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const indexA = DEFAULT_CATEGORY_ORDER.indexOf(a)
    const indexB = DEFAULT_CATEGORY_ORDER.indexOf(b)
    if (indexA === -1 && indexB === -1) return a.localeCompare(b)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })
}

/**
 * Hook to fetch all categories
 * Returns categories in the order they are stored (user's custom order)
 */
export function useCategories() {
  return useQuery({
    queryKey: ["user_config", "categories"],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("categories")
        .single()

      if (error) {
        console.warn("Config not found, using defaults:", error.message)
        return sortDefaultCategories(["chicken", "beef", "lamb", "turkey", "vegetarian"])
      }
      
      const typedData = data as { categories?: string[] } | null
      const userCategories = typedData?.categories || []
      // Return categories in the order they are stored (user's custom order)
      // If empty, return defaults in sorted order
      return userCategories.length > 0 ? userCategories : sortDefaultCategories(["chicken", "beef", "lamb", "turkey", "vegetarian"])
    },
    staleTime: Infinity,
  })
}

/**
 * Hook to fetch all unique tags from all recipes with counts
 */
export function useAllTags() {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: ["recipes", "all-tags"],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("tags")
        .eq("user_id", user!.id)

      if (error) throw error

      const allTags = new Set<string>()
      ;(data || []).forEach((recipe: { tags: string[] | null }) => {
        if (recipe.tags && Array.isArray(recipe.tags)) {
          recipe.tags.forEach((tag) => allTags.add(tag))
        }
      })

      return Array.from(allTags).sort()
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Hook to fetch tags with usage counts
 */
export function useTagsWithCounts() {
  const { user } = useAuthContext()
  const { data: recipes } = useRecipes()

  return useQuery({
    queryKey: ["recipes", "tags-with-counts", recipes?.length],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("tags")
        .eq("user_id", user!.id)

      if (error) throw error

      const tagCounts = new Map<string, number>()
      ;(data || []).forEach((recipe: { tags: string[] | null }) => {
        if (recipe.tags && Array.isArray(recipe.tags)) {
          recipe.tags.forEach((tag) => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
          })
        }
      })

      return Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

/**
 * Hook to check if a category has recipes assigned to it
 */
export function useCategoryHasRecipes(categoryName: string | null) {
  const { data: recipes } = useRecipes({ category: categoryName || undefined })
  return (recipes?.length || 0) > 0
}

/**
 * Hook to update recipe categories
 */
export function useUpdateCategories() {
  const queryClient = useQueryClient()
  const updateConfig = useUpdateUserConfig()

  return useMutation({
    mutationFn: async (categories: string[]) => {
      // Validate: no empty or duplicate categories
      const trimmed = categories.map((c) => c.trim()).filter((c) => c.length > 0)
      const unique = Array.from(new Set(trimmed.map((c) => c.toLowerCase())))
      if (trimmed.length !== unique.length) {
        throw new Error("Duplicate category names are not allowed")
      }

      // Use the updateConfig mutation
      await updateConfig.mutateAsync({ categories: trimmed })
      return trimmed
    },
    onSuccess: () => {
      // Invalidate categories query
      queryClient.invalidateQueries({ queryKey: ["user_config", "categories"] })
      // Also invalidate config query
      queryClient.invalidateQueries({ queryKey: ["user_config"] })
    },
  })
}

/**
 * Hook to bulk update recipe categories (for reassignment)
 */
export function useBulkUpdateRecipeCategories() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({
      oldCategory,
      newCategory,
    }: {
      oldCategory: string
      newCategory: string
    }) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ category: newCategory })
        .eq("user_id", user!.id)
        .eq("category", oldCategory)
        .select("id")

      if (error) throw error
      return data?.length || 0
    },
    onSuccess: () => {
      // Invalidate all recipe queries
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to rename a tag across all recipes
 */
export function useRenameTag() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ oldTag, newTag }: { oldTag: string; newTag: string }) => {
      const supabase = getSupabase()
      // Fetch all recipes with the old tag
      const { data: recipes, error: fetchError } = await supabase
        .from("recipes")
        .select("id, tags")
        .eq("user_id", user!.id)
        .contains("tags", [oldTag])

      if (fetchError) throw fetchError

      if (!recipes || recipes.length === 0) return 0

      // Update each recipe's tags array
      const updates = recipes.map((recipe) => {
        const typedRecipe = recipe as { tags?: string[]; id: string }
        const newTags = (typedRecipe.tags || []).map((t: string) => (t === oldTag ? newTag : t))
        return supabase
          .from("recipes")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ tags: newTags })
          .eq("id", typedRecipe.id)
          .eq("user_id", user!.id)
      })

      const results = await Promise.all(updates)
      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} recipes`)
      }

      return recipes.length
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
  })
}

/**
 * Hook to merge multiple tags into one
 */
export function useMergeTags() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ sourceTags, targetTag }: { sourceTags: string[]; targetTag: string }) => {
      const supabase = getSupabase()
      // Fetch all recipes for this user
      const { data: allRecipes, error: fetchError } = await supabase
        .from("recipes")
        .select("id, tags")
        .eq("user_id", user!.id)

      if (fetchError) throw fetchError

      // Filter recipes that have any of the source tags
      const recipes = (allRecipes || []).filter((recipe) => {
        const typedRecipe = recipe as { tags?: string[] }
        const tags = typedRecipe.tags || []
        return sourceTags.some((tag) => tags.includes(tag))
      })

      if (fetchError) throw fetchError

      if (!recipes || recipes.length === 0) return 0

      // Update each recipe's tags array
      const updates = recipes.map((recipe) => {
        const typedRecipe = recipe as { tags?: string[]; id: string }
        const currentTags = typedRecipe.tags || []
        // Remove source tags and add target tag if not already present
        const newTags = currentTags
          .filter((t: string) => !sourceTags.includes(t))
          .concat(currentTags.includes(targetTag) ? [] : [targetTag])
        return supabase
          .from("recipes")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ tags: newTags })
          .eq("id", typedRecipe.id)
          .eq("user_id", user!.id)
      })

      const results = await Promise.all(updates)
      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} recipes`)
      }

      return recipes.length
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
  })
}

/**
 * Hook to delete a tag from all recipes
 */
export function useDeleteTag() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (tag: string) => {
      const supabase = getSupabase()
      // Fetch all recipes with the tag
      const { data: recipes, error: fetchError } = await supabase
        .from("recipes")
        .select("id, tags")
        .eq("user_id", user!.id)
        .contains("tags", [tag])

      if (fetchError) throw fetchError

      if (!recipes || recipes.length === 0) return 0

      // Update each recipe's tags array
      const updates = recipes.map((recipe) => {
        const typedRecipe = recipe as { tags?: string[]; id: string }
        const newTags = (typedRecipe.tags || []).filter((t: string) => t !== tag)
        return supabase
          .from("recipes")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ tags: newTags })
          .eq("id", typedRecipe.id)
          .eq("user_id", user!.id)
      })

      const results = await Promise.all(updates)
      const errors = results.filter((r) => r.error)
      if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} recipes`)
      }

      return recipes.length
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
      queryClient.invalidateQueries({ queryKey: ["recipes", "all-tags"] })
      queryClient.invalidateQueries({ queryKey: ["recipes", "tags-with-counts"] })
    },
  })
}
