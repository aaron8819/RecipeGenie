import { describe, it, expect } from 'vitest';
import { matchRecipesToPantry } from '../pantry-matcher';
import type { Recipe } from '@/types/database';

function makeRecipe(
  name: string,
  ingredients: string[]
): Recipe {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    user_id: 'user-1',
    name,
    category: 'dinner',
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: ingredients.map((item) => ({
      item,
      amount: 1,
      unit: '',
    })),
    instructions: ['Cook it.'],
    image_url: null,
    created_at: '',
    updated_at: '',
  };
}

describe('matchRecipesToPantry', () => {
  const recipes = [
    makeRecipe('Pasta', [
      'pasta',
      'tomato sauce',
      'garlic',
      'olive oil',
    ]),
    makeRecipe('Salad', [
      'lettuce',
      'tomato',
      'cucumber',
      'olive oil',
    ]),
    makeRecipe('Stir Fry', [
      'rice',
      'soy sauce',
      'garlic',
      'broccoli',
      'chicken',
    ]),
  ];

  it('should return empty for empty pantry', () => {
    const result = matchRecipesToPantry(recipes, []);
    expect(result).toHaveLength(0);
  });

  it('should match exact items', () => {
    const result = matchRecipesToPantry(recipes, [
      'pasta',
      'tomato sauce',
      'garlic',
      'olive oil',
    ]);
    expect(result[0].recipe.name).toBe('Pasta');
    expect(result[0].matchPercentage).toBe(100);
    expect(result[0].missingIngredients).toHaveLength(0);
  });

  it('should rank by match percentage', () => {
    const result = matchRecipesToPantry(recipes, [
      'garlic',
      'olive oil',
    ]);
    // All recipes with garlic or olive oil
    // Pasta: 2/4=50%, Salad: 1/4=25%, Stir Fry: 1/5=20%
    expect(result[0].recipe.name).toBe('Pasta');
    expect(result[0].matchPercentage).toBe(50);
  });

  it('should handle substring matching', () => {
    // "garlic" matches "garlic cloves"
    const recipes2 = [
      makeRecipe('Test', ['garlic cloves', 'salt']),
    ];
    const result = matchRecipesToPantry(recipes2, [
      'garlic',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].matchedIngredients).toContain(
      'garlic cloves'
    );
  });

  it('should handle reverse substring matching', () => {
    // ingredient "tomato" matches pantry "cherry tomatoes"
    const recipes2 = [
      makeRecipe('Test', ['tomato', 'salt']),
    ];
    const result = matchRecipesToPantry(recipes2, [
      'cherry tomatoes',
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].matchedIngredients).toContain(
      'tomato'
    );
  });

  it('should be case insensitive', () => {
    const result = matchRecipesToPantry(recipes, [
      'PASTA',
      'Garlic',
    ]);
    expect(result.length).toBeGreaterThan(0);
    const pasta = result.find(
      (r) => r.recipe.name === 'Pasta'
    );
    expect(pasta).toBeDefined();
    expect(pasta!.matchedIngredients).toContain('pasta');
  });

  it('should exclude recipes with 0% match', () => {
    const result = matchRecipesToPantry(recipes, [
      'chocolate',
    ]);
    expect(result).toHaveLength(0);
  });

  it('should report missing ingredients', () => {
    const result = matchRecipesToPantry(recipes, [
      'pasta',
      'garlic',
    ]);
    const pasta = result.find(
      (r) => r.recipe.name === 'Pasta'
    );
    expect(pasta).toBeDefined();
    expect(pasta!.missingIngredients).toHaveLength(2);
    const missingNames = pasta!.missingIngredients.map(
      (i) => i.item
    );
    expect(missingNames).toContain('tomato sauce');
    expect(missingNames).toContain('olive oil');
  });

  it('should skip recipes with no ingredients', () => {
    const noIngRecipes = [
      {
        ...makeRecipe('Empty', []),
        ingredients: [],
      },
    ];
    const result = matchRecipesToPantry(noIngRecipes, [
      'anything',
    ]);
    expect(result).toHaveLength(0);
  });

  it('should handle word-level matching', () => {
    // "oil" (3 chars) in "olive oil" should match
    const recipes2 = [
      makeRecipe('Test', ['sesame oil', 'salt']),
    ];
    const result = matchRecipesToPantry(recipes2, [
      'oil',
    ]);
    expect(result).toHaveLength(1);
  });
});
