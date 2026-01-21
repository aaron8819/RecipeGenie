/**
 * Meal planning business logic
 * Ported from app.py:574-627
 */

import type { Recipe, RecipeHistory } from "@/types/database"

export interface MealPlanResult {
  recipes: Recipe[]
  errors: string[] | null
}

/**
 * Generate a random meal plan based on category requirements.
 * Excludes recently-made recipes within the exclusion window.
 *
 * @param allRecipes - All available recipes
 * @param history - Recipe history entries
 * @param selection - Map of category to count (e.g., { chicken: 2, turkey: 1 })
 * @param historyExclusionDays - Number of days to exclude recent recipes
 */
export function generateMealPlan(
  allRecipes: Recipe[],
  history: RecipeHistory[],
  selection: Record<string, number>,
  historyExclusionDays: number = 10
): MealPlanResult {
  // Find recipes made within the exclusion window to exclude
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - historyExclusionDays)

  const recentIds = new Set<string>()
  for (const h of history) {
    try {
      const dateMade = new Date(h.date_made)
      if (dateMade > cutoffDate) {
        recentIds.add(h.recipe_id)
      }
    } catch {
      // Skip invalid dates
      continue
    }
  }

  const selectedRecipes: Recipe[] = []
  const errors: string[] = []

  for (const [category, count] of Object.entries(selection)) {
    if (count <= 0) continue

    // Get all recipes in this category, excluding recently made
    const categoryRecipes = allRecipes.filter(
      (r) => r.category === category && !recentIds.has(r.id)
    )

    if (categoryRecipes.length < count) {
      // Fall back to including recent recipes if not enough available
      const allCategory = allRecipes.filter((r) => r.category === category)

      if (allCategory.length < count) {
        errors.push(
          `Not enough ${category} recipes. Need ${count}, have ${allCategory.length}.`
        )
        selectedRecipes.push(...allCategory)
      } else {
        errors.push(
          `Not enough non-recent ${category} recipes. Including some recently made.`
        )
        // First add all non-recent, then fill with recent
        selectedRecipes.push(...categoryRecipes)

        const remaining = count - categoryRecipes.length
        const recentInCategory = allRecipes.filter(
          (r) => r.category === category && recentIds.has(r.id)
        )
        selectedRecipes.push(...shuffleArray(recentInCategory).slice(0, remaining))
      }
    } else {
      // Randomly select the requested number
      selectedRecipes.push(...shuffleArray(categoryRecipes).slice(0, count))
    }
  }

  return {
    recipes: selectedRecipes,
    errors: errors.length > 0 ? errors : null,
  }
}

/**
 * Get a random recipe from a category, excluding specified IDs.
 * Used for swapping a recipe in the meal plan.
 *
 * @param allRecipes - All available recipes
 * @param category - Category to filter by
 * @param excludeIds - Recipe IDs to exclude
 */
export function getSwapRecipe(
  allRecipes: Recipe[],
  category: string,
  excludeIds: string[]
): Recipe | null {
  const excludeSet = new Set(excludeIds)
  const available = allRecipes.filter(
    (r) => r.category === category && !excludeSet.has(r.id)
  )

  if (available.length === 0) {
    return null
  }

  return available[Math.floor(Math.random() * available.length)]
}

/**
 * Auto-assign recipes to days based on placement rules.
 * 
 * @param recipeIds - Array of recipe IDs to assign
 * @param excludedDays - Day indices (0-6) to exclude from placement
 * @param preferredDays - Day indices (0-6) to prefer, or null for no preference
 * @param existingAssignments - Existing recipe_id -> day_index mappings to preserve
 * @returns Map of recipe_id -> day_index (0-6)
 */
export function autoAssignDays(
  recipeIds: string[],
  excludedDays: number[] = [],
  preferredDays: number[] | null = null,
  existingAssignments: Record<string, number> = {}
): Record<string, number> {
  const assignments: Record<string, number> = { ...existingAssignments }
  
  // Get available days (0-6, excluding excluded days)
  const allDays = [0, 1, 2, 3, 4, 5, 6]
  const availableDays = allDays.filter((day) => !excludedDays.includes(day))
  
  if (availableDays.length === 0) {
    // No available days, return existing assignments only
    return assignments
  }
  
  // Separate recipes into already assigned and unassigned
  const unassignedRecipes = recipeIds.filter((id) => assignments[id] === undefined)
  
  if (unassignedRecipes.length === 0) {
    return assignments
  }
  
  // Build day priority list: preferred days first, then other available days
  let dayPriority: number[]
  if (preferredDays && preferredDays.length > 0) {
    // Filter preferred days to only include available days
    const availablePreferred = preferredDays.filter((day) => availableDays.includes(day))
    const otherAvailable = availableDays.filter((day) => !availablePreferred.includes(day))
    dayPriority = [...availablePreferred, ...otherAvailable]
  } else {
    dayPriority = [...availableDays]
  }
  
  // Distribute recipes across days
  // Round-robin through day priority, then cycle if needed
  unassignedRecipes.forEach((recipeId, index) => {
    const dayIndex = dayPriority[index % dayPriority.length]
    assignments[recipeId] = dayIndex
  })
  
  return assignments
}

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
