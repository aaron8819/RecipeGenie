import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRemoveRecipeItems, useShoppingFoundationCommand } from '../shopping/use-shopping-document';
import { shoppingKeys } from '@/lib/query-keys';
import { setActivePrincipalId } from '@/lib/principal-session';
import { initializeShoppingDocument } from '@/lib/shopping-initialization';
import { shoppingCompatibilityFixture } from '@/test/shopping-compatibility-fixtures';
import { ShoppingDocumentConflictError } from '@/lib/shopping-document-persistence';

const mock = vi.hoisted(() => ({ execute: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => ({ user: { id: 'owner' }, loading: false }) }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/shopping-command-client', () => ({ executeShoppingCommand: (...args: unknown[]) => mock.execute(...args) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ from: () => ({ select: () => {
  const query = { eq: () => query, maybeSingle: mock.read }; return query;
} }) }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); setActivePrincipalId(null); });
describe('Selection intent binding through production hooks', () => {
  it('historical success does not authorize adopting a newer fetched target', async () => {
    setActivePrincipalId('owner');
    const document = initializeShoppingDocument(shoppingCompatibilityFixture().document, []);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(shoppingKeys.detail('owner'), { document, contentRevision: 10 });
    mock.read.mockResolvedValue({ data: { document, content_revision: 10 }, error: null });
    mock.execute.mockResolvedValue({ status: 'AlreadyApplied', receipt: { outcome: 'Applied', revision: 5 } });
    const { result } = renderHook(() => useShoppingFoundationCommand(), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      const saved = await result.current.mutateAsync({ mutation: { type: 'initialize' }, observedRevision: 4 });
      expect(saved.contentRevision).toBe(10);
      expect(saved.confirmedCurrent).toBe(false);
    });
    client.clear();
  });
  it.each(['remove', 'yield'] as const)('%s retains the inspected token despite a newer cache', async operation => {
    setActivePrincipalId('owner');
    const document = initializeShoppingDocument(shoppingCompatibilityFixture().document, []);
    const entry = Object.values(document.recipeEntries)[0]; entry.sourceEvidence!.version = 9;
    const state = { document, contentRevision: 10 };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(shoppingKeys.detail('owner'), state);
    mock.read.mockResolvedValue({ data: { document, content_revision: 10 }, error: null });
    mock.execute.mockRejectedValue(new ShoppingDocumentConflictError());
    const { result } = renderHook(() => ({ remove: useRemoveRecipeItems(), foundation: useShoppingFoundationCommand() }), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => {
      const promise = operation === 'remove'
        ? result.current.remove.mutateAsync({ recipeId: entry.recipeId, recipeName: entry.recipeName, selectionVersion: 3 })
        : result.current.foundation.mutateAsync({ mutation: { type: 'upsertRecipe', entry }, observedRevision: 4, observedSelections: { [entry.recipeId]: 3 } });
      await expect(promise).rejects.toBeInstanceOf(ShoppingDocumentConflictError);
    });
    expect(mock.execute).toHaveBeenCalledTimes(1);
    expect(mock.execute.mock.calls[0][1]).toMatchObject({ observedSelections: { [entry.recipeId]: 3 } });
    expect(client.getQueryData(shoppingKeys.detail('owner'))).toEqual(state);
    client.clear();
  });
});
