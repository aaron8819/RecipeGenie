"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { Recipe, RecipeHistory, WeeklyPlan, UserConfig } from "@/types/database"
import { generateMealPlan, getSwapRecipe } from "@/lib/meal-planner"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultRecipes, getDefaultConfig } from "@/lib/guest-storage"

const WEEKLY_PLANS_KEY = ["weekly_plans"]
const HISTORY_KEY = ["recipe_history"]
const CONFIG_KEY = ["user_config"]
const RECIPES_KEY = ["recipes"]

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

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
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      if (error) throw error
      return data as WeeklyPlan || emptyPlan
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
          .eq("user_id", user?.id)
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
        .eq("user_id", user?.id)
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
        .update(updates)
        .eq("user_id", user?.id)
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

        const plan: WeeklyPlan = {
          user_id: "guest",
          week_date: weekDate,
          recipe_ids: result.recipes.map((r) => r.id),
          made_recipe_ids: [],
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
        .eq("user_id", user?.id)
      if (recipesError) throw recipesError

      const { data: history, error: historyError } = await supabase
        .from("recipe_history")
        .select("*")
        .eq("user_id", user?.id)
      if (historyError) throw historyError

      const { data: config } = await supabase
        .from("user_config")
        .select("history_exclusion_days")
        .single()

      const result = generateMealPlan(
        recipes as Recipe[],
        history as RecipeHistory[],
        selection,
        config?.history_exclusion_days || 7
      )

      // Check if plan already exists
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan - preserve made_recipe_ids but reset recipe_ids
        const { error: saveError } = await supabase
          .from("weekly_plans")
          .update({
            recipe_ids: result.recipes.map((r) => r.id),
            made_recipe_ids: (existingPlan as WeeklyPlan).made_recipe_ids || [],
            scale: 1.0,
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)
        if (saveError) throw saveError
      } else {
        // Insert new plan
        const { error: saveError } = await supabase.from("weekly_plans").insert({
          user_id: user?.id,
          week_date: weekDate,
          recipe_ids: result.recipes.map((r) => r.id),
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

        const newRecipeIds = plan.recipe_ids.map((id) => id === oldRecipeId ? newRecipe.id : id)
        setGuestPlan(queryClient, weekDate, { ...plan, recipe_ids: newRecipeIds })
        return newRecipe
      }

      const supabase = getSupabase()
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")
        .eq("user_id", user?.id)
      if (recipesError) throw recipesError

      const newRecipe = getSwapRecipe(recipes as Recipe[], category, excludeIds)
      if (!newRecipe) throw new Error(`No more ${category} recipes available`)

      const { data: plan, error: planError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .single()

      if (planError) throw planError

      const newRecipeIds = (plan.recipe_ids as string[]).map((id) => id === oldRecipeId ? newRecipe.id : id)

      const { error: saveError } = await supabase
        .from("weekly_plans")
        .update({ recipe_ids: newRecipeIds })
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)

      if (saveError) throw saveError
      return newRecipe
    },
    onSuccess: (_, variables) => {
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
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from("weekly_plans")
          .update({
            recipe_ids: recipeIds,
            scale: scale || 1.0,
            made_recipe_ids: (existingPlan as WeeklyPlan).made_recipe_ids || [],
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)
        if (error) throw error
      } else {
        // Insert new plan
        const { error } = await supabase.from("weekly_plans").insert({
          user_id: user?.id,
          week_date: weekDate,
          recipe_ids: recipeIds,
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
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .maybeSingle()

      const currentIds = (existingPlan?.recipe_ids as string[]) || []
      if (currentIds.includes(recipeId)) {
        throw new Error("Recipe is already in this week's meal plan")
      }

      // Use explicit update/insert pattern since unique index isn't auto-detected by upsert
      if (existingPlan) {
        // Update existing plan
        const { error } = await supabase
          .from("weekly_plans")
          .update({
            recipe_ids: [...currentIds, recipeId],
            scale: (existingPlan as WeeklyPlan).scale || 1.0,
            made_recipe_ids: (existingPlan as WeeklyPlan).made_recipe_ids || [],
            generated_at: new Date().toISOString(),
          })
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)
        if (error) throw error
      } else {
        // Insert new plan
        const { error } = await supabase.from("weekly_plans").insert({
          user_id: user?.id,
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
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)
        .single()

      if (fetchError) throw fetchError

      const { error } = await supabase
        .from("weekly_plans")
        .update({ recipe_ids: (existingPlan.recipe_ids as string[]).filter((id) => id !== recipeId) })
        .eq("user_id", user?.id)
        .eq("week_date", weekDate)

      if (error) throw error
      return { weekDate, recipeId }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate] })
      queryClient.invalidateQueries({ queryKey: RECIPES_KEY })
    },
  })
}

/**
 * Hook to toggle recipe "made" status for a specific week
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
            made_recipe_ids: plan.made_recipe_ids.filter((id) => id !== recipeId),
          })
          const history = queryClient.getQueryData<RecipeHistory[]>([...HISTORY_KEY, true]) || []
          queryClient.setQueryData([...HISTORY_KEY, true], history.slice(0, -1))
          return { action: "unmarked", recipeId, weekDate }
        } else {
          // Mark made
          setGuestPlan(queryClient, weekDate, {
            ...plan,
            made_recipe_ids: [...plan.made_recipe_ids, recipeId],
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
          .eq("user_id", user?.id)
          .eq("recipe_id", recipeId)
          .order("date_made", { ascending: false })
          .limit(1)
          .single()

        if (historyError && historyError.code !== "PGRST116") throw historyError

        if (recentHistory) {
          const { error: deleteError } = await supabase
            .from("recipe_history")
            .delete()
            .eq("user_id", user?.id)
            .eq("id", recentHistory.id)
          if (deleteError) throw deleteError
        }

        const { data: plan, error: planError } = await supabase
          .from("weekly_plans")
          .select("made_recipe_ids")
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)
          .single()

        if (planError) throw planError

        const { error: updateError } = await supabase
          .from("weekly_plans")
          .update({ made_recipe_ids: ((plan.made_recipe_ids as string[]) || []).filter((id) => id !== recipeId) })
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)

        if (updateError) throw updateError
        return { action: "unmarked", recipeId, weekDate }
      } else {
        const { error: insertError } = await supabase
          .from("recipe_history")
          .insert({ user_id: user?.id, recipe_id: recipeId, date_made: new Date().toISOString() })

        if (insertError) throw insertError

        const { data: plan, error: planError } = await supabase
          .from("weekly_plans")
          .select("made_recipe_ids")
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)
          .single()

        if (planError) throw planError

        const { error: updateError } = await supabase
          .from("weekly_plans")
          .update({ made_recipe_ids: [...((plan.made_recipe_ids as string[]) || []), recipeId] })
          .eq("user_id", user?.id)
          .eq("week_date", weekDate)

        if (updateError) throw updateError
        return { action: "marked", recipeId, weekDate }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
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
