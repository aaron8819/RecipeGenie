'use client';

import type { ShoppingItem } from '@/types/database';
import { formatShoppingPurchaseAmount, shoppingPurchaseDisplayName } from '@/lib/shopping-quantity-display';
import { shoppingSourceControls, isManualShoppingItem } from '@/lib/shopping-sources';

/** Display-only: quantities and identity remain owned by the Shopping projector. */
export function ShoppingPurchaseAmount({ item }: { item: ShoppingItem }) {
  const amount = formatShoppingPurchaseAmount(item);
  if (!amount) return null;
  const estimated = shoppingPurchaseDisplayName(item).endsWith(' (estimate)');
  return <span className="shopping-purchase-amount">
    {amount}
    {estimated && <small>estimate</small>}
  </span>;
}

export function ShoppingSourceHint({ item }: { item: ShoppingItem }) {
  const sources = shoppingSourceControls(item);
  const recipes = sources.filter(source => !source.manualId);
  const manual = isManualShoppingItem(item) || sources.some(source => !!source.manualId);
  return <span className="shopping-source-hint">
    {recipes.length ? `${recipes.length} recipe${recipes.length === 1 ? '' : 's'}${manual ? ' + extra' : ''}` : 'Added manually'}
  </span>;
}
