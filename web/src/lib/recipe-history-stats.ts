export interface RecipeHistoryStatsRow {
  recipe_id: string
  last_made: string
  times_made: number
}

export interface RecipeStats {
  lastMade: string | null
  timesMade: number
}

/**
 * Convert aggregated history rows into the UI lookup used by recipe cards/details.
 */
export function getRecipeStatsMap(
  stats: RecipeHistoryStatsRow[] | undefined
): Map<string, RecipeStats> {
  const statsMap = new Map<string, RecipeStats>()
  if (!stats) return statsMap

  for (const entry of stats) {
    statsMap.set(entry.recipe_id, {
      lastMade: entry.last_made,
      timesMade: entry.times_made,
    })
  }

  return statsMap
}
