import type { ReactNode } from 'react';
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShoppingDocumentState, useRemoveShoppingItem } from '@/hooks/shopping/use-shopping-document';
import { createEmptyShoppingDocument, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { shoppingKeys } from '@/lib/query-keys';
import { setActivePrincipalId } from '@/lib/principal-session';
import { removePrincipalQueries } from '@/lib/principal-cache';
import { reconcileShoppingState } from '@/lib/shopping-cache';
import type { ShoppingItem } from '@/types/database';

const mock = vi.hoisted(() => ({ owner: 'a' as string | null, read: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => ({ user: mock.owner ? { id: mock.owner } : null, loading: false }) }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/shopping-command-client', () => ({ executeShoppingCommand: (...args: unknown[]) => mock.execute(...args) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ from: () => ({ select: () => {
  let owner = mock.owner;
  const selection = { eq: (_key: string, value: string) => { owner = value; return selection; },
    maybeSingle: () => mock.read(owner) };
  return selection;
} }) }) }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const state = (revision: number): ShoppingDocumentStateV3 => ({
  document: { ...createEmptyShoppingDocument(), manualItems: [{ id: 'item',
    displayName: `Revision ${revision}`, quantity: null, categoryKey: 'misc', bucket: 'items', checked: false }] },
  contentRevision: revision,
});
const row = (revision: number) => ({ data: { document: state(revision).document, content_revision: revision }, error: null });
let client: QueryClient;
const key = shoppingKeys.detail('a');
function mount() {
  return renderHook(() => ({ query: { ...useShoppingDocumentState() }, remove: useRemoveShoppingItem() }), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}
beforeEach(() => {
  mock.owner = 'a'; setActivePrincipalId('a'); mock.read.mockReset(); mock.execute.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); setActivePrincipalId(null); });

describe('F2 committed cache reconciliation through the actual hook and QueryClient', () => {
  it.each(['Applied', 'AlreadyApplied'])('holds query 7, commits mutation 9 (%s), then accepts 10', async (status) => {
    const held = deferred<ReturnType<typeof row>>();
    client.setQueryData(key, state(7), { updatedAt: 1 });
    mock.read.mockReturnValueOnce(held.promise).mockResolvedValueOnce(row(9)).mockResolvedValueOnce(row(10));
    mock.execute.mockResolvedValue({ status, receipt: { outcome: 'Applied', revision: status === 'Applied' ? 9 : 8 } });
    const hook = mount();
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    await act(async () => { await hook.result.current.remove.mutateAsync({ rowId: 'manual:item' } as ShoppingItem); });
    expect(client.getQueryData<ShoppingDocumentStateV3>(key)?.contentRevision).toBe(9);
    await act(async () => { held.resolve(row(7)); await held.promise; });
    await waitFor(() => expect(hook.result.current.query.isFetching).toBe(false));
    expect(hook.result.current.query.data?.contentRevision).toBe(9);
    expect(hook.result.current.query.data?.document.manualItems[0].displayName).toBe('Revision 9');
    await act(async () => { await hook.result.current.query.refetch(); });
    await waitFor(() => expect(hook.result.current.query.data?.contentRevision).toBe(10));
  });

  it('a failed mutation refetch cannot roll back a newer committed write', async () => {
    client.setQueryData(key, state(9)); mock.execute.mockRejectedValue(new Error('failed'));
    mock.read.mockResolvedValue(row(7)); const hook = mount();
    await act(async () => { await expect(hook.result.current.remove.mutateAsync({ rowId: 'manual:item' } as ShoppingItem)).rejects.toThrow('failed'); });
    expect(client.getQueryData<ShoppingDocumentStateV3>(key)?.contentRevision).toBe(9);
    expect(hook.result.current.query.data?.contentRevision).toBe(9);
  });

  it('out-of-order refetches cannot roll back the later query', async () => {
    const first = deferred<ReturnType<typeof row>>(); const second = deferred<ReturnType<typeof row>>();
    client.setQueryData(key, state(7)); mock.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const hook = mount();
    let earlier!: Promise<unknown>; let later!: Promise<unknown>;
    act(() => { earlier = hook.result.current.query.refetch(); });
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    act(() => { later = hook.result.current.query.refetch(); });
    await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(row(10)); await later; first.resolve(row(8)); await earlier; });
    await waitFor(() => expect(hook.result.current.query.data?.contentRevision).toBe(10));
  });

  it.each(['b', null])('isolates late reads after switching to %s and a fresh document lifecycle', async (owner) => {
    const held = deferred<ReturnType<typeof row>>(); mock.read.mockReturnValueOnce(held.promise).mockResolvedValue(row(1));
    const hook = mount(); await waitFor(() => expect(mock.read).toHaveBeenCalledTimes(1));
    hook.unmount(); mock.owner = owner; setActivePrincipalId(owner);
    await removePrincipalQueries(client, 'a');
    const next = mount();
    await act(async () => { held.resolve(row(99)); await held.promise; });
    expect(client.getQueryData(key)).toBeUndefined();
    if (owner) await waitFor(() => expect(next.result.current.query.data?.contentRevision).toBe(1));
    else expect(next.result.current.query.data).toBeUndefined();
    next.unmount(); mock.owner = 'a'; setActivePrincipalId('a');
    const fresh = mount(); await waitFor(() => expect(fresh.result.current.query.data?.contentRevision).toBe(1));
  });

  it('keeps valid missing-document state and recovers after an unsupported read', async () => {
    mock.read.mockResolvedValueOnce({ data: null, error: null }); const hook = mount();
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    expect(hook.result.current.query.data).toEqual({ document: createEmptyShoppingDocument(), contentRevision: 0 });
    mock.read.mockResolvedValueOnce({ data: { document: { schemaVersion: 99 }, content_revision: 1 }, error: null });
    await act(async () => { await hook.result.current.query.refetch(); });
    await waitFor(() => expect(hook.result.current.query.isError).toBe(true));
    mock.read.mockResolvedValueOnce(row(2));
    await act(async () => { await hook.result.current.query.refetch(); });
    await waitFor(() => expect(hook.result.current.query.isSuccess).toBe(true));
    expect(hook.result.current.query.data?.contentRevision).toBe(2);
    // Recovery writes use the same comparison, within this query identity.
    act(() => client.setQueryData<ShoppingDocumentStateV3>(key, (current) => reconcileShoppingState(current, state(1))));
    expect(client.getQueryData<ShoppingDocumentStateV3>(key)?.contentRevision).toBe(2);
  });
});
