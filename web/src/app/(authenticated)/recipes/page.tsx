import { RecipeList } from "@/components/recipes"
import { parseRecipeRouteState } from "@/lib/recipe-route-state"

type RecipesSearchParams = Record<string, string | string[] | undefined>

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<RecipesSearchParams>
}) {
  const routeState = parseRecipeRouteState(await searchParams)

  return (
    <div data-app-screen="recipes">
      <RecipeList routeState={routeState} />
    </div>
  )
}
