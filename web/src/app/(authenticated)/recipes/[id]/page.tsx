import { RecipeDetailPage } from "@/components/recipes/recipe-detail-page"
import { normalizeRecipeDetailSource } from "@/lib/recipe-detail-navigation"

export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const rawSource = Array.isArray(query.from) ? query.from[0] : query.from

  return (
    <RecipeDetailPage
      recipeId={id}
      returnSource={normalizeRecipeDetailSource(rawSource)}
    />
  )
}
