import { describe, it, expect } from 'vitest';
import { recipesToSchemaOrg } from '../recipe-export';
import type { Recipe } from '@/types/database';

function makeRecipe(
  overrides: Partial<Recipe> = {}
): Recipe {
  return {
    id: 'test-1',
    user_id: 'user-1',
    name: 'Test Recipe',
    category: 'dinner',
    servings: 4,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    favorite: false,
    tags: ['quick', 'easy'],
    ingredients: [
      {
        item: 'flour',
        amount: 2,
        unit: 'cups',
        originalText: '2 cups flour',
      },
      {
        item: 'sugar',
        amount: 1,
        unit: 'tbsp',
      },
    ],
    instructions: [
      'Mix ingredients.',
      'Bake at 350F.',
    ],
    notes: [],
    instruction_groups: null,
    image_url: 'https://example.com/img.jpg',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('recipesToSchemaOrg', () => {
  it('should produce valid Schema.org JSON-LD', () => {
    const result = recipesToSchemaOrg([makeRecipe()]);
    expect(result).toHaveLength(1);

    const r = result[0];
    expect(r['@context']).toBe('https://schema.org');
    expect(r['@type']).toBe('Recipe');
    expect(r.name).toBe('Test Recipe');
    expect(r.recipeCategory).toBe('dinner');
    expect(r.recipeYield).toBe('4 servings');
    expect(r.image)
      .toBe('https://example.com/img.jpg');
    expect(r.keywords).toBe('quick, easy');
  });

  it('should use originalText when available', () => {
    const result = recipesToSchemaOrg([makeRecipe()]);
    const ingredients = result[0].recipeIngredient;
    expect(ingredients[0]).toBe('2 cups flour');
    // Second ingredient has no originalText
    expect(ingredients[1]).toBe('1 tbsp sugar');
  });

  it('should produce HowToStep instructions', () => {
    const result = recipesToSchemaOrg([makeRecipe()]);
    const steps = result[0].recipeInstructions;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toEqual({
      '@type': 'HowToStep',
      position: 1,
      text: 'Mix ingredients.',
    });
  });

  it('should omit image when not present', () => {
    const result = recipesToSchemaOrg([
      makeRecipe({ image_url: null }),
    ]);
    expect(result[0].image).toBeUndefined();
  });

  it('should omit keywords when no tags', () => {
    const result = recipesToSchemaOrg([
      makeRecipe({ tags: [] }),
    ]);
    expect(result[0].keywords).toBeUndefined();
  });

  it('should handle recipe with modifier', () => {
    const result = recipesToSchemaOrg([
      makeRecipe({
        ingredients: [
          {
            item: 'onion',
            amount: 1,
            unit: 'count',
            modifier: 'diced',
          },
        ],
      }),
    ]);
    expect(result[0].recipeIngredient[0])
      .toBe('1 onion, diced');
  });

  it('should suppress whole/count units while preserving measured units', () => {
    const result = recipesToSchemaOrg([
      makeRecipe({
        ingredients: [
          { item: 'onion', amount: 1, unit: 'count' },
          { item: 'rice', amount: 1, unit: 'cup' },
        ],
      }),
    ]);

    expect(result[0].recipeIngredient).toEqual([
      '1 onion',
      '1 cup rice',
    ]);
  });

  it('should include ISO-8601 duration fields when recipe times are present', () => {
    const result = recipesToSchemaOrg([
      makeRecipe({
        prep_time_minutes: 10,
        cook_time_minutes: 25,
        total_time_minutes: 35,
      }),
    ]);

    expect(result[0].prepTime).toBe('PT10M');
    expect(result[0].cookTime).toBe('PT25M');
    expect(result[0].totalTime).toBe('PT35M');
  });
});
