'use client';

import { useMemo } from 'react';
import { useRecipes } from '@/hooks/use-recipes';
import { usePantryItems } from '@/hooks/use-pantry';
import {
  matchRecipesToPantry,
  type RecipeMatch,
} from '@/lib/pantry-matcher';

/**
 * Combines recipes + pantry items and returns
 * ranked recipe matches.
 */
export function usePantryMatch(): {
  matches: RecipeMatch[];
  isLoading: boolean;
} {
  const { data: recipes, isLoading: recipesLoading } =
    useRecipes();
  const { data: pantryItems, isLoading: pantryLoading } =
    usePantryItems();

  const matches = useMemo(() => {
    if (!recipes || !pantryItems) return [];
    const items = pantryItems.map((p) => p.item);
    return matchRecipesToPantry(recipes, items);
  }, [recipes, pantryItems]);

  return {
    matches,
    isLoading: recipesLoading || pantryLoading,
  };
}
