import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useAddToShoppingList } from '@/hooks/shopping/use-shopping-document';
import { createEmptyShoppingDocument, projectShoppingDocument, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { initializeShoppingDocument } from '@/lib/shopping-initialization';
import { planShoppingCommand } from '@/lib/shopping-command-planner';
import { ShoppingCommandError } from '@/lib/shopping-command-client';
import { initialShoppingSelection } from '@/lib/shopping-selection';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { shoppingKeys } from '@/lib/query-keys';
import { setActivePrincipalId } from '@/lib/principal-session';
const owner = '00000000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], state: null as ShoppingDocumentStateV3 | null,
  concurrent: null as ShoppingDocumentStateV3 | null, execute: vi.fn(), toast: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => ({ user: { id: owner }, loading: false }) }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: mocks.toast }) }));
vi.mock('@/lib/shopping-command-client', async original => ({ ...await original<typeof import('@/lib/shopping-command-client')>(),
  executeShoppingCommand: (...args: unknown[]) => mocks.execute(...args) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ from: (table: string) => ({ select: () => {
  const q = { in: async () => ({ data: mocks.rows, error: null }), eq: () => q,
    maybeSingle: async () => ({ data: { document: mocks.state!.document, content_revision: mocks.state!.contentRevision }, error: null }) };
  return table === 'recipes' ? q : q;
} }) }) }));
const recipe = canonicalizeRecipeFixture({ user_id: owner, name: 'Soup', fixtureIngredients: [
  { item: 'milk', amount: 1, unit: 'cup' }, { item: 'oil', amount: 2, unit: 'tbsp' },
] });
function row() { return { ...recipe, recipe_uuid: recipe.id, ingredient_sections: recipe.ingredientSections,
  instruction_sections: recipe.instructionSections, yield_metadata: null }; }
function setup() {
 const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
 client.setQueryData(shoppingKeys.detail(owner), mocks.state);
 return renderHook(useAddToShoppingList, { wrapper: ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
 vi.clearAllMocks(); setActivePrincipalId(owner); mocks.rows = [row()]; mocks.concurrent = null;
 mocks.state = { document: initializeShoppingDocument(createEmptyShoppingDocument(), []), contentRevision: 0 };
 mocks.execute.mockImplementation(async (_owner, command) => {
   if (mocks.concurrent) { mocks.state = mocks.concurrent; mocks.concurrent = null; }
   const before = mocks.state!;
   const result = planShoppingCommand({ status: 'Pending', row: { document: before.document, content_revision: before.contentRevision },
     dependencyRevision: '0', pantry: [], recipes: mocks.rows, inverse: null, inverseRevision: null }, command);
   if (!['Applied','Unchanged'].includes(result.outcome)) throw new ShoppingCommandError(result.outcome);
   mocks.state = { document: result.document, contentRevision: before.contentRevision + Number(result.outcome === 'Applied') };
   return { status: result.outcome, before, receipt: { outcome: result.outcome, revision: mocks.state.contentRevision } };
 });
});
describe('selected Shopping mutation through authoritative command planning', () => {
 it('keeps all-ingredient callers and serializes explicit selected source evidence', async () => {
   const { result } = setup();
   await act(async () => { await result.current.mutateAsync({ recipeIds: [recipe.id], scale: 2 }); });
   expect(mocks.state!.document.recipeEntries[recipe.id].ingredients).toHaveLength(2);
   const selection = { ...initialShoppingSelection(recipe).selection, selectedYield: 8, ingredientOrdinals: [0] };
   await act(async () => { await result.current.mutateAsync({ recipeIds: [recipe.id], selections: [selection] }); });
   expect(mocks.execute.mock.calls[1][1].sourceSelections).toEqual([selection]);
   expect(mocks.state!.document.recipeEntries[recipe.id].sourceEvidence!.occurrences.map(s => s.ordinal)).toEqual([0]);
   expect(projectShoppingDocument(mocks.state!.document).items[0].quantity).toMatchObject({ amount: 96, unit: 'tsp' });
 });
 it('rejects stale recipe input before admission', async () => {
   mocks.rows = [{ ...row(), servings: 8 }]; const { result } = setup();
   await act(async () => { await expect(result.current.mutateAsync({ recipeIds: [recipe.id], selections: [initialShoppingSelection(recipe).selection] })).rejects.toThrow('recipe changed'); });
   expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.toast).toHaveBeenCalled();
 });
 it('rebases an unrelated change without replacing it or replaying the command', async () => {
   const { result } = setup();
   const concurrent = planShoppingCommand({ status: 'Pending', row: { document: mocks.state!.document, content_revision: 0 }, dependencyRevision: '0', pantry: [], recipes: mocks.rows, inverse: null, inverseRevision: null },
     { protocol: 1, observedRevision: 0, mutation: { type: 'addManualItem', item: { id: 'extra', displayName: 'banana', quantity: null, categoryKey: 'produce', bucket: 'items', checked: false } } });
   mocks.concurrent = { document: concurrent.document, contentRevision: 1 };
   await act(async () => { await result.current.mutateAsync({ recipeIds: [recipe.id], selections: [initialShoppingSelection(recipe).selection] }); });
   expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.state!.document.manualItems).toHaveLength(1);
 });
 it('does not overwrite a concurrent same-recipe selection', async () => {
   const { result } = setup();
   const original = mocks.state!;
   const selection = initialShoppingSelection(recipe).selection;
   const resultOfOther = planShoppingCommand({ status: 'Pending', row: { document: original.document, content_revision: 0 }, dependencyRevision: '0', pantry: [], recipes: mocks.rows, inverse: null, inverseRevision: null },
     { protocol: 1, observedRevision: 0, mutation: { type: 'upsertRecipes', entries: [importedEntry()] } });
   mocks.concurrent = { document: resultOfOther.document, contentRevision: 1 };
   await act(async () => { await expect(result.current.mutateAsync({ recipeIds: [recipe.id], selections: [selection] })).rejects.toThrow('another session'); });
   expect(mocks.execute).toHaveBeenCalledTimes(1); expect(mocks.state!.document.recipeEntries[recipe.id].selectedServings).toBe(8);
 });
});
import { createShoppingRecipeEntry } from '@/lib/shopping-document';
function importedEntry() { return createShoppingRecipeEntry(recipe, 8, { numerator: '2', denominator: '1' }); }
