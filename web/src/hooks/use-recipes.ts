"use client"

import { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Recipe, RecipeInsert, RecipeUpdate } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { useCategories, useUpdateUserConfig } from "@/hooks/shared/user-config"
import { getSupabase } from "@/lib/supabase/client"
import { getActivePrincipalId } from "@/lib/principal-session"
import { runRecipeContributionCommand } from "@/lib/shopping-contribution-client"
import {
  createRecipeUuid,
  mapRecipeRow,
  mapRecipeRows,
  recipeUuidWrite,
  type RecipeRow,
} from "@/lib/recipe-identity"
import {
  configurationKeys,
  principalId,
  recipeKeys,
  shoppingKeys,
} from "@/lib/query-keys"
import {
  normalizeRecipeInstructionGroups,
  normalizeRecipeNotes,
} from "@/lib/recipe-structure"

export { useCategories } from "@/hooks/shared/user-config"

function buildRecipesKey(userId: string, options?: {
  category?: string | null
  search?: string | null
  favoritesOnly?: boolean
  tags?: string[]
  limit?: number
}) {
  const normalizedTags = options?.tags ? [...options.tags].sort() : []
  return recipeKeys.list(userId, {
      category: options?.category ?? null,
      search: options?.search ?? null,
      favoritesOnly: options?.favoritesOnly ?? false,
      tags: normalizedTags,
      limit: options?.limit ?? null,
  })
}

export function normalizeRecipeUpdates(updates: RecipeUpdate): RecipeUpdate {
  return {
    ...updates,
    ...(updates.tags !== undefined ? { tags: updates.tags ?? [] } : {}),
    ...(updates.notes !== undefined ? { notes: normalizeRecipeNotes(updates.notes) } : {}),
    ...(updates.instruction_groups !== undefined
      ? {
          instruction_groups: updates.instruction_groups
            ? normalizeRecipeInstructionGroups(updates.instruction_groups)
            : null,
        }
      : {}),
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

function findRecipeInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  id: string
): Recipe | undefined {
  const queries = queryClient.getQueriesData<Recipe[] | Recipe | null>({
    queryKey: recipeKeys.all(userId),
  })

  for (const [, data] of queries) {
    if (Array.isArray(data)) {
      const match = data.find((recipe) => recipe.id === id)
      if (match) return match
    } else if (data && typeof data === "object" && "id" in data) {
      const recipe = data as Recipe
      if (recipe.id === id) return recipe
    }
  }

  return undefined
}

/**
 * Hook to fetch all recipes with optional filtering
 */
export function useRecipes(options?: {
  category?: string | null
  search?: string | null
  favoritesOnly?: boolean
  tags?: string[]
  limit?: number
}) {
  const { user, loading } = useAuthContext()
  const ownerUserId = principalId(user?.id)

  return useQuery({
    queryKey: buildRecipesKey(ownerUserId, options),
    queryFn: async () => {
      const supabase = getSupabase()

      // When tags are present, push the OR filter to the DB via RPC.
      // Supabase .contains() is AND-only; the RPC uses && (array overlap) for OR.
      if (options?.tags && options.tags.length > 0) {
        if (!user) return []
        const { data, error } = await supabase.rpc('filter_recipes_by_tags', {
          p_tags: options.tags,
        })
        if (error) throw error
        let result = mapRecipeRows(data as RecipeRow[] | null)
        // Apply any additional filters that the RPC does not handle.
        if (options.category) result = result.filter((r) => r.category === options.category)
        if (options.search) {
          const q = options.search.toLowerCase()
          result = result.filter(
            (r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
          )
        }
        if (options.favoritesOnly) result = result.filter((r) => r.favorite)
        if (options.limit !== undefined) result = result.slice(0, options.limit)
        return result
      }

      // Default path: no tag filter — standard Supabase query with server-side filters.
      let query = supabase
        .from("recipes")
        .select("*")
        .order("name", { ascending: true })

      if (options?.category) {
        query = query.eq("category", options.category)
      }

      if (options?.search) {
        query = query.or(`name.ilike.%${options.search}%,category.ilike.%${options.search}%`)
      }

      if (options?.favoritesOnly) {
        query = query.eq("favorite", true)
      }

      if (options?.limit !== undefined) {
        query = query.limit(options.limit)
      }

      const { data, error } = await query
      if (error) throw error
      // JSON recipe fields are normalized by the write path and database schema.
      return mapRecipeRows(data as unknown as RecipeRow[] | null)
    },
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    enabled: !loading && !!user,
  })
}

/**
 * Hook to fetch a single recipe by ID
 */
export function useRecipe(id: string | null) {
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: recipeKeys.detail(ownerUserId, id),
    queryFn: async () => {
      if (!id || !user) return null

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("recipe_uuid", id)
        .eq("user_id", user!.id)
        .single()

      if (error) throw error
      return mapRecipeRow(data as RecipeRow)
    },
    initialData: id ? findRecipeInCache(queryClient, ownerUserId, id) : undefined,
    enabled: !!id && !!user,
    staleTime: 30 * 1000,
  })
}

/**
 * Hook to create a new recipe
 * Implements optimistic updates for instant UI feedback
 */
export function useCreateRecipe() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const recipesKey = recipeKeys.all(ownerUserId)

  return useMutation({
    mutationFn: async (recipe: Omit<RecipeInsert, "id" | "user_id"> & { recipeUuid?: string }) => {
      const recipeUuid = recipe.recipeUuid || createRecipeUuid()
      const { recipeUuid: _recipeUuid, ...values } = recipe

      const supabase = getSupabase()
      const recipeInsert = supabase.from("recipes") as unknown as {
        insert: (values: Omit<RecipeInsert, "id" | "user_id"> & { id: string; recipe_uuid: string; user_id: string }) => {
          select: () => {
            single: () => Promise<{
              data: RecipeRow | null
              error: { code?: string; message: string } | null
            }>
          }
        }
      }
      const { data, error } = await recipeInsert
        .insert({ ...values, ...recipeUuidWrite(recipeUuid), user_id: user!.id })
        .select()
        .single()

      if (error?.code === "23505") {
        // A retry after a lost successful response reuses the mutation UUID.
        // Reconcile that owned row instead of duplicating or changing identity.
        const { data: existing, error: readError } = await supabase
          .from("recipes")
          .select("*")
          .eq("recipe_uuid", recipeUuid)
          .eq("user_id", user!.id)
          .single()
        if (!readError && existing) return mapRecipeRow(existing)
      }
      if (error) throw error
      return mapRecipeRow(data as RecipeRow)
    },
    // Optimistic update
    onMutate: async (recipe) => {
      recipe.recipeUuid ||= createRecipeUuid()
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipesKey })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: recipesKey })

      // Create optimistic recipe
      const id = recipe.recipeUuid
      const now = new Date().toISOString()
      const optimisticRecipe: Recipe = {
        id,
        legacyId: id,
        user_id: user?.id || "",
        name: recipe.name,
        category: recipe.category,
        servings: recipe.servings ?? 4,
        prep_time_minutes: recipe.prep_time_minutes ?? null,
        cook_time_minutes: recipe.cook_time_minutes ?? null,
        total_time_minutes: recipe.total_time_minutes ?? null,
        favorite: recipe.favorite ?? false,
        tags: recipe.tags ?? [],
        ingredients: recipe.ingredients ?? [],
        instructions: recipe.instructions ?? [],
        notes: normalizeRecipeNotes(recipe.notes),
        instruction_groups: recipe.instruction_groups
          ? normalizeRecipeInstructionGroups(recipe.instruction_groups)
          : null,
        image_url: recipe.image_url ?? null,
        created_at: now,
        updated_at: now,
      }

      // Optimistically add to all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: recipesKey },
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

      return { ownerUserId, previousQueries }
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
        { queryKey: recipesKey },
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
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: recipesKey })
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
  const ownerUserId = principalId(user?.id)
  const recipesKey = recipeKeys.all(ownerUserId)

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: RecipeUpdate }) => {
      const normalizedUpdates = normalizeRecipeUpdates(updates)

      const supabase = getSupabase()
      const recipeUpdate = supabase.from("recipes") as unknown as {
        update: (values: RecipeUpdate) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => {
              select: () => {
            single: () => Promise<{ data: RecipeRow | null; error: { message: string } | null }>
              }
            }
          }
        }
      }
      const { data, error } = await recipeUpdate
        .update(normalizedUpdates)
        .eq("recipe_uuid", id)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (error) throw error
      return mapRecipeRow(data as RecipeRow)
    },
    // Optimistic update
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipesKey })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: recipesKey })

      const normalizedUpdates = normalizeRecipeUpdates(updates)

      // Optimistically update all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: recipesKey },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === id 
            ? { ...r, ...normalizedUpdates, updated_at: new Date().toISOString() }
            : r
        )
      )

      return { ownerUserId, previousQueries }
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
        { queryKey: recipesKey },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === updated.id ? updated : r
        )
      )
      // Invalidate tags queries to refresh tag lists
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: recipesKey })
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
  const ownerUserId = principalId(user?.id)
  const recipesKey = recipeKeys.all(ownerUserId)

  return useMutation({
    mutationFn: async (id: string) => {
      const contributionResult = await runRecipeContributionCommand("DELETE", {
        recipeIds: [id],
        idempotencyKey: crypto.randomUUID(),
      })
      if (getActivePrincipalId() === ownerUserId) {
        queryClient.setQueryData(
          shoppingKeys.detail(ownerUserId),
          contributionResult.shopping_list
        )
      }

      const supabase = getSupabase()
      const { error } = await supabase.from("recipes").delete().eq("recipe_uuid", id).eq("user_id", user!.id)
      if (error) throw error
      return id
    },
    // Optimistic update
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipesKey })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: recipesKey })

      // Optimistically remove from all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: recipesKey },
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

      return { ownerUserId, previousQueries }
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
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: recipesKey })
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
  const ownerUserId = principalId(user?.id)
  const recipesKey = recipeKeys.all(ownerUserId)

  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => {
      const supabase = getSupabase()
      const recipeFavoriteUpdate = supabase.from("recipes") as unknown as {
        update: (values: { favorite: boolean }) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => {
              select: () => {
                single: () => Promise<{ data: RecipeRow | null; error: { message: string } | null }>
              }
            }
          }
        }
      }
      const { data, error } = await recipeFavoriteUpdate
        .update({ favorite: !favorite })
        .eq("recipe_uuid", id)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (error) throw error
      return mapRecipeRow(data as RecipeRow)
    },
    // Optimistic update
    onMutate: async ({ id, favorite }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: recipesKey })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<Recipe[]>({ queryKey: recipesKey })

      // Optimistically update all recipe queries
      queryClient.setQueriesData<Recipe[] | Recipe | null>(
        { queryKey: recipesKey },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === id ? { ...r, favorite: !favorite } : r
        )
      )

      return { ownerUserId, previousQueries }
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
        { queryKey: recipesKey },
        (old) => updateRecipeQuery(
          old as Recipe[] | Recipe | null | undefined,
          (r) => r.id === updated.id ? updated : r
        )
      )
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
  })
}

/**
 * Derives all unique tags from the recipes cache — no extra DB query.
 */
export function useAllTags() {
  const { data: recipes } = useRecipes()
  const data = useMemo(() => {
    const allTags = new Set<string>()
    ;(recipes || []).forEach((recipe) => {
      if (recipe.tags && Array.isArray(recipe.tags)) {
        recipe.tags.forEach((tag) => allTags.add(tag))
      }
    })
    return Array.from(allTags).sort()
  }, [recipes])
  return { data }
}

/**
 * Derives tags with usage counts from the recipes cache — no extra DB query.
 */
export function useTagsWithCounts() {
  const { data: recipes } = useRecipes()
  const data = useMemo(() => {
    const tagCounts = new Map<string, number>()
    ;(recipes || []).forEach((recipe) => {
      if (recipe.tags && Array.isArray(recipe.tags)) {
        recipe.tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
        })
      }
    })
    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }, [recipes])
  return { data }
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
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
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
      queryClient.invalidateQueries({ queryKey: configurationKeys.categories(ownerUserId) })
      // Also invalidate config query
      queryClient.invalidateQueries({ queryKey: configurationKeys.all(ownerUserId) })
    },
  })
}

/**
 * Hook to bulk update recipe categories (for reassignment)
 */
export function useBulkUpdateRecipeCategories() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)

  return useMutation({
    mutationFn: async ({
      oldCategory,
      newCategory,
    }: {
      oldCategory: string
      newCategory: string
    }) => {
      const supabase = getSupabase()
      const recipeCategoryUpdate = supabase.from("recipes") as unknown as {
        update: (values: { category: string }) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => {
              select: (columns: string) => Promise<{ data: Array<{ id: string }> | null; error: { message: string } | null }>
            }
          }
        }
      }
      const { data, error } = await recipeCategoryUpdate
        .update({ category: newCategory })
        .eq("user_id", user!.id)
        .eq("category", oldCategory)
        .select("id")

      if (error) throw error
      return data?.length || 0
    },
    onSuccess: () => {
      // Invalidate all recipe queries
      queryClient.invalidateQueries({ queryKey: recipeKeys.all(ownerUserId) })
    },
  })
}

/**
 * Hook to rename a tag across all recipes
 */
export function useRenameTag() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const recipesKey = recipeKeys.all(principalId(user?.id))

  return useMutation({
    mutationFn: async ({ oldTag, newTag }: { oldTag: string; newTag: string }) => {
      const supabase = getSupabase()
      const { error } = await supabase.rpc("rename_tag", {
        p_old_tag: oldTag,
        p_new_tag: newTag,
      })
      if (error) throw error
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
  })
}

/**
 * Hook to merge multiple tags into one
 */
export function useMergeTags() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const recipesKey = recipeKeys.all(principalId(user?.id))

  return useMutation({
    mutationFn: async ({ sourceTags, targetTag }: { sourceTags: string[]; targetTag: string }) => {
      const supabase = getSupabase()
      // One RPC call per source tag (O(S) requests instead of O(S*N))
      const results = await Promise.all(
        sourceTags.map((sourceTag) =>
          supabase.rpc("merge_tags", {
            p_source_tag: sourceTag,
            p_target_tag: targetTag,
          })
        )
      )
      const errors = results.filter((r) => r.error)
      if (errors.length > 0) throw errors[0].error
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
  })
}

/**
 * Hook to delete a tag from all recipes
 */
export function useDeleteTag() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const recipesKey = recipeKeys.all(principalId(user?.id))

  return useMutation({
    mutationFn: async (tag: string) => {
      const supabase = getSupabase()
      const { error } = await supabase.rpc("delete_tag", {
        p_tag: tag,
      })
      if (error) throw error
    },
    onSuccess: () => {
      // Invalidate all recipe queries and tag queries
      queryClient.invalidateQueries({ queryKey: recipesKey })
    },
  })
}

