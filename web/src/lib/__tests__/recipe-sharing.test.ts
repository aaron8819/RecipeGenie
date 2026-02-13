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
      favorite: true,
      tags: ['quick', 'spicy'],
      ingredients: [{ item: 'chicken', amount: 1, unit: 'lb' }],
      instructions: ['Cook chicken', 'Serve hot'],
      image_url: 'images/chicken-curry.webp',
      created_at: '2026-02-01T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    };

    expect(buildRecipeShareSnapshot(recipe)).toEqual({
      name: 'Chicken Curry',
      category: 'chicken',
      servings: 4,
      tags: ['quick', 'spicy'],
      ingredients: [{ item: 'chicken', amount: 1, unit: 'lb' }],
      instructions: ['Cook chicken', 'Serve hot'],
      image_url: 'images/chicken-curry.webp',
    });
  });
});
