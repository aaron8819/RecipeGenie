'use client';

import { useState, useSyncExternalStore } from 'react';
import { reconcileShoppingState, type ShoppingCachedState } from '@/lib/shopping-cache';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/lib/auth-context';
import { getActivePrincipalId } from '@/lib/principal-session';
import { shoppingKeys, pantryKeys } from '@/lib/query-keys';
import { getSupabase } from '@/lib/supabase/client';
import { readShoppingCompatibility } from '@/lib/shopping-compatibility';
import { createEmptyShoppingDocument, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { acknowledgeUnknownShoppingAttempt, executeShoppingCommand, shoppingPendingAttempt, subscribeShoppingAttempt } from '@/lib/shopping-command-client';
import { shoppingOutcomeMessage, type ShoppingCommand } from '@/lib/shopping-command';
import { useUndoToast } from '@/hooks/use-undo-toast';


export function useShoppingCommandRecovery() {
  const { user } = useAuthContext();
  const owner = user?.id || '';
  const saved = useSyncExternalStore(subscribeShoppingAttempt, () => shoppingPendingAttempt(owner), () => null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const client = useQueryClient();
  const toast = useUndoToast();
  let attempt: { command: ShoppingCommand; failure?: string } | null = null;
  try { attempt = saved ? JSON.parse(saved) : null; } catch { /* Preserve unreadable local metadata. */ }
  if (!attempt?.failure || !saved) return null;
  const unknown = ['RetryExpired', 'UnknownAdmission', 'OutcomeUnknown'].includes(attempt.failure);
  const refresh = async () => {
    const { data, error } = await getSupabase().from('shopping_list')
      .select('document,content_revision,shopping_clear_undo_available').eq('user_id', owner).maybeSingle()
      // PostgREST computed fields are not columns in generated table types.
      .overrideTypes<{ document: unknown; content_revision: number; shopping_clear_undo_available: boolean } | null, { merge: false }>();
    if (error || getActivePrincipalId() !== owner) throw new Error('Could not verify the saved list. Try again.');
    const result = readShoppingCompatibility(data?.document ?? createEmptyShoppingDocument(), data?.content_revision ?? 0);
    if (result.status !== 'Supported') throw new Error(shoppingOutcomeMessage('UnsupportedDocument'));
    const next: ShoppingCachedState = { ...result.state,
      clearUndoAvailable: data?.shopping_clear_undo_available };
    client.setQueryData<ShoppingDocumentStateV3>(shoppingKeys.detail(owner), (current) =>
      reconcileShoppingState(current, next));
    await client.invalidateQueries({ queryKey: pantryKeys.list(owner) });
  };
  const act = async (action: 'retry' | 'review' | 'acknowledge') => {
    setBusy(true);
    try {
      if (action === 'retry') {
        const result = await executeShoppingCommand(owner, attempt!.command);
        await refresh();
        toast.show({ message: result.status === 'AlreadyApplied' ? 'The earlier Shopping result was confirmed.' : 'Shopping change saved.' });
      } else if (action === 'review') {
        await refresh(); setReviewed(saved);
      } else {
        acknowledgeUnknownShoppingAttempt(owner, saved);
        toast.show({ message: 'You can now make a new Shopping change.' });
      }
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : 'Could not resolve the Shopping change.' });
    } finally { setBusy(false); }
  };
  return { attempt, unknown, busy, reviewed: reviewed === saved, act };
}
