import type { Recipe, RecipeShareSnapshot } from '@/types/database';

export function buildRecipeShareSnapshot(recipe: Recipe): RecipeShareSnapshot {
  return {
    name: recipe.name,
    category: recipe.category,
    servings: recipe.servings,
    tags: recipe.tags ?? [],
    ingredients: recipe.ingredients ?? [],
    instructions: recipe.instructions ?? [],
    image_url: recipe.image_url ?? null,
  };
}

export function getShareErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Unable to complete recipe sharing request.';
}
