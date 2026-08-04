import type { Recipe, RecipeShareSnapshot } from '@/types/database';
import { normalizeRecipeShareSnapshot } from './recipe-data-validation';

export function buildRecipeShareSnapshot(recipe: Recipe): RecipeShareSnapshot {
  const snapshot = normalizeRecipeShareSnapshot({
    name: recipe.name,
    category: recipe.category,
    servings: recipe.servings,
    yield_metadata: recipe.yield_metadata ?? null,
    tags: recipe.tags ?? [],
    ingredient_sections: recipe.ingredientSections,
    instruction_sections: recipe.instructionSections,
    image_url: recipe.image_url ?? null,
    prep_time_minutes: recipe.prep_time_minutes ?? null,
    cook_time_minutes: recipe.cook_time_minutes ?? null,
    total_time_minutes: recipe.total_time_minutes ?? null,
    notes: recipe.notes ?? [],
  }, "persist");
  if (!snapshot) {
    throw new Error('Recipe contains invalid structured metadata');
  }
  return snapshot;
}
