export const RECIPE_SORT_OPTIONS = [
  "timesMade",
  "lastMade",
  "name",
  "newest",
] as const

export type RecipeSortOption = (typeof RECIPE_SORT_OPTIONS)[number]
export type RecipeViewMode = "grid" | "list"

export interface RecipeRouteState {
  category: string | null
  favoritesOnly: boolean
  query: string
  sortBy: RecipeSortOption
  tags: string[]
  viewMode: RecipeViewMode | null
}

type RouteSearchParams = Record<string, string | string[] | undefined>

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function boundedValue(
  value: string | undefined,
  maxLength: number
): string | null {
  const normalized = value?.trim()
  return normalized && normalized.length <= maxLength ? normalized : null
}

function parseTags(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const tags = values
    .flatMap((entry) => entry.split(","))
    .map((tag) => boundedValue(tag, 50))
    .filter((tag): tag is string => tag != null)

  return Array.from(new Set(tags)).slice(0, 20)
}

export function parseRecipeRouteState(
  searchParams: RouteSearchParams
): RecipeRouteState {
  const sort = firstValue(searchParams.sort)
  const view = firstValue(searchParams.view)

  return {
    category: boundedValue(firstValue(searchParams.category), 80),
    favoritesOnly: firstValue(searchParams.favorite) === "true",
    query: boundedValue(firstValue(searchParams.q), 200) ?? "",
    sortBy: RECIPE_SORT_OPTIONS.includes(sort as RecipeSortOption)
      ? (sort as RecipeSortOption)
      : "lastMade",
    tags: parseTags(searchParams.tags),
    viewMode: view === "grid" || view === "list" ? view : null,
  }
}

export function buildRecipeRouteHref(state: RecipeRouteState): string {
  const params = new URLSearchParams()
  const query = state.query.trim()

  if (query) params.set("q", query)
  if (state.category) params.set("category", state.category)
  state.tags.forEach((tag) => params.append("tags", tag))
  if (state.favoritesOnly) params.set("favorite", "true")
  if (state.sortBy !== "lastMade") params.set("sort", state.sortBy)
  if (state.viewMode) params.set("view", state.viewMode)

  const queryString = params.toString()
  return `/recipes${queryString ? `?${queryString}` : ""}`
}
