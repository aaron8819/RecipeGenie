"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { Recipe, RecipeHistory, WeeklyPlan, UserConfig } from "@/types/database"
import { generateMealPlan, getSwapRecipe, autoAssignDays } from "@/lib/meal-planner"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultConfig } from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"

const WEEKLY_PLANS_KEY = ["weekly_plans"]
const HISTORY_KEY = ["recipe_history"]
const CONFIG_KEY = ["user_config"]
const RECIPES_KEY = ["recipes"]

// Guest mode cache helpers
function getGuestPlan(queryClient: ReturnType<typeof useQueryClient>, weekDate: string): WeeklyPlan | null {
  return queryClient.getQueryData<WeeklyPlan>([...WEEKLY_PLANS_KEY, weekDate, true]) || null
}

function setGuestPlan(queryClient: ReturnType<typeof useQueryClient>, weekDate: string, plan: WeeklyPlan) {
  queryClient.setQueryData([...WEEKLY_PLANS_KEY, weekDate, true], plan)
}

/**
 * Hook to fetch weekly plan for a specific week
 */
export function useWeeklyPlan(weekDate: string) {
  const { isGuest, user } = useAuthContext()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: [...WEEKLY_PLANS_KEY, weekDate, isGuest],
    queryFn: async () => {
      const emptyPlan: WeeklyPlan = {
        user_id: isGuest ? "guest" : "",
        week_date: weekDate,
        recipe_ids: [],
        made_recipe_ids: [],
        day_assignments: null,
        scale: 1.0,
        generated_at: "",
      }

      if (isGuest) {
        return getGuestPlan(queryClient, weekDate) || emptyPlan
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
    enabled: !!weekDate,
  })
}

/**
 * Hook to fetch all recipes for a weekly plan
 */
export function useWeeklyPlanRecipes(recipeIds: string[]) {
  const { isGuest, user } = useAuthContext()

  return useQuery({
    queryKey: [...RECIPES_KEY, "weekly", recipeIds, isGuest],
    queryFn: async () => {
      if (recipeIds.length === 0) return []

      let recipes: Recipe[] = []

      if (isGuest) {
        const allRecipes = getDefaultRecipes()
        recipes = allRecipes.filter((r) => recipeIds.includes(r.id))
      } else {
        const supabase = getSupabase()
        const { data, error } = await supabase
          .from("recipes")
          .select("*")
          .eq("user_id", user!.id)
          .in("id", recipeIds)

        if (error) throw error
        recipes = data as Recipe[]
      }

      // Preserve order according to recipeIds array
      const recipeMap = new Map(recipes.map((r) => [r.id, r]))
      return recipeIds.map((id) => recipeMap.get(id)).filter((r): r is Recipe => r !== undefined)
    },
    enabled: recipeIds.length > 0,
  })
}

/**
 * Hook to fetch recipe history
 */
export function useRecipeHistory() {
  const { isGuest, user } = useAuthContext()
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: [...HISTORY_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) {
        return queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, true]) || []
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipe_history")
        .select("*")
        .eq("user_id", user!.id)
        .order("date_made", { ascending: false })

      if (error) throw error
      return data as RecipeHistory[]
    },
    initialData: isGuest ? [] : undefined,
  })
}

/**
 * Hook to fetch user config
 */
export function useUserConfig() {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: [...CONFIG_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) {
        return getDefaultConfig() as unknown as UserConfig
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("*")
        .single()

      if (error) {
        return {
          user_id: "",
          categories: ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"],
          default_selection: { chicken: 2, turkey: 1, steak: 1 },
          excluded_keywords: [],
          history_exclusion_days: 10,
          week_start_day: 1,
          category_overrides: {},
          custom_categories: [],
          category_order: null,
          excluded_days: [],
          preferred_days: null,
          auto_assign_days: true,
        } as UserConfig
      }
      return data as UserConfig
    },
  })
}

/**
 * Hook to update user config
 */
export function useUpdateUserConfig() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (updates: Partial<UserConfig>) => {
      if (isGuest) {
        // For guest mode, just update local storage
        const current = getDefaultConfig()
        const updated = { ...current, ...updates }
        localStorage.setItem("guest-config", JSON.stringify(updated))
        return updated as unknown as UserConfig
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update(updates)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (error) throw error
      return data as UserConfig
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...CONFIG_KEY, isGuest], data)
    },
  })
}

/**
 * Hook to generate a new meal plan
 */
export function useGenerateMealPlan() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, selection }: { weekDate: string; selection: Record<string, number> }) => {
      if (isGuest) {
        const recipes = getDefaultRecipes()
        const history = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, true]) || []
        const config = getDefaultConfig()

        const result = generateMealPlan(recipes, history, selection, config.history_exclusion_days)

        // Auto-assign days if enabled
        let dayAssignments: Record<string, number> | null = null
        if (config.auto_assign_days) {
          dayAssignments = autoAssignDays(
            result.recipes.map((r) => r.id),
            config.excluded_days || [],
            config.preferred_days || null,
            {}
          )
        }

        const plan: WeeklyPlan = {
          user_id: "guest",
          week_date: weekDate,
          recipe_ids: result.recipes.map((r) => r.id),
          made_recipe_ids: [],
          day_assignments: dayAssignments,
          scale: 1.0,
          generated_at: new Date().toISOString(),
        }
        setGuestPlan(queryClient, weekDate, plan)
        return { ...result, weekDate }
      }

      const supabase = getSupabase()

      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")
        .eq("user_id", user!.id)
      if (recipesError) throw recipesError

      const { data: history, error: historyError } = await supabase
        .from("recipe_history")
        .select("*")
        .eq("user_id", user!.id)
      if (historyError) throw historyError

      // Get full config for planner settings
      const { data: config } = await supabase
        .from("user_config")
        .select("history_exclusion_days, excluded_days, preferred_days, auto_assign_days")
        .single()

      // Check if plan already exists to preserve made recipes
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .maybeSingle()

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

      const result = generateMealPlan(
        recipesToGenerate,
        history as RecipeHistory[],
        selection,
        (config as { history_exclusion_days?: number } | null)?.history_exclusion_days || 7
      )

      // Combine preserved recipes with newly generated ones
      const allRecipeIds = [...preservedRecipeIds, ...result.recipes.map((r) => r.id)]

      // Auto-assign days if enabled
      let dayAssignments: Record<string, number> | null = existingDayAssignments
      const typedConfig = config as { auto_assign_days?: boolean; excluded_days?: number[]; preferred_days?: number[] | null } | null
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
 * Hook to swap a recipe in the meal plan
 * Updates cache immediately after successful swap for instant UI feedback
 */
export function useSwapRecipe() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, oldRecipeId, category, excludeIds }: {
      weekDate: string; oldRecipeId: string; category: string; excludeIds: string[]
    }) => {
      if (isGuest) {
        const recipes = getDefaultRecipes()
        const newRecipe = getSwapRecipe(recipes, category, excludeIds)
        if (!newRecipe) throw new Error(`No more ${category} recipes available`)

        const plan = getGuestPlan(queryClient, weekDate)
        if (!plan) throw new Error("Plan not found")

        const typedPlan = plan as { recipe_ids?: string[] } | null
        const newRecipeIds = (typedPlan?.recipe_ids || []).map((id) => id === oldRecipeId ? newRecipe.id : id)
        setGuestPlan(queryClient, weekDate, { ...plan, recipe_ids: newRecipeIds })
        return { newRecipe, oldRecipeId, weekDate }
      }

      const supabase = getSupabase()
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")
        .eq("user_id", user!.id)
      if (recipesError) throw recipesError

      const newRecipe = getSwapRecipe(recipes as Recipe[], category, excludeIds)
      if (!newRecipe) throw new Error(`No more ${category} recipes available`)

      const { data: plan, error: planError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .single()

      if (planError) throw planError

      const typedPlan = plan as { recipe_ids?: string[] } | null
      const newRecipeIds = (typedPlan?.recipe_ids || []).map((id) => id === oldRecipeId ? newRecipe.id : id)

      const { error: saveError } = await supabase
        .from("weekly_plans")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ recipe_ids: newRecipeIds })
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)

      if (saveError) throw saveError
      return { newRecipe, oldRecipeId, weekDate }
    },

    onSuccess: (result, variables) => {
      // Immediately update the cache with the new recipe
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, variables.weekDate, isGuest],
        (old) => {
          if (!old) return old
          const newRecipeIds = old.recipe_ids.map((id) =>
            id === variables.oldRecipeId ? result.newRecipe.id : id
          )
          return { ...old, recipe_ids: newRecipeIds }
        }
      )

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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, recipeIds, scale }: { weekDate: string; recipeIds: string[]; scale?: number }) => {
      if (isGuest) {
        const existing = getGuestPlan(queryClient, weekDate)
        const plan: WeeklyPlan = {
          user_id: "guest",
          week_date: weekDate,
          recipe_ids: recipeIds,
          made_recipe_ids: existing?.made_recipe_ids || [],
          day_assignments: existing?.day_assignments || null,
          scale: scale || 1.0,
          generated_at: new Date().toISOString(),
        }
        setGuestPlan(queryClient, weekDate, plan)
        return { weekDate, recipeIds }
      }

      const supabase = getSupabase()
      
      // Check if plan already exists
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({
            recipe_ids: recipeIds,
            scale: scale || 1.0,
            made_recipe_ids: (existingPlan as WeeklyPlan).made_recipe_ids || [],
            day_assignments: (existingPlan as WeeklyPlan).day_assignments || null,
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
        if (error) throw error
      } else {
        // Insert new plan
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        const { error } = await supabase.from("weekly_plans").insert({
          user_id: user!.id,
          week_date: weekDate,
          recipe_ids: recipeIds,
          day_assignments: null,
          scale: scale || 1.0,
          generated_at: new Date().toISOString(),
        })
        if (error) throw error
      }

      return { weekDate, recipeIds }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
    },
  })
}

/**
 * Hook to add a recipe to an existing (or new) weekly plan
 */
export function useAddRecipeToPlan() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, recipeId }: { weekDate: string; recipeId: string }) => {
      if (isGuest) {
        const existing = getGuestPlan(queryClient, weekDate)
        const currentIds = existing?.recipe_ids || []
        if (currentIds.includes(recipeId)) {
          throw new Error("Recipe is already in this week's meal plan")
        }
        const plan: WeeklyPlan = {
          user_id: "guest",
          week_date: weekDate,
          recipe_ids: [...currentIds, recipeId],
          made_recipe_ids: existing?.made_recipe_ids || [],
          day_assignments: existing?.day_assignments || null,
          scale: existing?.scale || 1.0,
          generated_at: new Date().toISOString(),
        }
        setGuestPlan(queryClient, weekDate, plan)
        return { weekDate, recipeId }
      }

      const supabase = getSupabase()
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      const typedPlan = existingPlan as { recipe_ids?: string[] } | null
      const currentIds = typedPlan?.recipe_ids || []
      if (currentIds.includes(recipeId)) {
        throw new Error("Recipe is already in this week's meal plan")
      }

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({
            recipe_ids: [...currentIds, recipeId],
            scale: (existingPlan as WeeklyPlan).scale || 1.0,
            made_recipe_ids: (existingPlan as WeeklyPlan).made_recipe_ids || [],
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
        if (error) throw error
      } else {
        // Insert new plan
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        const { error } = await supabase.from("weekly_plans").insert({
          user_id: user!.id,
          week_date: weekDate,
          recipe_ids: [...currentIds, recipeId],
          scale: 1.0,
          generated_at: new Date().toISOString(),
        })
        if (error) throw error
      }

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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, recipeId }: { weekDate: string; recipeId: string }) => {
      if (isGuest) {
        const existing = getGuestPlan(queryClient, weekDate)
        if (!existing) throw new Error("Plan not found")
        setGuestPlan(queryClient, weekDate, {
          ...existing,
          recipe_ids: existing.recipe_ids.filter((id) => id !== recipeId),
        })
        return { weekDate, recipeId }
      }

      const supabase = getSupabase()
      const { data: existingPlan, error: fetchError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .single()

      if (fetchError) throw fetchError

      const { error } = await supabase
        .from("weekly_plans")
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
        .update({ recipe_ids: (existingPlan.recipe_ids as string[]).filter((id) => id !== recipeId) })
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)

      if (error) throw error
      return { weekDate, recipeId }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { weekDate, recipeId } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate, isGuest],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest],
        (old) => {
          if (!old) return old
          return {
            ...old,
            recipe_ids: old.recipe_ids.filter((id) => id !== recipeId),
          }
        }
      )

      return { previousPlan }
    },

    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousPlan) {
        queryClient.setQueryData(
          [...WEEKLY_PLANS_KEY, variables.weekDate, isGuest],
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeId: string) => {
      if (isGuest) {
        // For guest mode, the optimistic update handles the cache update
        return { recipeId }
      }

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
      const previousHistory = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, isGuest])

      // Optimistically update cache
      queryClient.setQueryData<RecipeHistory[]>(
        [...HISTORY_KEY, isGuest],
        (old) => {
          const existing = old || []
          return [
            { id: Date.now(), user_id: isGuest ? "guest" : user?.id || "", recipe_id: recipeId, date_made: new Date().toISOString() },
            ...existing
          ]
        }
      )

      return { previousHistory }
    },
    onError: (err, recipeId, context) => {
      // Rollback on error
      if (context?.previousHistory !== undefined) {
        queryClient.setQueryData([...HISTORY_KEY, isGuest], context.previousHistory)
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (recipeId: string) => {
      if (isGuest) {
        // For guest mode, the optimistic update handles the cache update
        return { recipeId }
      }

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
      const previousHistory = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, isGuest])

      // Optimistically update cache - remove most recent entry for this recipe
      queryClient.setQueryData<RecipeHistory[]>(
        [...HISTORY_KEY, isGuest],
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
        queryClient.setQueryData([...HISTORY_KEY, isGuest], context.previousHistory)
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ recipeId, weekDate, isMadeForWeek }: {
      recipeId: string; weekDate: string; isMadeForWeek: boolean
    }) => {
      if (isGuest) {
        const plan = getGuestPlan(queryClient, weekDate)
        if (!plan) throw new Error("Plan not found")

        if (isMadeForWeek) {
          // Undo
          setGuestPlan(queryClient, weekDate, {
            ...plan,
            made_recipe_ids: ((plan as { made_recipe_ids?: string[] } | null)?.made_recipe_ids || []).filter((id) => id !== recipeId),
          })
          const history = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, true]) || []
          queryClient.setQueryData([...HISTORY_KEY, true], history.slice(0, -1))
          return { action: "unmarked", recipeId, weekDate }
        } else {
          // Mark made
          setGuestPlan(queryClient, weekDate, {
            ...plan,
            made_recipe_ids: [...((plan as { made_recipe_ids?: string[] } | null)?.made_recipe_ids || []), recipeId],
          })
          const history = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, true]) || []
          queryClient.setQueryData([...HISTORY_KEY, true], [
            ...history,
            { id: Date.now(), user_id: "guest", recipe_id: recipeId, date_made: new Date().toISOString() }
          ])
          return { action: "marked", recipeId, weekDate }
        }
      }

      const supabase = getSupabase()

      if (isMadeForWeek) {
        const { data: recentHistory, error: historyError } = await supabase
          .from("recipe_history")
          .select("id")
          .eq("user_id", user!.id)
          .eq("recipe_id", recipeId)
          .order("date_made", { ascending: false })
          .limit(1)
          .single()

        if (historyError && historyError.code !== "PGRST116") throw historyError

        if (recentHistory) {
          const { error: deleteError } = await supabase
            .from("recipe_history")
            .delete()
            .eq("user_id", user!.id)
            .eq("id", (recentHistory as { id: number }).id)
          if (deleteError) throw deleteError
        }

        const { data: plan, error: planError } = await supabase
          .from("weekly_plans")
          .select("made_recipe_ids")
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
          .single()

        if (planError) throw planError

        const typedPlan = plan as { made_recipe_ids?: string[] } | null
        const { error: updateError } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ made_recipe_ids: (typedPlan?.made_recipe_ids || []).filter((id) => id !== recipeId) })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)

        if (updateError) throw updateError
        return { action: "unmarked", recipeId, weekDate }
      } else {
        const { error: insertError } = await supabase
          .from("recipe_history")
          // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        .insert({ user_id: user!.id, recipe_id: recipeId, date_made: new Date().toISOString() })

        if (insertError) throw insertError

        const { data: plan, error: planError } = await supabase
          .from("weekly_plans")
          .select("made_recipe_ids")
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
          .single()

        if (planError) throw planError

        const { error: updateError } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({ made_recipe_ids: [...(typedPlan?.made_recipe_ids || []), recipeId] })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)

        if (updateError) throw updateError
        return { action: "marked", recipeId, weekDate }
      }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { recipeId, weekDate, isMadeForWeek } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate, isGuest],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest],
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
          [...WEEKLY_PLANS_KEY, variables.weekDate, isGuest],
          context.previousPlan
        )
      }
    },

    onSettled: (_, __, variables) => {
      // Always refetch to ensure consistency
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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async ({ weekDate, dayAssignments }: { weekDate: string; dayAssignments: Record<string, number> }) => {
      if (isGuest) {
        const existing = getGuestPlan(queryClient, weekDate)
        const plan: WeeklyPlan = {
          user_id: "guest",
          week_date: weekDate,
          recipe_ids: existing?.recipe_ids || [],
          made_recipe_ids: existing?.made_recipe_ids || [],
          day_assignments: dayAssignments,
          scale: existing?.scale || 1.0,
          generated_at: existing?.generated_at || new Date().toISOString(),
        }
        setGuestPlan(queryClient, weekDate, plan)
        return { weekDate, dayAssignments }
      }

      const supabase = getSupabase()

      // Check if plan already exists
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user!.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from("weekly_plans")
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          .update({
            day_assignments: dayAssignments,
          })
          .eq("user_id", user!.id)
          .eq("week_date", weekDate)
        if (error) throw error
      } else {
        // Insert new plan with day assignments
        // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
        const { error } = await supabase.from("weekly_plans").insert({
          user_id: user!.id,
          week_date: weekDate,
          recipe_ids: [],
          day_assignments: dayAssignments,
          scale: 1.0,
          generated_at: new Date().toISOString(),
        })
        if (error) throw error
      }

      return { weekDate, dayAssignments }
    },

    // Optimistic update
    onMutate: async (variables) => {
      const { weekDate, dayAssignments } = variables

      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: [...WEEKLY_PLANS_KEY, weekDate, isGuest],
      })

      // Snapshot previous value for rollback
      const previousPlan = queryClient.getQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest]
      )

      // Optimistically update cache
      queryClient.setQueryData<WeeklyPlan>(
        [...WEEKLY_PLANS_KEY, weekDate, isGuest],
        (old) => {
          if (!old) {
            // Create a new plan if none exists
            return {
              user_id: isGuest ? "guest" : "",
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
          [...WEEKLY_PLANS_KEY, variables.weekDate, isGuest],
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

export function getWeekStartDate(date: Date, weekStartDay: number = 1): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day < weekStartDay ? 7 : 0) + day - weekStartDay
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split("T")[0]
}

export function navigateWeek(currentWeekDate: string, direction: "prev" | "next"): string {
  const date = new Date(currentWeekDate)
  date.setDate(date.getDate() + (direction === "next" ? 7 : -7))
  return date.toISOString().split("T")[0]
}
