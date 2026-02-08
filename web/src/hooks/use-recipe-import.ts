'use client';

import { useMutation } from '@tanstack/react-query';
import type { ExtractedRecipe } from '@/lib/recipe-url-parser';

/**
 * TanStack mutation for importing a recipe from a URL.
 * Calls the /api/recipe-import route.
 */
export function useImportRecipeFromUrl() {
  return useMutation({
    mutationFn: async (url: string): Promise<ExtractedRecipe> => {
      const res = await fetch('/api/recipe-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || `Import failed (${res.status})`
        );
      }

      return res.json();
    },
  });
}
