import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useAddToShoppingList } from '@/hooks/shopping/use-shopping-document';
import {
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  applyShoppingDocumentMutation,
  projectShoppingDocument,
  type ShoppingDocumentStateV3,
} from '@/lib/shopping-document';
import { initialShoppingSelection } from '@/lib/shopping-selection';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { parseIngredientLine } from '@/lib/recipe-parser';
import { shoppingKeys } from '@/lib/query-keys';

const owner = '00000000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  state: null as ShoppingDocumentStateV3 | null,
  conflict: null as ShoppingDocumentStateV3 | null,
  editOnConflict: null as unknown[] | null,
  writes: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuthContext: () => ({ user: { id: owner }, loading: false }),
}));
vi.mock('@/hooks/use-undo-toast', () => ({
  useUndoToast: () => ({ show: mocks.toast }),
}));
vi.mock('@/hooks/use-pantry', () => ({ usePantryItems: () => ({ data: [] }) }));
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) =>
      table === 'recipes'
        ? {
            select: () => ({
              in: async () => ({ data: mocks.rows, error: null }),
            }),
          }
        : {
            select: () => ({
              single: async () => ({
                data: {
                  document: mocks.state!.document,
                  content_revision: mocks.state!.contentRevision,
                },
                error: null,
              }),
            }),
            update: (values: {
              document: ShoppingDocumentStateV3['document'];
              content_revision: number;
            }) => {
              mocks.writes(values);
              const chain = {
                eq: () => chain,
                select: () => chain,
                maybeSingle: async () => {
                  if (mocks.conflict) {
                    mocks.state = mocks.conflict;
                    mocks.conflict = null;
                    if (mocks.editOnConflict) mocks.rows = mocks.editOnConflict;
                    return { data: null, error: null };
                  }
                  mocks.state = {
                    document: values.document,
                    contentRevision: values.content_revision,
                  };
                  return { data: values, error: null };
                },
              };
              return chain;
            },
          },
  }),
}));

const recipe = canonicalizeRecipeFixture({
  user_id: owner,
  name: 'Soup',
  fixtureIngredients: ['1 cup milk', '2 tbsp olive oil'].map(
    parseIngredientLine,
  ),
});
function row(source = recipe) {
  const { ingredientSections, instructionSections, ...rest } = source;
  return {
    ...rest,
    id: 'legacy-soup',
    recipe_uuid: source.id,
    ingredient_sections: ingredientSections,
    instruction_sections: instructionSections,
  };
}
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(shoppingKeys.detail(owner), mocks.state);
  return renderHook(() => useAddToShoppingList(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [row()];
  mocks.state = { document: createEmptyShoppingDocument(), contentRevision: 0 };
  mocks.conflict = null;
  mocks.editOnConflict = null;
});
describe('selected Shopping mutation', () => {
  it('keeps legacy all-ingredient callers compatible', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync({ recipeIds: [recipe.id], scale: 2 });
    });
    expect(
      mocks.state!.document.recipeEntries[recipe.id].ingredients,
    ).toHaveLength(2);
    expect(mocks.state!.document.recipeEntries[recipe.id].scaleV1).toEqual({
      numerator: '2',
      denominator: '1',
    });
  });

  it('writes a subset with its own yield in one revision', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync({
        recipeIds: [recipe.id],
        selections: [
          {
            ...initialShoppingSelection(recipe).selection,
            selectedYield: 8,
            ingredientOrdinals: [0],
          },
        ],
      });
    });
    expect(mocks.writes).toHaveBeenCalledTimes(1);
    expect(
      mocks.state!.document.recipeEntries[recipe.id].ingredients,
    ).toHaveLength(1);
    expect(
      projectShoppingDocument(mocks.state!.document).items[0].quantity?.amount,
    ).toBe(2);
  });

  it('rejects stale recipe content before any Shopping write', async () => {
    mocks.rows = [row({ ...recipe, servings: 8 })];
    const { result } = setup();
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          recipeIds: [recipe.id],
          selections: [initialShoppingSelection(recipe).selection],
        }),
      ).rejects.toThrow('recipe changed');
    });
    expect(mocks.writes).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalled();
  });

  it('replays over concurrent check-off without losing the checked intent', async () => {
    mocks.state = applyShoppingDocumentMutation(mocks.state!, {
      type: 'upsertRecipes',
      entries: [
        createShoppingRecipeEntry(recipe, 4, {
          numerator: '1',
          denominator: '1',
        }),
      ],
    });
    const milk = projectShoppingDocument(mocks.state.document).items.find(
      (r) => r.displayName === 'milk',
    )!;
    mocks.conflict = applyShoppingDocumentMutation(mocks.state, {
      type: 'setChecked',
      rowRef: milk.rowRef,
      checked: true,
    });
    const { result } = setup();
    await act(async () => {
      await result.current.mutateAsync({
        recipeIds: [recipe.id],
        selections: [
          {
            ...initialShoppingSelection(recipe).selection,
            ingredientOrdinals: [0],
          },
        ],
      });
    });
    expect(mocks.writes).toHaveBeenCalledTimes(2);
    expect(
      projectShoppingDocument(mocks.state!.document).items[0].checked,
    ).toBe(true);
  });

  it('does not overwrite a different same-recipe selection from another session', async () => {
    mocks.conflict = applyShoppingDocumentMutation(mocks.state!, {
      type: 'upsertRecipes',
      entries: [
        createShoppingRecipeEntry(recipe, 8, {
          numerator: '2',
          denominator: '1',
        }),
      ],
    });
    const { result } = setup();
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          recipeIds: [recipe.id],
          selections: [initialShoppingSelection(recipe).selection],
        }),
      ).rejects.toThrow('another session');
    });
    expect(mocks.writes).toHaveBeenCalledTimes(1);
    expect(
      mocks.state!.document.recipeEntries[recipe.id].selectedServings,
    ).toBe(8);
  });

  it('rechecks recipe edits before a conflict retry', async () => {
    mocks.conflict = { ...mocks.state!, contentRevision: 1 };
    mocks.editOnConflict = [row({ ...recipe, servings: 8 })];
    const { result } = setup();
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          recipeIds: [recipe.id],
          selections: [initialShoppingSelection(recipe).selection],
        }),
      ).rejects.toThrow('recipe changed');
    });
    expect(mocks.writes).toHaveBeenCalledTimes(1);
  });
});
