import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShoppingDormantRecovery } from '../shopping-foundation-view';
import { PlacementResolution } from '../shopping-placement-resolution';
import { useShoppingDocumentState } from '@/hooks/shopping/use-shopping-document';
import { shoppingKeys } from '@/lib/query-keys';
import { setActivePrincipalId } from '@/lib/principal-session';
import { planShoppingCommand } from '@/lib/shopping-command-planner';
import type { ShoppingCommand } from '@/lib/shopping-command';
import type { ShoppingDocumentStateV3, ShoppingDocumentV3 } from '@/lib/shopping-document';
import fixture from '@/test/fixtures/shopping-defective-v4.json';

const mock = vi.hoisted(() => ({ owner: 'a', read: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => ({ user: { id: mock.owner }, loading: false }) }));
vi.mock('@/hooks/use-pantry', () => ({ usePantryItems: () => ({ data: [], isSuccess: true }) }));
vi.mock('@/hooks/use-recipes', () => ({ useRecipes: () => ({ data: [] }) }));
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({ from: () => ({ select: () => {
  const query = { eq: () => query, maybeSingle: mock.read }; return query;
} }) }) }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
let client: QueryClient;
let saved: ShoppingDocumentStateV3;
let requests: { phase: string; operationId: string; command: ShoppingCommand }[];
let hold: ReturnType<typeof deferred> | undefined;
let loseResponses: number;
let receipts: Map<string, { outcome: string; revision: number }>;
function apply(command: ShoppingCommand) {
  const plan = planShoppingCommand({ status: 'Pending', row: { document: saved.document, content_revision: saved.contentRevision },
    dependencyRevision: '0', pantry: [], recipes: [], inverse: null, inverseRevision: null }, command);
  if (plan.outcome === 'Applied') saved = { document: plan.document, contentRevision: saved.contentRevision + 1 };
  return { outcome: plan.outcome, revision: saved.contentRevision };
}
function change(mutation: ShoppingCommand['mutation']) {
  expect(apply({ protocol: 1, observedRevision: saved.contentRevision, mutation }).outcome).toBe('Applied');
}
function Harness() {
  const query = useShoppingDocumentState();
  return query.data ? <><output data-testid="fetched-revision">{query.data.contentRevision}</output><ShoppingDormantRecovery state={query.data} items={[]} /></> : null;
}
function mount() {
  client.setQueryData(shoppingKeys.detail(mock.owner), structuredClone(saved));
  return render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
}
const region = () => within(screen.getByRole('region', { name: 'Resolve location for lemon' }));
const select = (index: number, value: string) => fireEvent.change(region().getAllByRole('combobox')[index], { target: { value } });
function choose() { select(0, 'dairy'); select(1, 'apple'); }
const submit = () => fireEvent.click(region().getByRole('button', { name: 'Confirm purchase location' }));
const executed = () => requests.filter(r => r.phase === 'execute');
async function refresh() {
  await act(async () => { await client.refetchQueries({ queryKey: shoppingKeys.detail(mock.owner) }); });
  expect(client.getQueryData<ShoppingDocumentStateV3>(shoppingKeys.detail(mock.owner))?.contentRevision).toBe(saved.contentRevision);
  await waitFor(() => expect(screen.getByTestId('fetched-revision')).toHaveTextContent(String(saved.contentRevision)));
}
function moveAnchor() {
  change({ type: 'learnOrder', draggedRowRef: 'manual:apple-id', draggedOrderingKey: 'apple', sourceCategoryKey: 'dairy',
    targetRowRef: 'manual:banana-id', targetOrderingKey: 'banana', targetCategoryKey: 'dairy', placement: 'after' });
}
beforeEach(() => {
  mock.owner = 'a'; setActivePrincipalId('a'); sessionStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  saved = { document: structuredClone(fixture.originalV4) as unknown as ShoppingDocumentV3, contentRevision: 1 };
  for (const name of ['apple', 'banana']) change({ type: 'addManualItem', item: {
    id: name + '-id', displayName: name, quantity: null, categoryKey: 'produce', bucket: 'items', checked: false,
  } });
  change({ type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { apple: 'dairy', banana: 'dairy' } } });
  change({ type: 'initialize' });
  requests = []; receipts = new Map(); hold = undefined; loseResponses = 0;
  mock.read.mockImplementation(async () => ({ data: { document: structuredClone(saved.document), content_revision: saved.contentRevision }, error: null }));
  // Actual component, query hook, mutation hook and payload-bound command client.
  // Only transport/database are simulated here; real SQL/browser evidence is separate.
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    if (body.phase !== 'execute') return { json: async () => ({ status: 'Admitted', sequence: '1' }) };
    await hold?.promise;
    const previous = receipts.get(body.operationId);
    const receipt = previous ?? apply(body.command); receipts.set(body.operationId, receipt);
    if (loseResponses-- > 0) throw new Error('Lost response');
    return { json: async () => ({ status: previous ? 'AlreadyApplied' : receipt.outcome, receipt }) };
  }));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); setActivePrincipalId(null); });

describe('placement review binding through the component and QueryClient', () => {
  it.each(['before edits', 'after edits'])('rejects the unchanged reviewed decision after actual cache refresh %s', async when => {
    mount(); const reviewed = saved.contentRevision;
    if (when === 'after edits') choose();
    moveAnchor(); await refresh(); const moved = structuredClone(saved);
    if (when === 'before edits') choose();
    submit();
    await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
    expect(executed()[0].command.observedRevision).toBe(reviewed);
    expect(saved).toEqual(moved);
    expect(saved.document.preferences.ingredientOrderByCategory.dairy).toEqual(['banana', 'apple']);
    fireEvent.click(region().getByRole('button', { name: 'Review current placement' }));
    expect(region().getAllByRole('combobox')[0]).toHaveValue('dairy');
    expect(region().getAllByRole('combobox')[1]).toHaveValue('apple');
    submit();
    await waitFor(() => expect(saved.contentRevision).toBe(moved.contentRevision + 1));
    expect(executed().at(-1)?.command.observedRevision).toBe(moved.contentRevision);
    expect(saved.document.preferences.ingredientOrderByCategory.dairy).toEqual(['banana', 'lemon', 'apple']);
  });

  it('rerenders and ordinary field edits keep the original revision and options', async () => {
    const view = mount(); const reviewed = saved.contentRevision; choose(); moveAnchor(); await refresh();
    view.rerender(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    select(0, 'produce'); select(0, 'dairy'); select(1, 'banana');
    const options = within(region().getAllByRole('combobox')[1]).getAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['After every saved purchase', 'Before apple', 'Before banana']);
    submit(); await waitFor(() => expect(executed()).toHaveLength(1));
    expect(executed()[0].command).toMatchObject({ observedRevision: reviewed, mutation: { anchor: 'banana' } });
    await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
  });

  it.each(['dairy', 'produce'])('normal confirmation, including keeping %s, commits once', async category => {
    mount(); const reviewed = saved.contentRevision; select(0, category); submit();
    await waitFor(() => expect(saved.contentRevision).toBe(reviewed + 1));
    expect(executed()[0].command.observedRevision).toBe(reviewed);
    expect(saved.document.preferences.categoryByIngredient.lemon).toBe(category);
  });

  it('cancels without writes and reopening captures current state', async () => {
    mount(); choose(); fireEvent.click(region().getByRole('button', { name: 'Cancel location review' }));
    moveAnchor(); await refresh(); const before = structuredClone(saved);
    expect(requests).toHaveLength(0);
    fireEvent.click(region().getByRole('button', { name: 'Review current placement' }));
    expect(region().getAllByRole('combobox')[0]).toHaveValue('');
    choose(); submit(); await waitFor(() => expect(saved.contentRevision).toBe(before.contentRevision + 1));
    expect(executed()[0].command.observedRevision).toBe(before.contentRevision);
  });

  it('discards an outstanding draft when accounts switch', async () => {
    const view = mount(); choose(); mock.owner = 'b'; setActivePrincipalId('b');
    client.setQueryData(shoppingKeys.detail('b'), structuredClone(saved));
    view.rerender(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    expect(region().getAllByRole('combobox')[0]).toHaveValue('');
    expect(region().getAllByRole('combobox')[1]).toHaveValue('');
    expect(requests).toHaveLength(0);
  });

  it('removes a resolved target draft and does not reuse it if recovery returns', async () => {
    mount(); choose(); const unresolved = structuredClone(saved.document);
    change({ type: 'resolvePlacement', purchaseKey: 'lemon', categoryKey: 'produce', anchor: null }); await refresh();
    expect(screen.queryByRole('region', { name: 'Resolve location for lemon' })).not.toBeInTheDocument();
    saved = { document: unresolved, contentRevision: saved.contentRevision + 1 }; await refresh();
    expect(region().getAllByRole('combobox')[0]).toHaveValue('');
    expect(requests).toHaveLength(0);
  });

  it('explicit review clears an anchor that left the selected destination', async () => {
    mount(); choose(); change({ type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { apple: 'frozen' } } });
    await refresh(); expect(region().getAllByRole('combobox')[1]).toHaveValue('apple');
    fireEvent.click(region().getByRole('button', { name: 'Review current placement' }));
    expect(region().getAllByRole('combobox')[0]).toHaveValue('dairy');
    expect(region().getAllByRole('combobox')[1]).toHaveValue('');
    expect(requests).toHaveLength(0);
  });

  it('double submission and refresh in flight cannot acquire a newer revision', async () => {
    mount(); choose(); const reviewed = saved.contentRevision; hold = deferred();
    submit(); submit(); await waitFor(() => expect(executed()).toHaveLength(1));
    moveAnchor(); await refresh(); const moved = structuredClone(saved);
    await act(async () => { hold!.resolve(); });
    await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
    expect(executed()).toHaveLength(1); expect(executed()[0].command.observedRevision).toBe(reviewed);
    expect(saved).toEqual(moved);
  });

  it('lost committed responses replay the same payload and receipt after a refresh', async () => {
    mount(); choose(); const reviewed = saved.contentRevision; loseResponses = 2; submit();
    await waitFor(() => expect(executed()).toHaveLength(2));
    await waitFor(() => expect(saved.contentRevision).toBe(reviewed + 1));
    const committed = structuredClone(saved);
    const { executeShoppingCommand, shoppingPendingAttempt } = await import('@/lib/shopping-command-client');
    await waitFor(() => expect(shoppingPendingAttempt('a')).toContain('OutcomeUnknown'));
    await refresh();
    // The real recovery panel uses this exact retained command even if the
    // resolved target's editor has unmounted. It never creates a fresh draft.
    const attempt = JSON.parse(shoppingPendingAttempt('a')!);
    const result = await executeShoppingCommand('a', attempt.command);
    expect(result.status).toBe('AlreadyApplied'); expect(saved).toEqual(committed);
    expect(executed().every(r => r.operationId === attempt.operationId && r.command.observedRevision === reviewed)).toBe(true);
  });

  it('keeping the current location also rejects a refreshed stale review', async () => {
    mount(); const reviewed = saved.contentRevision; select(0, 'produce');
    moveAnchor(); await refresh(); const moved = structuredClone(saved); submit();
    await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
    expect(executed()[0].command.observedRevision).toBe(reviewed); expect(saved).toEqual(moved);
  });

  it('retry of an uncommitted stale command cannot become a fresh confirmation', async () => {
    mount(); choose(); const reviewed = saved.contentRevision; moveAnchor(); await refresh();
    const moved = structuredClone(saved); loseResponses = 2; submit();
    await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
    expect(executed()).toHaveLength(2); expect(saved).toEqual(moved);
    expect(region().getAllByRole('combobox')[0]).toBeDisabled();
    expect(region().getByRole('button', { name: 'Review current placement' })).toBeDisabled();
    submit(); await waitFor(() => expect(executed()).toHaveLength(3));
    await waitFor(() => expect(region().getByRole('button', { name: 'Confirm purchase location' })).toBeDisabled());
    expect(executed().every(r => r.command.observedRevision === reviewed && r.operationId === executed()[0].operationId)).toBe(true);
    expect(saved).toEqual(moved);
    fireEvent.click(region().getByRole('button', { name: 'Review current placement' })); submit();
    await waitFor(() => expect(saved.contentRevision).toBe(moved.contentRevision + 1));
    expect(executed().at(-1)?.operationId).not.toBe(executed()[0].operationId);
  });

  it('an account switch during execution cannot write or populate the next owner cache', async () => {
    const view = mount(); choose(); hold = deferred(); submit();
    await waitFor(() => expect(executed()).toHaveLength(1));
    // Simulate the authenticated server rejecting the old request as well as
    // the command client's active-principal fence on receiving its response.
    const before = structuredClone(saved);
    receipts.set(executed()[0].operationId, { outcome: 'Conflict', revision: saved.contentRevision });
    mock.owner = 'b'; setActivePrincipalId('b');
    client.setQueryData(shoppingKeys.detail('b'), before);
    view.rerender(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    await act(async () => { hold!.resolve(); });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(saved).toEqual(before); expect(client.getQueryData(shoppingKeys.detail('b'))).toEqual(before);
    expect(region().getAllByRole('combobox')[0]).toHaveValue('');
  });

  it('changing the target purchase discards its predecessor draft', () => {
    client.setQueryData(shoppingKeys.detail('a'), saved);
    const view = render(<QueryClientProvider client={client}><PlacementResolution purchaseKey="lemon" state={saved} /></QueryClientProvider>);
    choose();
    view.rerender(<QueryClientProvider client={client}><PlacementResolution purchaseKey="banana" state={saved} /></QueryClientProvider>);
    const replacement = within(screen.getByRole('region', { name: 'Resolve location for banana' }));
    expect(replacement.getAllByRole('combobox')[0]).toHaveValue('');
    expect(replacement.getAllByRole('combobox')[1]).toHaveValue('');
    expect(requests).toHaveLength(0);
  });

  it('removing an anchor need rejects stale confirmation but preserves its dormant placement', async () => {
    mount(); choose(); const reviewed = saved.contentRevision;
    change({ type: 'deleteManualItem', id: 'apple-id' }); await refresh(); const removed = structuredClone(saved);
    submit(); await waitFor(() => expect(region().getByRole('alert')).toBeInTheDocument());
    expect(executed()[0].command.observedRevision).toBe(reviewed); expect(saved).toEqual(removed);
    fireEvent.click(region().getByRole('button', { name: 'Review current placement' }));
    expect(region().getAllByRole('combobox')[1]).toHaveValue('apple');
    submit(); await waitFor(() => expect(saved.contentRevision).toBe(removed.contentRevision + 1));
    expect(saved.document.manualItems.find(item => item.id === 'apple-id')?.identity?.removed).toBe(true);
    expect(saved.document.preferences.ingredientOrderByCategory.dairy).toEqual(['lemon', 'apple', 'banana']);
  });
});
