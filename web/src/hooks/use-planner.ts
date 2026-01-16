"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { Recipe, RecipeHistory, WeeklyPlan, UserConfig } from "@/types/database"
import { generateMealPlan, getSwapRecipe } from "@/lib/meal-planner"

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

/**
 * Hook to fetch weekly plan for a specific week
 */
export function useWeeklyPlan(weekDate: string) {
  return useQuery({
    queryKey: [...WEEKLY_PLANS_KEY, weekDate],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("weekly_plans")
        .select("*")
        .eq("week_date", weekDate)
        .maybeSingle()

      if (error) throw error

      // If no plan exists, return empty plan
      if (!data) {
        return {
          week_date: weekDate,
          recipe_ids: [] as string[],
          scale: 1.0,
          generated_at: "",
        } as WeeklyPlan
      }

      return data as WeeklyPlan
    },
  })
}

/**
 * Hook to fetch all recipes for a weekly plan
 */
export function useWeeklyPlanRecipes(recipeIds: string[]) {
  return useQuery({
    queryKey: [...RECIPES_KEY, "weekly", recipeIds],
    queryFn: async () => {
      if (recipeIds.length === 0) return []

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipes")
        .select("*")
        .in("id", recipeIds)

      if (error) throw error
      return data as Recipe[]
    },
    enabled: recipeIds.length > 0,
  })
}

/**
 * Hook to fetch recipe history
 */
export function useRecipeHistory() {
  return useQuery({
    queryKey: HISTORY_KEY,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("recipe_history")
        .select("*")
        .order("date_made", { ascending: false })

      if (error) throw error
      return data as RecipeHistory[]
    },
  })
}

/**
 * Hook to fetch user config
 */
export function useUserConfig() {
  return useQuery({
    queryKey: CONFIG_KEY,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("*")
        .eq("id", 1)
        .single()

      if (error) {
        // Return defaults
        return {
          id: 1,
          categories: ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"],
          default_selection: { chicken: 2, turkey: 1, steak: 1 },
          excluded_keywords: [],
          history_exclusion_days: 10,
          week_start_day: 1,
        } as UserConfig
      }
      return data as UserConfig
    },
  })
}

/**
 * Hook to generate a new meal plan
 */
export function useGenerateMealPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      weekDate,
      selection,
    }: {
      weekDate: string
      selection: Record<string, number>
    }) => {
      const supabase = getSupabase()

      // Fetch all recipes
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")

      if (recipesError) throw recipesError

      // Fetch history
      const { data: history, error: historyError } = await supabase
        .from("recipe_history")
        .select("*")

      if (historyError) throw historyError

      // Fetch config for history exclusion days
      const { data: config } = await supabase
        .from("user_config")
        .select("history_exclusion_days")
        .eq("id", 1)
        .single()

      const historyExclusionDays = config?.history_exclusion_days || 7

      // Generate plan
      const result = generateMealPlan(
        recipes as Recipe[],
        history as RecipeHistory[],
        selection,
        historyExclusionDays
      )

      // Save the plan
      const planData = {
        week_date: weekDate,
        recipe_ids: result.recipes.map((r) => r.id),
        scale: 1.0,
        generated_at: new Date().toISOString(),
      }

      const { error: saveError } = await supabase
        .from("weekly_plans")
        .upsert(planData)

      if (saveError) throw saveError

      return { ...result, weekDate }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate],
      })
    },
  })
}

/**
 * Hook to swap a recipe in the meal plan
 */
export function useSwapRecipe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      weekDate,
      oldRecipeId,
      category,
      excludeIds,
    }: {
      weekDate: string
      oldRecipeId: string
      category: string
      excludeIds: string[]
    }) => {
      const supabase = getSupabase()

      // Fetch all recipes
      const { data: recipes, error: recipesError } = await supabase
        .from("recipes")
        .select("*")

      if (recipesError) throw recipesError

      // Get a swap recipe
      const newRecipe = getSwapRecipe(recipes as Recipe[], category, excludeIds)

      if (!newRecipe) {
        throw new Error(`No more ${category} recipes available`)
      }

      // Get current plan
      const { data: plan, error: planError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("week_date", weekDate)
        .single()

      if (planError) throw planError

      // Update recipe_ids
      const newRecipeIds = (plan.recipe_ids as string[]).map((id: string) =>
        id === oldRecipeId ? newRecipe.id : id
      )

      // Save updated plan
      const { error: saveError } = await supabase
        .from("weekly_plans")
        .update({ recipe_ids: newRecipeIds })
        .eq("week_date", weekDate)

      if (saveError) throw saveError

      return newRecipe
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate],
      })
      queryClient.invalidateQueries({
        queryKey: RECIPES_KEY,
      })
    },
  })
}

/**
 * Hook to save weekly plan
 */
export function useSaveWeeklyPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      weekDate,
      recipeIds,
      scale,
    }: {
      weekDate: string
      recipeIds: string[]
      scale?: number
    }) => {
      const supabase = getSupabase()

      const { error } = await supabase.from("weekly_plans").upsert({
        week_date: weekDate,
        recipe_ids: recipeIds,
        scale: scale || 1.0,
        generated_at: new Date().toISOString(),
      })

      if (error) throw error
      return { weekDate, recipeIds }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate],
      })
    },
  })
}

/**
 * Hook to add a recipe to an existing (or new) weekly plan
 */
export function useAddRecipeToPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      weekDate,
      recipeId,
    }: {
      weekDate: string
      recipeId: string
    }) => {
      const supabase = getSupabase()

      // Fetch existing plan for the week (if any)
      const { data: existingPlan } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("week_date", weekDate)
        .maybeSingle()

      // Get current recipe_ids or start with empty array
      const currentIds = (existingPlan?.recipe_ids as string[]) || []

      // Check if recipe is already in the plan
      if (currentIds.includes(recipeId)) {
        throw new Error("Recipe is already in this week's meal plan")
      }

      // Append the new recipe
      const newRecipeIds = [...currentIds, recipeId]

      // Upsert the plan
      const { error } = await supabase.from("weekly_plans").upsert({
        week_date: weekDate,
        recipe_ids: newRecipeIds,
        scale: 1.0,
        generated_at: new Date().toISOString(),
      })

      if (error) throw error
      return { weekDate, recipeId }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate],
      })
    },
  })
}

/**
 * Hook to remove a recipe from the weekly plan
 */
export function useRemoveRecipeFromPlan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      weekDate,
      recipeId,
    }: {
      weekDate: string
      recipeId: string
    }) => {
      const supabase = getSupabase()

      // Fetch existing plan for the week
      const { data: existingPlan, error: fetchError } = await supabase
        .from("weekly_plans")
        .select("recipe_ids")
        .eq("week_date", weekDate)
        .single()

      if (fetchError) throw fetchError

      // Remove the recipe from the list
      const currentIds = (existingPlan?.recipe_ids as string[]) || []
      const newRecipeIds = currentIds.filter((id) => id !== recipeId)

      // Update the plan
      const { error } = await supabase
        .from("weekly_plans")
        .update({ recipe_ids: newRecipeIds })
        .eq("week_date", weekDate)

      if (error) throw error
      return { weekDate, recipeId }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...WEEKLY_PLANS_KEY, variables.weekDate],
      })
      queryClient.invalidateQueries({
        queryKey: RECIPES_KEY,
      })
    },
  })
}

/**
 * Hook to add recipe to history (mark as made)
 */
export function useMarkRecipeMade() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (recipeId: string) => {
      const supabase = getSupabase()

      const { data, error } = await supabase
        .from("recipe_history")
        .insert({
          recipe_id: recipeId,
          date_made: new Date().toISOString(),
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HISTORY_KEY })
    },
  })
}

/**
 * Get the start of week date (Monday) for a given date
 */
export function getWeekStartDate(date: Date, weekStartDay: number = 1): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day < weekStartDay ? 7 : 0) + day - weekStartDay
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split("T")[0]
}

/**
 * Navigate to previous/next week
 */
export function navigateWeek(currentWeekDate: string, direction: "prev" | "next"): string {
  const date = new Date(currentWeekDate)
  date.setDate(date.getDate() + (direction === "next" ? 7 : -7))
  return date.toISOString().split("T")[0]
}
