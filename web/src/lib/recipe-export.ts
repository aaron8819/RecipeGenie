import type { CanonicalIngredient, Recipe } from '@/types/database';
import { flattenRecipeIngredients } from '@/lib/recipe-structure';
import { getIngredientDisplayUnit } from '@/lib/ingredient-units';
import {
  getAuthoredYieldText,
  resolveIngredientQuantity,
} from '@/lib/recipe-quantity';

/**
 * Convert an ingredient to a display string.
 * Uses originalText if available, otherwise reconstructs.
 */
function ingredientToString(ing: CanonicalIngredient): string {
  const resolved = resolveIngredientQuantity(ing);
  const parts: string[] = [];
  if (resolved.quantity) parts.push(resolved.quantity.authored);
  else if (ing.amount != null) parts.push(String(ing.amount));
  const displayUnit = getIngredientDisplayUnit(
    resolved.authoredUnit || ing.unit
  );
  if (displayUnit) parts.push(displayUnit);
  parts.push(ing.item);
  const base = parts.join(' ');
  return ing.modifier ? `${base}, ${ing.modifier}` : base;
}

/**
 * Convert recipes to Schema.org/Recipe JSON-LD format.
 */
export function recipesToSchemaOrg(
  recipes: Recipe[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any>[] {
  return recipes.map((recipe) => ({
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.name,
    recipeCategory: recipe.category,
    recipeYield: getAuthoredYieldText(
      recipe.yield_metadata,
      recipe.servings
    ),
    ...(recipe.image_url
      ? { image: recipe.image_url }
      : {}),
    ...(recipe.tags && recipe.tags.length > 0
      ? { keywords: recipe.tags.join(', ') }
      : {}),
    ...(recipe.prep_time_minutes
      ? { prepTime: minutesToDuration(recipe.prep_time_minutes) }
      : {}),
    ...(recipe.cook_time_minutes
      ? { cookTime: minutesToDuration(recipe.cook_time_minutes) }
      : {}),
    ...(recipe.total_time_minutes
      ? { totalTime: minutesToDuration(recipe.total_time_minutes) }
      : {}),
    recipeIngredient: flattenRecipeIngredients(
      recipe.ingredientSections
    ).map(ingredientToString),
    recipeInstructions: recipeInstructionsToSchemaOrg(recipe),
    recipeGenieData: {
      version: 2,
      servings: recipe.servings,
      yieldMetadata: recipe.yield_metadata ?? null,
      ingredientSections: recipe.ingredientSections,
      instructionSections: recipe.instructionSections,
    },
    dateCreated: recipe.created_at,
    dateModified: recipe.updated_at,
  }));
}

function recipeInstructionsToSchemaOrg(recipe: Recipe) {
  let position = 0;
  const toSteps = (steps: string[]) => steps.map((step) => ({
    '@type': 'HowToStep',
    position: ++position,
    text: step,
  }));

  if (
    recipe.instructionSections.length === 1 &&
    recipe.instructionSections[0].label === null
  ) {
    return toSteps(recipe.instructionSections[0].steps);
  }

  return recipe.instructionSections.map((section) => ({
    '@type': 'HowToSection',
    ...(section.label ? { name: section.label } : {}),
    itemListElement: toSteps(section.steps),
  }));
}

function minutesToDuration(minutes: number): string {
  if (minutes <= 0) return 'PT0M';

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hoursPart = hours > 0 ? `${hours}H` : '';
  const minutesPart = remainder > 0 ? `${remainder}M` : '';
  return `PT${hoursPart}${minutesPart || (hoursPart ? '' : '0M')}`;
}

/**
 * Trigger a browser download of recipes as JSON-LD.
 */
export function downloadRecipesAsJson(
  recipes: Recipe[]
): void {
  const data = recipesToSchemaOrg(recipes);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], {
    type: 'application/ld+json',
  });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10);
  const filename =
    `recipe-genie-export-${today}.json`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
