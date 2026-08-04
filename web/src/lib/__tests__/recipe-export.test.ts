import { describe, it, expect } from 'vitest';
import { recipesToSchemaOrg } from '../recipe-export';
import type { Recipe } from '@/types/database';
import {
  canonicalizeRecipeFixture,
  type RecipeFixtureInput,
} from '@/test/recipe-fixtures';

function makeRecipe(
  overrides: RecipeFixtureInput = {}
): Recipe {
  return canonicalizeRecipeFixture({
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
    fixtureIngredients: [
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
    fixtureInstructions: [
      'Mix ingredients.',
      'Bake at 350F.',
    ],
    notes: [],
    fixtureInstructionGroups: null,
    image_url: 'https://example.com/img.jpg',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  });
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
        fixtureIngredients: [
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
        fixtureIngredients: [
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

  it('preserves structured quantities and authored yield without trusting stale text', () => {
    const ingredient = {
      item: 'flour',
      amount: 2,
      unit: 'cup',
      originalText: '9 cups stale flour',
      authoredUnit: 'cups',
      quantityV1: {
        version: 1 as const,
        kind: 'exact' as const,
        value: { numerator: '2', denominator: '1' },
        authored: '2',
        lexeme: '2',
        source: 'authored' as const,
      },
    };
    const yieldMetadata = {
      version: 1 as const,
      authoredText: '4–5 servings',
      kind: 'servings' as const,
      scalingBasis: { numerator: '4', denominator: '1' },
      range: {
        start: { numerator: '4', denominator: '1' },
        end: { numerator: '5', denominator: '1' },
        startLexeme: '4',
        endLexeme: '5',
        separator: '–' as const,
      },
    };

    const result = recipesToSchemaOrg([
      makeRecipe({
        fixtureIngredients: [ingredient],
        yield_metadata: yieldMetadata,
      }),
    ])[0];

    expect(result.recipeYield).toBe('4–5 servings');
    expect(result.recipeIngredient).toEqual(['2 cups flour']);
    expect(result.recipeGenieData).toEqual({
      version: 2,
      servings: 4,
      yieldMetadata,
      ingredientSections: [{ label: null, ingredients: [ingredient] }],
      instructionSections: [{ label: null, steps: ['Mix ingredients.', 'Bake at 350F.'] }],
    });
  });
});
