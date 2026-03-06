import { getUnassignedDayOfWeek, dayIndexToDayOfWeek } from "@/lib/planner-utils"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import type { PlanTemplate, Recipe } from "@/types/database"
import { isDateInWeekRange } from "./meal-planner.utils"

export type PlannerProgress = {
  made: number
  total: number
  percentage: number
}

export type PlannerActiveRecipeOverlay = {
  recipe: Recipe
  imageUrl: string | null
  unoptimized: boolean
} | null

export type FilteredTemplateLoad = {
  recipeIds: string[]
  missingCount: number
  dayAssignments: Record<string, number> | null
  categorySelection: Record<string, number> | null
}

type RecipeMadeParams = {
  recipeId: string
  currentWeekDate: string
  madeRecipeIds: string[] | null | undefined
  lastMadeMap: ReadonlyMap<string, string>
}

type PlannerProgressParams = {
  recipes: Recipe[] | null | undefined
  currentWeekDate: string
  madeRecipeIds: string[] | null | undefined
  lastMadeMap: ReadonlyMap<string, string>
}

type GroupRecipesByDayParams = {
  recipes: Recipe[] | null | undefined
  recipeDayAssignments: Record<string, number>
  weekDayNumbers: number[]
  unassignedDayPriority: number[]
}

type ActiveRecipeOverlayParams = {
  recipes: Recipe[] | null | undefined
  activeRecipeId: string | null
}

type NormalizeStoredDayAssignmentsParams = {
  storedAssignments: unknown
  currentWeekDate: string
  weekStartDay: number
}

type FilterTemplateLoadParams = {
  template: Pick<PlanTemplate, "recipe_ids" | "day_assignments" | "category_selection">
  existingRecipeIds: ReadonlySet<string>
}

function getWeekAssignments(value: unknown, currentWeekDate: string): Record<string, number> | null {
  if (!value || typeof value !== "object") return null
  const candidate = (value as Record<string, unknown>)[currentWeekDate]
  if (!candidate || typeof candidate !== "object") return null
  return candidate as Record<string, number>
}

export function isRecipeMadeForWeek({
  recipeId,
  currentWeekDate,
  madeRecipeIds,
  lastMadeMap,
}: RecipeMadeParams): boolean {
  const isManuallyMarked = madeRecipeIds?.includes(recipeId) || false
  const lastMade = lastMadeMap.get(recipeId)
  const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
  return isManuallyMarked || isMadeInWeek
}

export function derivePlannerProgress({
  recipes,
  currentWeekDate,
  madeRecipeIds,
  lastMadeMap,
}: PlannerProgressParams): PlannerProgress {
  if (!recipes || recipes.length === 0) {
    return { made: 0, total: 0, percentage: 0 }
  }

  const made = recipes.filter((recipe) =>
    isRecipeMadeForWeek({
      recipeId: recipe.id,
      currentWeekDate,
      madeRecipeIds,
      lastMadeMap,
    })
  ).length

  return {
    made,
    total: recipes.length,
    percentage: Math.round((made / recipes.length) * 100),
  }
}

export function deriveTotalMeals(selection: Record<string, number>): number {
  return Object.values(selection).reduce((sum, count) => sum + count, 0)
}

export function groupRecipesByPlannerDay({
  recipes,
  recipeDayAssignments,
  weekDayNumbers,
  unassignedDayPriority,
}: GroupRecipesByDayParams): Recipe[][] {
  const assignedBuckets = weekDayNumbers.map((): Recipe[] => [])
  const unassignedBuckets = weekDayNumbers.map((): Recipe[] => [])

  if (!recipes || recipes.length === 0) {
    return weekDayNumbers.map(() => [])
  }

  for (const recipe of recipes) {
    const assignedDayOfWeek = recipeDayAssignments[recipe.id]
    const targetDayOfWeek = assignedDayOfWeek ?? getUnassignedDayOfWeek(recipe.id, unassignedDayPriority)
    const bucketIndex = weekDayNumbers.indexOf(targetDayOfWeek)

    if (bucketIndex < 0) continue

    if (assignedDayOfWeek !== undefined) {
      assignedBuckets[bucketIndex].push(recipe)
    } else {
      unassignedBuckets[bucketIndex].push(recipe)
    }
  }

  return weekDayNumbers.map((_, index) => [
    ...assignedBuckets[index],
    ...unassignedBuckets[index],
  ])
}

export function deriveActiveRecipeOverlay({
  recipes,
  activeRecipeId,
}: ActiveRecipeOverlayParams): PlannerActiveRecipeOverlay {
  if (!recipes || !activeRecipeId) return null

  const recipe = recipes.find((candidate) => candidate.id === activeRecipeId)
  if (!recipe) return null

  const imageUrl = getRecipeImageUrl(recipe.image_url)
  return {
    recipe,
    imageUrl,
    unoptimized: imageUrl ? !imageUrl.includes(".supabase.co") : false,
  }
}

export function normalizeStoredDayAssignments({
  storedAssignments,
  currentWeekDate,
  weekStartDay,
}: NormalizeStoredDayAssignmentsParams): Record<string, number> {
  if (!storedAssignments || typeof storedAssignments !== "object") {
    return {}
  }

  const parsed = storedAssignments as {
    version?: unknown
    weeks?: unknown
  }

  if (parsed.version === 2) {
    return getWeekAssignments(parsed.weeks, currentWeekDate) || {}
  }

  const legacyAssignments = getWeekAssignments(storedAssignments, currentWeekDate)
  if (!legacyAssignments) return {}

  return Object.fromEntries(
    Object.entries(legacyAssignments).map(([recipeId, dayIndex]) => [
      recipeId,
      dayIndexToDayOfWeek(dayIndex, weekStartDay),
    ])
  )
}

export function filterTemplateLoadData({
  template,
  existingRecipeIds,
}: FilterTemplateLoadParams): FilteredTemplateLoad {
  const recipeIds = template.recipe_ids.filter((id) => existingRecipeIds.has(id))
  const missingCount = template.recipe_ids.length - recipeIds.length

  const dayAssignments = template.day_assignments
    ? Object.fromEntries(
        Object.entries(template.day_assignments).filter(([id]) => existingRecipeIds.has(id))
      )
    : null

  const categorySelection = template.category_selection
    ? { ...template.category_selection }
    : null

  return {
    recipeIds,
    missingCount,
    dayAssignments,
    categorySelection,
  }
}
