export type RecipeDetailSource = "recipes" | "planner" | "shopping"

interface RecipeDetailRouter {
  back: () => void
  push: (href: string) => void
  replace: (href: string) => void
}

export function normalizeRecipeDetailSource(
  source: string | undefined
): RecipeDetailSource | null {
  return source === "recipes" ||
    source === "planner" ||
    source === "shopping"
    ? source
    : null
}

export function buildRecipeDetailHref(
  recipeId: string,
  source?: RecipeDetailSource
): string {
  const params = new URLSearchParams()
  if (source) params.set("from", source)

  const query = params.toString()
  return `/recipes/${encodeURIComponent(recipeId)}${query ? `?${query}` : ""}`
}

export function openRecipeDetail(
  router: RecipeDetailRouter,
  recipeId: string,
  source: RecipeDetailSource
) {
  router.push(buildRecipeDetailHref(recipeId, source))
}

export function returnFromRecipeDetail(
  router: RecipeDetailRouter,
  source: RecipeDetailSource | null
) {
  if (source) {
    router.back()
    return
  }

  router.replace("/recipes")
}
