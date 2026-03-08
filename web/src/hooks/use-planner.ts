"use client"

import { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Recipe, RecipeHistory, RecipeHistoryStatsRow, WeeklyPlan } from "@/types/database"
import { generateMealPlan, getSwapRecipe, autoAssignDays } from "@/lib/meal-planner"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { useCategories, useUpdateUserConfig, useUserConfig } from "@/hooks/shared/user-config"

const WEEKLY_PLANS_KEY = ["weekly_plans"]
const HISTORY_KEY = ["recipe_history"]
const RECENT_HISTORY_KEY = [...HISTORY_KEY, "recent"]
const HISTORY_STATS_KEY = [...HISTORY_KEY, "stats"]
const RECIPES_KEY = ["recipes"]

type DirectWeeklyPlanWrite = {
  weekDate: string
  recipeIds?: string[]
  dayAssignments?: Record<string, number> | null
  madeRecipeIds?: string[]
  scale?: number
  refreshGeneratedAt?: boolean
}

export { useUpdateUserConfig, useUserConfig } from "@/hooks/shared/user-config"

async function fetchExistingWeeklyPlan(userId: string, weekDate: string) {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from("weekly_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("week_date", weekDate)
    .maybeSingle()

  if (error) throw error
  return (data as WeeklyPlan | null) || null
}

async function persistWeeklyPlanDirect(userId: string, write: DirectWeeklyPlanWrite) {
  const supabase = getSupabase()
  const existingPlan = await fetchExistingWeeklyPlan(userId, write.weekDate)

  const payload = {
    user_id: userId,
    week_date: write.weekDate,
    recipe_ids: write.recipeIds ?? existingPlan?.recipe_ids ?? [],
    day_assignments:
      write.dayAssignments !== undefined
        ? write.dayAssignments
        : (existingPlan?.day_assignments ?? null),
    made_recipe_ids: write.madeRecipeIds ?? existingPlan?.made_recipe_ids ?? [],
    scale: write.scale ?? existingPlan?.scale ?? 1.0,
    generated_at:
      write.refreshGeneratedAt
        ? new Date().toISOString()
        : (existingPlan?.generated_at ?? new Date().toISOString()),
  }

  const { error } = await supabase
    .from("weekly_plans")
    // @ts-expect-error - TypeScript incorrectly infers upsert parameter type as 'never'
    .upsert(payload, { onConflict: "user_id,week_date" })

  if (error) throw error

  return existingPlan
}

export function getRecipeHistoryQueryKey() {
  return [...HISTORY_KEY]
}

export function getRecentRecipeHistoryQueryKey(daysBack: number) {
  return [...RECENT_HISTORY_KEY, daysBack]
}

export function getRecipeHistoryStatsQueryKey() {
  return [...HISTORY_STATS_KEY]
}

/**
 * Hook to fetch weekly plan for a specific week
 */
export function useWeeklyPlan(weekDate: string) {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: [...WEEKLY_PLANS_KEY, weekDate],
    queryFn: async () => {
      const emptyPlan: WeeklyPlan = {
        user_id: user?.id || "",
        week_date: weekDate,
        recipe_ids: [],
        made_recipe_ids: [],
        day_assignments: null,
        scale: 1.0,
        generated_at: "",
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      if (error) throw error
      return (data as WeeklyPlan | null) || emptyPlan
    },
    enabled: !!weekDate && !!user,
  })
}

/**
 * Hook to fetch all recipes for a weekly plan
 */
export function useWeeklyPlanRecipes(recipeIds: string[]) {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: [...RECIPES_KEY, "weekly", recipeIds],
    queryFn: async () => {
      if (recipeIds.length === 0) return []

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .eq("user_id", user!.id)
        .in("id", recipeIds)

      if (error) throw error
      const recipes = data as Recipe[]

      // Preserve order according to recipeIds array
      const recipeMap = new Map(recipes.map((r) => [r.id, r]))
      return recipeIds.map((id) => recipeMap.get(id)).filter((r): r is Recipe => r !== undefined)
    },
    enabled: recipeIds.length > 0 && !!user,
  })
}

/**
 * Hook to fetch recipe history
 */
export function useRecipeHistory() {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: getRecipeHistoryQueryKey(),
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipe_history")
        .select("*")
        .eq("user_id", user!.id)
        .order("date_made", { ascending: false })

      if (error) throw error
      return data as RecipeHistory[]
    },
    enabled: !!user,
  })
}

/**
 * Hook to fetch only recent recipe history used for planner recency behavior.
 */
export function useRecentRecipeHistory() {
  const { user } = useAuthContext()
  const { data: config } = useUserConfig()
  const daysBack = config?.history_exclusion_days ?? 14

  return useQuery({
    queryKey: getRecentRecipeHistoryQueryKey(daysBack),
    queryFn: async () => {
      const supabase = getSupabase()
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - daysBack)
      const { data, error } = await supabase
        .from("recipe_history")
        .select("recipe_id, date_made")
        .eq("user_id", user!.id)
        .gte("date_made", cutoff.toISOString())
        .order("date_made", { ascending: false })
        .limit(500)

      if (error) throw error
      return data as RecipeHistory[]
    },
    enabled: !!user,
  })
}

/**
 * Hook to fetch aggregate history stats for all recipes.
 */
export function useRecipeHistoryStats() {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: getRecipeHistoryStatsQueryKey(),
    queryFn: async () => {
      const supabase = getSupabase()
      // @ts-expect-error - RPC not yet reflected in generated Supabase client types
      const { data, error } = await supabase.rpc("get_recipe_history_stats", {
        p_user_id: user!.id,
      })

      if (error) throw error
      return (data as RecipeHistoryStatsRow[]) || []
    },
    enabled: !!user,
  })
}

/**
 * Hook to get categories enabled for the planner
 * Returns all categories if enabled_planner_categories is null (not configured)
 * Returns filtered subset if enabled_planner_categories is set
 */
export function usePlannerCategories() {
  const { data: config } = useUserConfig()
  const { data: allCategories } = useCategories()

  return useMemo(() => {
    if (!config || !allCategories) return []

    // If enabled_planner_categories is null, return all categories (default)
    if (config.enabled_planner_categories === null) {
      return allCategories
    }

    // Otherwise, filter to only enabled categories (maintains order from allCategories)
    const enabledSet = new Set(config.enabled_planner_categories)
    return allCategories.filter(cat => enabledSet.has(cat))
  }, [config, allCategories])
}

/**
 * Hook to generate a new meal plan
 */
export function useGenerateMealPlan() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, selection }: { weekDate: string; selection: Record<string, number> }) => {
      const supabase = getSupabase()

      // Fetch everything except history first so the history query can use the configured window.
      const [
        { data: recipes, error: recipesError },
        { data: config, error: configError },
        { data: existingPlan },
      ] = await Promise.all([
        supabase.from("recipes").select("id, category, name").eq("user_id", user!.id),
        supabase
          .from("user_config")
          .select("history_exclusion_days, excluded_days, preferred_days, auto_assign_days, enabled_planner_categories")
          .single(),
        supabase
          .from("weekly_plans")
          .select("*")
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
          .maybeSingle(),
      ])
      if (recipesError) throw recipesError
      if (configError && configError.code !== "PGRST116") throw configError

      const typedPlan = existingPlan as WeeklyPlan | null
      const madeRecipeIds = typedPlan?.made_recipe_ids || []
      const existingDayAssignments = typedPlan?.day_assignments || null

      // If regenerating and we need to preserve made recipes, filter them out from selection
      let recipesToGenerate = recipes as Recipe[]
      let preservedRecipeIds: string[] = []

      if (existingPlan && madeRecipeIds.length > 0) {
        // Preserve recipes that are marked as made
        preservedRecipeIds = madeRecipeIds
        // Remove preserved recipes from the pool for generation
        recipesToGenerate = recipesToGenerate.filter((r) => !preservedRecipeIds.includes(r.id))
      }

      // Filter selection to only include enabled categories
      const typedConfig = config as {
        history_exclusion_days?: number
        excluded_days?: number[]
        preferred_days?: number[] | null
        auto_assign_days?: boolean
        enabled_planner_categories?: string[] | null
      } | null
      const historyExclusionDays = typedConfig?.history_exclusion_days || 7
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - historyExclusionDays)

      const { data: history, error: historyError } = await supabase
        .from("recipe_history")
        .select("recipe_id, date_made")
        .eq("user_id", user!.id)
        .gte("date_made", cutoff.toISOString())
        .order("date_made", { ascending: false })

      if (historyError) throw historyError

      const enabledCategories = typedConfig?.enabled_planner_categories
      let filteredSelection = selection

      // If enabled_planner_categories is set (not null), filter selection
      if (enabledCategories !== null && enabledCategories !== undefined) {
        const enabledSet = new Set(enabledCategories)
        filteredSelection = Object.fromEntries(
          Object.entries(selection).filter(([category]) => enabledSet.has(category))
        )
      }

      const result = generateMealPlan(
        recipesToGenerate,
        history as RecipeHistory[],
        filteredSelection,
        historyExclusionDays
      )

      // Combine preserved recipes with newly generated ones
      const allRecipeIds = [...preservedRecipeIds, ...result.recipes.map((r) => r.id)]

      // Auto-assign days if enabled
      let dayAssignments: Record<string, number> | null = existingDayAssignments
      if (typedConfig?.auto_assign_days) {
        dayAssignments = autoAssignDays(
          allRecipeIds,
          typedConfig.excluded_days || [],
          typedConfig.preferred_days || null,
          existingDayAssignments || {}
        )
      }

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan - preserve made_recipe_ids
        const { error: saveError } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({
            recipe_ids: allRecipeIds,
            made_recipe_ids: madeRecipeIds,
            day_assignments: dayAssignments,
            scale: 1.0,
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
        if (saveError) throw saveError
      } else {
        // Insert new plan
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        const { error: saveError } = await supabase.from("weekly_plans").insert({
          user_id: user!.id,
          week_date: weekDate,
          recipe_ids: allRecipeIds,
          day_assignments: dayAssignments,
          scale: 1.0,
          generated_at: new Date().toISOString(),
        })
        if (saveError) throw saveError
      }

      return { ...result, weekDate }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Fetch current recipe ids for the signed-in user.
 * Used by planner flows that need to filter stale ids (e.g. loading templates).
 */
export function useFetchRecipeIds() {
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("id")
        .eq("user_id", user!.id)

      if (error) throw error
      return ((data as { id: string }[] | null) || []).map((row) => row.id)
    },
  })
}

/**
 * Hook to swap a recipe in the meal plan
 * Updates cache immediately after successful swap for instant UI feedback
 */
export function useSwapRecipe() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, oldRecipeId, category, excludeIds }: {
      weekDate: string; oldRecipeId: string; category: string; excludeIds: string[]
    }) => {
      const supabase = getSupabase()
      // Only id, category, and name are needed by getSwapRecipe for selection.
      // Full recipe data is re-fetched by useWeeklyPlanRecipes after invalidation.
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("id, category, name")
        .eq("user_id", user!.id)
      if (recipesError) throw recipesError

      const newRecipe = getSwapRecipe(recipes as Recipe[], category, excludeIds)
      if (!newRecipe) throw new Error(`No more ${category} recipes available`)

      const { data: plan, error: planError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids, day_assignments")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .single()

      if (planError) throw planError

      const typedPlan = plan as { recipe_ids?: string[]; day_assignments?: Record<string, number> | null } | null
      const newRecipeIds = (typedPlan?.recipe_ids || []).map((id) => id === oldRecipeId ? newRecipe.id : id)
      const prevAssignments = typedPlan?.day_assignments || {}
      const dayIndex = prevAssignments[oldRecipeId]
      const { [oldRecipeId]: _removed, ...rest } = prevAssignments
      const newDayAssignments =
        dayIndex !== undefined ? { ...rest, [newRecipe.id]: dayIndex } : rest

      await persistWeeklyPlanDirect(user!.id, {
        weekDate,
        recipeIds: newRecipeIds,
        dayAssignments: Object.keys(newDayAssignments).length > 0 ? newDayAssignments : null,
      })

      return { newRecipe, oldRecipeId, weekDate }
    },

    onSuccess: (result, variables) => {
      const oldPlan = queryClient.getQueryData<WeeklyPlan>([...WEEKLY_PLANS_KEY, variables.weekDate])
      if (!oldPlan) return
      const oldRecipeIds = oldPlan.recipe_ids
      const newRecipeIds = oldRecipeIds.map((id) =>
        id === variables.oldRecipeId ? result.newRecipe.id : id
      )
      const prevAssignments = oldPlan.day_assignments || {}
      const dayIndex = prevAssignments[variables.oldRecipeId]
      const { [variables.oldRecipeId]: _removed, ...rest } = prevAssignments
      const newDayAssignments =
        dayIndex !== undefined ? { ...rest, [result.newRecipe.id]: dayIndex } : rest

      // Update weekly plan cache so recipe_ids and day_assignments are new
      queryClient.setQueryData<WeeklyPlan>([...WEEKLY_PLANS_KEY, variables.weekDate], {
        ...oldPlan,
        recipe_ids: newRecipeIds,
        day_assignments: Object.keys(newDayAssignments).length > 0 ? newDayAssignments : null,
      })

      // Optimistically set recipes cache for the NEW recipe_ids so useWeeklyPlanRecipes
      // has data immediately and the calendar does not unmount (enables flip animation)
      const previousRecipes = queryClient.getQueryData<Recipe[]>([...RECIPES_KEY, "weekly", oldRecipeIds])
      const newRecipes = previousRecipes
        ? previousRecipes.map((r) => (r.id === variables.oldRecipeId ? result.newRecipe : r))
        : [result.newRecipe]
      queryClient.setQueryData<Recipe[]>([...RECIPES_KEY, "weekly", newRecipeIds], newRecipes)

      // Then invalidate to ensure full consistency
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to save weekly plan
 */
export function useSaveWeeklyPlan() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({
      weekDate,
      recipeIds,
      scale,
      dayAssignments,
    }: {
      weekDate: string
      recipeIds: string[]
      scale?: number
      dayAssignments?: Record<string, number> | null
    }) => {
      await persistWeeklyPlanDirect(user!.id, {
        weekDate,
        recipeIds,
        dayAssignments,
        scale: scale || 1.0,
        refreshGeneratedAt: true,
      })

      return { weekDate, recipeIds }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Hook to add a recipe to an existing (or new) weekly plan.
 * @param dayOfWeek - Optional 0–6 (0=Sunday): assign the new recipe to this day-of-week.
 * If omitted, the recipe is unassigned and placed by the unassigned-distribution logic.
 */
export function useAddRecipeToPlan() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, recipeId, dayOfWeek }: { weekDate: string; recipeId: string; dayOfWeek?: number }) => {
      const existingPlan = await fetchExistingWeeklyPlan(user!.id, weekDate)
      const typedPlan = existingPlan as { recipe_ids?: string[]; day_assignments?: Record<string, number> | null } | null
      const currentIds = typedPlan?.recipe_ids || []
      if (currentIds.includes(recipeId)) {
        throw new Error("Recipe is already in this week's meal plan")
      }

      const mergedDayAssignments = {
        ...(typedPlan?.day_assignments || {}),
        ...(dayOfWeek !== undefined ? { [recipeId]: dayOfWeek } : {}),
      }

      await persistWeeklyPlanDirect(user!.id, {
        weekDate,
        recipeIds: [...currentIds, recipeId],
        dayAssignments: Object.keys(mergedDayAssignments).length > 0 ? mergedDayAssignments : null,
        scale: existingPlan?.scale || 1.0,
        refreshGeneratedAt: true,
      })

      return { weekDate, recipeId }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Hook to remove a recipe from the weekly plan
 * Implements optimistic updates for instant UI feedback
 */
export function useRemoveRecipeFromPlan() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, recipeId }: { weekDate: string; recipeId: string }) => {
      const existingPlan = await fetchExistingWeeklyPlan(user!.id, weekDate)
      if (!existingPlan) {
        throw new Error(`Weekly plan not found for ${weekDate}`)
      }

      const typedPlan = existingPlan as {
        recipe_ids: string[]
        made_recipe_ids?: string[]
        day_assignments?: Record<string, number> | null
      }
      const nextDayAssignments = { ...(typedPlan.day_assignments || {}) }
      delete nextDayAssignments[recipeId]
      await persistWeeklyPlanDirect(user!.id, {
        weekDate,
        recipeIds: typedPlan.recipe_ids.filter((id) => id !== recipeId),
        madeRecipeIds: (typedPlan.made_recipe_ids || []).filter((id) => id !== recipeId),
        dayAssignments: Object.keys(nextDayAssignments).length > 0 ? nextDayAssignments : null,
        scale: existingPlan.scale ?? 1.0,
      })

      return { weekDate, recipeId }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { weekDate, recipeId } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate],
        (old) => {
          if (!old) return old
          return {
            ...old,
            recipe_ids: old.recipe_ids.filter((id) => id !== recipeId),
            // Also remove from made_recipe_ids if present
            made_recipe_ids: (old.made_recipe_ids || []).filter((id) => id !== recipeId),
            day_assignments: old.day_assignments
              ? (() => {
                  const nextDayAssignments = { ...old.day_assignments }
                  delete nextDayAssignments[recipeId]
                  return Object.keys(nextDayAssignments).length > 0 ? nextDayAssignments : null
                })()
              : null,
          }
        }
      )

      return { previousPlan }
    },

    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(
          [...WEEKLY_PLANS_KEY, variables.weekDate],
          context.previousPlan
        )
      }
    },

    onSettled: (_, __, variables) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to mark a recipe as made (adds to history without requiring a week plan)
 * Implements optimistic updates for instant UI feedback
 */
export function useMarkRecipeAsMade() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const supabase = getSupabase()
      const { error: insertError } = await supabase
        .from("recipe_history")
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        .insert({ user_id: user!.id, recipe_id: recipeId, date_made: new Date().toISOString() })

      if (insertError) throw insertError
      return { recipeId }
    },
    // Optimistic update
    onMutate: async (recipeId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: HISTORY_KEY })

      // Snapshot previous value for rollback
      const previousHistory = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY])

      // Optimistically update cache
      queryClient.setQueryData<RecipeHistory[]>(
        [...HISTORY_KEY],
        (old) => {
          const existing = old || []
          return [
            { id: Date.now(), user_id: user?.id || "", recipe_id: recipeId, date_made: new Date().toISOString() },
            ...existing
          ]
        }
      )

      return { previousHistory }
    },
    onError: (err, recipeId, context) => {
      // Rollback on error
      if (context?.previousHistory !== undefined) {
        queryClient.setQueryData([...HISTORY_KEY], context.previousHistory)
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}

/**
 * Hook to remove the most recent history entry for a recipe
 * Implements optimistic updates for instant UI feedback
 */
export function useUnmarkRecipeAsMade() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const supabase = getSupabase()
      
      // Get the most recent history entry for this recipe
      const { data: recentHistory, error: historyError } = await supabase
        .from("recipe_history")
        .select("id")
        .eq("user_id", user!.id)
        .eq("recipe_id", recipeId)
        .order("date_made", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (historyError && historyError.code !== "PGRST116") throw historyError

      if (recentHistory) {
        const typedHistory = recentHistory as { id: number } | null
        if (typedHistory) {
          const { error: deleteError } = await supabase
            .from("recipe_history")
            .delete()
            .eq("user_id", user!.id)
            .eq("id", typedHistory.id)
          if (deleteError) throw deleteError
        }
      }

      return { recipeId }
    },
    // Optimistic update
    onMutate: async (recipeId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: HISTORY_KEY })

      // Snapshot previous value for rollback
      const previousHistory = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY])

      // Optimistically update cache - remove most recent entry for this recipe
      queryClient.setQueryData<RecipeHistory[]>(
        [...HISTORY_KEY],
        (old) => {
          const existing = old || []
          // Find and remove the most recent entry for this recipe
          // History is sorted by date_made DESC, so first match is most recent
          const index = existing.findIndex(entry => entry.recipe_id === recipeId)
          if (index !== -1) {
            return [...existing.slice(0, index), ...existing.slice(index + 1)]
          }
          return existing
        }
      )

      return { previousHistory }
    },
    onError: (err, recipeId, context) => {
      // Rollback on error
      if (context?.previousHistory !== undefined) {
        queryClient.setQueryData([...HISTORY_KEY], context.previousHistory)
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}

/**
 * Hook to toggle recipe "made" status for a specific week
 * Implements optimistic updates for instant UI feedback
 */
export function useMarkRecipeMade() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ recipeId, weekDate, isMadeForWeek, dateMade }: {
      recipeId: string; weekDate: string; isMadeForWeek: boolean; dateMade?: string
    }) => {
      const supabase = getSupabase()
      const rpcClient = supabase as unknown as {
        rpc: (
          fn: "toggle_weekly_recipe_made",
          args: {
            p_recipe_id: string
            p_week_date: string
            p_is_made_for_week: boolean
            p_date_made: string | null
          }
        ) => Promise<{
          data: Array<{
            action: "marked" | "unmarked"
            recipe_id: string
            week_date: string
            made_recipe_ids: string[]
            history_date_made: string | null
          }> | null
          error: { message: string } | null
        }>
      }

      const { data, error } = await rpcClient.rpc("toggle_weekly_recipe_made", {
        p_recipe_id: recipeId,
        p_week_date: weekDate,
        p_is_made_for_week: isMadeForWeek,
        p_date_made: dateMade || null,
      })

      if (error) throw error

      const row = data?.[0]
      if (!row) throw new Error(`Failed to toggle recipe made state: ${recipeId}`)

      return {
        action: row.action,
        recipeId: row.recipe_id,
        weekDate: row.week_date,
        madeRecipeIds: row.made_recipe_ids,
      }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { recipeId, weekDate, isMadeForWeek } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate],
        (old) => {
          if (!old) return old
          const newMadeIds = isMadeForWeek
            ? (old.made_recipe_ids || []).filter((id) => id !== recipeId)
            : [...(old.made_recipe_ids || []), recipeId]
          return { ...old, made_recipe_ids: newMadeIds }
        }
      )

      return { previousPlan }
    },

    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(
          [...WEEKLY_PLANS_KEY, variables.weekDate],
          context.previousPlan
        )
      }
    },

    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Hook to save day assignments for recipes in a weekly plan
 * Implements optimistic updates for instant UI feedback
 */
export function useSaveDayAssignments() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, dayAssignments }: { weekDate: string; dayAssignments: Record<string, number> }) => {
      await persistWeeklyPlanDirect(user!.id, {
        weekDate,
        dayAssignments,
      })

      return { weekDate, dayAssignments }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { weekDate, dayAssignments } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate],
        (old) => {
          if (!old) {
            // Create a new plan if none exists
            return {
              user_id: user?.id || "",
              week_date: weekDate,
              recipe_ids: [],
              made_recipe_ids: [],
              day_assignments: dayAssignments,
              scale: 1.0,
              generated_at: new Date().toISOString(),
            }
          }
          return { ...old, day_assignments: dayAssignments }
        }
      )

      return { previousPlan }
    },

    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(
          [...WEEKLY_PLANS_KEY, variables.weekDate],
          context.previousPlan
        )
      }
    },

    onSettled: (_, __, variables) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Format a Date as local calendar date YYYY-MM-DD (avoids UTC shift from toISOString).
 */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * Get the week-start date (YYYY-MM-DD) for the week containing the given date,
 * using the client's local calendar. weekStartDay: 0 = Sunday, 1 = Monday, etc.
 */
export function getWeekStartDate(date: Date, weekStartDay: number = 1): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day < weekStartDay ? 7 : 0) + day - weekStartDay
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return toLocalDateString(d)
}

export function navigateWeek(currentWeekDate: string, direction: "prev" | "next"): string {
  const [y, m, day] = currentWeekDate.split("-").map(Number)
  const date = new Date(y, m - 1, day)
  date.setDate(date.getDate() + (direction === "next" ? 7 : -7))
  return toLocalDateString(date)
}
