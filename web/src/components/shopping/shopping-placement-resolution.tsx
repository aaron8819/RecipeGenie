'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { useShoppingFoundationCommand } from '@/hooks/shopping/use-shopping-document';
import { useAuthContext } from '@/lib/auth-context';
import { getActivePrincipalId } from '@/lib/principal-session';
import { SHOPPING_CATEGORIES } from '@/lib/shopping-categories';
import { ShoppingCommandError, shoppingPendingAttempt, subscribeShoppingAttempt } from '@/lib/shopping-command-client';
import type { ShoppingDocumentStateV3 } from '@/lib/shopping-document';

interface Props {
  purchaseKey: string;
  state: ShoppingDocumentStateV3;
}
interface Draft extends Props {
  owner: string;
  category: string;
  anchor: string;
}
const locations = (state: ShoppingDocumentStateV3) => [
  ...Object.entries(SHOPPING_CATEGORIES).map(([key, value]) => ({ key, name: value.name })),
  ...state.document.preferences.customCategories.map(c => ({ key: `custom_${c.id}`, name: c.name })),
];
const sequence = (state: ShoppingDocumentStateV3, category: string, purchaseKey: string) => {
  const destination = category === '@default' ? state.document.placementEvidence?.defaults[purchaseKey]?.categoryKey ?? '' : category;
  return (state.document.preferences.ingredientOrderByCategory[destination] ?? []).filter(key => key !== purchaseKey);
};

export function PlacementResolution({ purchaseKey, state }: Props) {
  const { user } = useAuthContext();
  // A different principal or target must never inherit another draft's input.
  return user ? <PlacementReview key={`${user.id}:${purchaseKey}`} owner={user.id}
    purchaseKey={purchaseKey} state={state} /> : null;
}

function PlacementReview({ owner, purchaseKey, state }: Props & { owner: string }) {
  const command = useShoppingFoundationCommand();
  // One immutable query snapshot supplies revision, recovery evidence, defaults,
  // locations and order. Field edits change input only, never this snapshot.
  const [draft, setDraft] = useState<Draft | null>(() => ({ owner, purchaseKey, state, category: '', anchor: '' }));
  const [error, setError] = useState('');
  const [reviewRequired, setReviewRequired] = useState(false);
  const pendingAttempt = useSyncExternalStore(subscribeShoppingAttempt,
    () => shoppingPendingAttempt(owner), () => null);
  const submitting = useRef(false);
  const stale = !!draft && draft.state.contentRevision !== state.contentRevision;
  const evidence = draft?.state.document.placementEvidence?.unresolved[purchaseKey];
  const busy = command.isPending;

  function reviewCurrent() {
    if (submitting.current || pendingAttempt || getActivePrincipalId() !== owner) return;
    const category = draft && (draft.category === '@default' || locations(state).some(c => c.key === draft.category))
      ? draft.category : '';
    const anchor = draft && sequence(state, category, purchaseKey).includes(draft.anchor) ? draft.anchor : '';
    // Explicit review is the only renewal path. Valid input can be retained,
    // but the current order/evidence is presented again before confirmation.
    setDraft({ owner, purchaseKey, state, category, anchor });
    setError(''); setReviewRequired(false);
  }

  async function submit() {
    if (!draft || !draft.category || submitting.current || reviewRequired ||
      draft.owner !== getActivePrincipalId() || draft.purchaseKey !== purchaseKey) return;
    submitting.current = true;
    try {
      await command.mutateAsync({ observedRevision: draft.state.contentRevision, mutation: {
        type: 'resolvePlacement', purchaseKey: draft.purchaseKey, categoryKey: draft.category, anchor: draft.anchor || null,
      } });
      // A historical successful receipt is completion, never permission to
      // replay this decision with fresh preconditions. Recovery stays upstream.
      setDraft(null); setError('');
    } catch (failure) {
      const rejected = failure instanceof ShoppingCommandError &&
        ['Conflict', 'TargetGone', 'InvalidInput'].includes(failure.status);
      setReviewRequired(rejected);
      setError(rejected
        ? 'This location review is out of date. Nothing was moved by this confirmation. Review current placement, check the destination and position, then confirm again.'
        : failure instanceof Error ? failure.message : 'Could not confirm the location. Your input is preserved.');
    } finally { submitting.current = false; }
  }

  return <section className="mt-3 grid gap-2 rounded border p-3" aria-label={`Resolve location for ${purchaseKey}`}>
    <h3>Choose the remembered location for {purchaseKey}</h3>
    {draft && <>
      <p>Stored choices: {evidence?.categories.join(', ')}. This choice applies to the whole purchase.</p>
      <label>Destination<select className="w-full rounded border p-2" value={draft.category} disabled={busy || !!pendingAttempt}
        onChange={e => setDraft({ ...draft, category: e.target.value, anchor: '' })}>
        <option value="">Choose a destination</option><option value="@default">Reset Category to the pinned default</option>
        {locations(draft.state).map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
      </select></label>
      <label>Position<select className="w-full rounded border p-2" value={draft.anchor} disabled={busy || !!pendingAttempt}
        onChange={e => setDraft({ ...draft, anchor: e.target.value })}>
        <option value="">After every saved purchase</option>
        {sequence(draft.state, draft.category, purchaseKey).map(key => <option key={key} value={key}>Before {key}</option>)}
      </select></label>
      {draft.category && <p>Reviewed saved order (including hidden purchases): {sequence(draft.state, draft.category, purchaseKey).join(' → ') || 'No saved purchases'}.</p>}
      {stale && <p role="status">Shopping changed since this review. Your choices are retained, but you must review current placement before they can be applied.</p>}
      <Button disabled={busy || !draft.category || reviewRequired} onClick={() => void submit()}>Confirm purchase location</Button>
      <Button variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancel location review</Button>
      <details><summary>Original location and order evidence</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(evidence, null, 2)}</pre></details>
    </>}
    {(!draft || stale || reviewRequired) && <Button variant="outline" disabled={busy || !!pendingAttempt} onClick={reviewCurrent}>Review current placement</Button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
