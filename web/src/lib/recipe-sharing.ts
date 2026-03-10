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
    prep_time_minutes: recipe.prep_time_minutes ?? null,
    cook_time_minutes: recipe.cook_time_minutes ?? null,
    total_time_minutes: recipe.total_time_minutes ?? null,
    notes: recipe.notes ?? [],
    instruction_groups: recipe.instruction_groups ?? null,
  };
}

export function getShareErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'Unable to complete recipe sharing request.';
}
