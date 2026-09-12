'use client';

import { useShoppingCommandRecovery } from '@/hooks/use-shopping-command-recovery';
import { shoppingOutcomeMessage } from '@/lib/shopping-command';
import { Button } from '@/components/ui/button';

export function ShoppingPendingCommand() {
  const recovery = useShoppingCommandRecovery();
  if (!recovery) return null;
  const { attempt, unknown, busy, reviewed, act } = recovery;  return <div role="status" className="mx-auto my-3 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4">
    <p>{shoppingOutcomeMessage(attempt.failure || 'OutcomeUnknown')}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void act('retry')}>Retry saved change</Button>
      {unknown && <Button variant="outline" disabled={busy} onClick={() => void act('review')}>Review saved list</Button>}
      {unknown && reviewed && <Button disabled={busy} onClick={() => void act('acknowledge')}>I reviewed the list; allow new changes</Button>}
    </div>
  </div>;
}
