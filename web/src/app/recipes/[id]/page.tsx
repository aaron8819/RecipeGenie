import { RecipeDetailPage } from "@/components/recipes/recipe-detail-page"

interface RecipePageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    origin?: string
  }>
}

export default async function RecipePage({
  params,
  searchParams,
}: RecipePageProps) {
  const [{ id }, { origin }] = await Promise.all([
    params,
    searchParams,
  ])

  return (
    <RecipeDetailPage
      recipeId={id}
      originToken={origin}
    />
  )
}
