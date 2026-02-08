import { normalizeItemName } from './shopping-list-normalization';
import type { Recipe, Ingredient } from '@/types/database';

export interface RecipeMatch {
  recipe: Recipe;
  matchedIngredients: string[];
  missingIngredients: Ingredient[];
  matchPercentage: number;
  totalIngredients: number;
}

/**
 * Match recipes against pantry items using fuzzy matching.
 * Returns recipes sorted by match percentage (desc),
 * then missing count (asc).
 */
export function matchRecipesToPantry(
  recipes: Recipe[],
  pantryItems: string[]
): RecipeMatch[] {
  if (pantryItems.length === 0) return [];

  const normalizedPantry = pantryItems.map(
    normalizeItemName
  );

  return recipes
    .filter(
      (r) => r.ingredients && r.ingredients.length > 0
    )
    .map((recipe) => {
      const ingredients = recipe.ingredients || [];
      const matched: string[] = [];
      const missing: Ingredient[] = [];

      for (const ing of ingredients) {
        if (
          isIngredientInPantry(ing.item, normalizedPantry)
        ) {
          matched.push(ing.item);
        } else {
          missing.push(ing);
        }
      }

      const total = ingredients.length;
      const pct =
        total > 0
          ? Math.round((matched.length / total) * 100)
          : 0;

      return {
        recipe,
        matchedIngredients: matched,
        missingIngredients: missing,
        matchPercentage: pct,
        totalIngredients: total,
      };
    })
    .filter((m) => m.matchPercentage > 0)
    .sort((a, b) => {
      if (b.matchPercentage !== a.matchPercentage) {
        return b.matchPercentage - a.matchPercentage;
      }
      return (
        a.missingIngredients.length -
        b.missingIngredients.length
      );
    });
}

/**
 * Check if an ingredient name matches any pantry item.
 * Priority order:
 * 1. Exact match
 * 2. Pantry item found within ingredient name
 * 3. Ingredient name found within pantry item
 * 4. Significant word (3+ chars) match
 */
function isIngredientInPantry(
  ingredientName: string,
  normalizedPantry: string[]
): boolean {
  const norm = normalizeItemName(ingredientName);
  if (!norm) return false;

  for (const pantryItem of normalizedPantry) {
    // 1. Exact match
    if (norm === pantryItem) return true;

    // 2. Pantry item found within ingredient
    // e.g., pantry "garlic" matches "garlic cloves"
    if (norm.includes(pantryItem)) return true;

    // 3. Ingredient found within pantry item
    // e.g., ingredient "tomato" matches pantry "cherry tomatoes"
    if (pantryItem.includes(norm)) return true;
  }

  // 4. Word-level match (3+ char words)
  const words = norm
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  for (const word of words) {
    for (const pantryItem of normalizedPantry) {
      if (pantryItem === word) return true;
      if (pantryItem.includes(word)) return true;
    }
  }

  return false;
}
