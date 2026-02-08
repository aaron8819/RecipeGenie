import type { Recipe, Ingredient } from '@/types/database';

/**
 * Convert an ingredient to a display string.
 * Uses originalText if available, otherwise reconstructs.
 */
function ingredientToString(ing: Ingredient): string {
  if (ing.originalText) return ing.originalText;

  const parts: string[] = [];
  if (ing.amount != null) parts.push(String(ing.amount));
  if (ing.unit) parts.push(ing.unit);
  parts.push(ing.item);
  if (ing.modifier) parts.push(`, ${ing.modifier}`);
  return parts.join(' ');
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
    recipeYield: `${recipe.servings} servings`,
    ...(recipe.image_url
      ? { image: recipe.image_url }
      : {}),
    ...(recipe.tags && recipe.tags.length > 0
      ? { keywords: recipe.tags.join(', ') }
      : {}),
    recipeIngredient: (recipe.ingredients || []).map(
      ingredientToString
    ),
    recipeInstructions: (recipe.instructions || []).map(
      (step, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        text: step,
      })
    ),
    dateCreated: recipe.created_at,
    dateModified: recipe.updated_at,
  }));
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
