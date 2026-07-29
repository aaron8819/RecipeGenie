import { describe, expect, it } from 'vitest';
import { buildRecipeShareSnapshot } from '@/lib/recipe-sharing';
import type { Recipe } from '@/types/database';

describe('buildRecipeShareSnapshot', () => {
  it('creates a share snapshot from recipe fields', () => {
    const recipe: Recipe = {
      id: 'test-recipe',
      user_id: 'user-1',
      name: 'Chicken Curry',
      category: 'chicken',
      servings: 4,
      prep_time_minutes: 10,
      cook_time_minutes: 15,
      total_time_minutes: 25,
      favorite: true,
      tags: ['quick', 'spicy'],
      ingredients: [{
        item: 'chicken',
        amount: 1,
        unit: 'lb',
        authoredUnit: 'lb',
        quantityV1: {
          version: 1,
          kind: 'exact',
          value: { numerator: '1', denominator: '1' },
          authored: '1',
          lexeme: '1',
          source: 'authored',
        },
      }],
      instructions: ['Cook chicken', 'Serve hot'],
      notes: ['Serve with rice'],
      instruction_groups: [{ steps: ['Cook chicken', 'Serve hot'] }],
      image_url: 'images/chicken-curry.webp',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
      yield_metadata: {
        version: 1,
        authoredText: '4–5 servings',
        kind: 'servings',
        scalingBasis: { numerator: '4', denominator: '1' },
        range: {
          start: { numerator: '4', denominator: '1' },
          end: { numerator: '5', denominator: '1' },
          startLexeme: '4',
          endLexeme: '5',
          separator: '–',
        },
      },
    };

    expect(buildRecipeShareSnapshot(recipe)).toEqual({
      name: 'Chicken Curry',
      category: 'chicken',
      servings: 4,
      tags: ['quick', 'spicy'],
      ingredients: [{
        item: 'chicken',
        amount: 1,
        unit: 'lb',
        authoredUnit: 'lb',
        quantityV1: {
          version: 1,
          kind: 'exact',
          value: { numerator: '1', denominator: '1' },
          authored: '1',
          lexeme: '1',
          source: 'authored',
        },
      }],
      instructions: ['Cook chicken', 'Serve hot'],
      image_url: 'images/chicken-curry.webp',
      prep_time_minutes: 10,
      cook_time_minutes: 15,
      total_time_minutes: 25,
      notes: ['Serve with rice'],
      instruction_groups: [{ steps: ['Cook chicken', 'Serve hot'] }],
      yield_metadata: {
        version: 1,
        authoredText: '4–5 servings',
        kind: 'servings',
        scalingBasis: { numerator: '4', denominator: '1' },
        range: {
          start: { numerator: '4', denominator: '1' },
          end: { numerator: '5', denominator: '1' },
          startLexeme: '4',
          endLexeme: '5',
          separator: '–',
        },
      },
    });
  });
});
