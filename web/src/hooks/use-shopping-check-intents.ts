'use client';

import { useRef, useState } from 'react';
import { useCheckOffItem } from '@/hooks/use-shopping';
import { requireShoppingRowRef } from '@/lib/shopping-row-reference';
import type { ShoppingItem } from '@/types/database';

// Shared by the full list and Dashboard. Older writes cannot settle newer taps.
export function useShoppingCheckIntents() {
  const mutation = useCheckOffItem();
  const [pendingCheckIntents, setPending] = useState(
    new Map<string, { checked: boolean; version: number }>(),
  );
  const current = useRef(pendingCheckIntents);
  const version = useRef(0);

  function settle(rowRef: string, intentVersion: number) {
    if (current.current.get(rowRef)?.version !== intentVersion) return;
    const next = new Map(current.current);
    next.delete(rowRef);
    current.current = next;
    setPending(next);
  }

  function handleCheckOff(item: ShoppingItem) {
    const rowRef = requireShoppingRowRef(item, 'check-off');
    const checked = !(
      current.current.get(rowRef)?.checked ??
      item.checked ??
      false
    );
    const intentVersion = ++version.current;
    const next = new Map(current.current);
    next.set(rowRef, { checked, version: intentVersion });
    current.current = next;
    setPending(next);
    void mutation.mutateAsync({
      rowRef, checked,
      inspectedCoverage: item.inspectedCoverage,
      inspectedRevision: item.inspectedRevision,
    }).then(
      () => settle(rowRef, intentVersion),
      () => settle(rowRef, intentVersion),
    );
  }

  return { pendingCheckIntents, handleCheckOff };
}
