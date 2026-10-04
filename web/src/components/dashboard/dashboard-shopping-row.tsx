import { useId } from 'react';
import { ShoppingSources } from '@/components/shopping/shopping-list-components';
import { ShoppingPurchaseAmount } from '@/components/shopping/shopping-purchase-presentation';
import {
  shoppingPurchaseDisplayName,
} from '@/lib/shopping-quantity-display';
import type { ShoppingItem } from '@/types/database';

export function DashboardShoppingRow({ item, onCheckOff }: {
  item: ShoppingItem;
  onCheckOff: (item: ShoppingItem) => void;
}) {
  const checkboxId = useId();
  const hasRecipeSources = item.sources?.some(source => !!source.recipeId) ||
    item.requirementBreakdown?.some(part => !!part.source?.recipeId);

  return (
    <div className="dashboard-shopping-row">
      <label className="dashboard-shopping-check" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={!!item.checked}
          onChange={() => onCheckOff(item)}
          aria-label={`Check off ${item.item}`}
        />
      </label>
      <div className="dashboard-shopping-content">
        <label className="dashboard-shopping-name" htmlFor={checkboxId}>
          <span className={item.checked ? 'line-through' : ''}>
            <ShoppingPurchaseAmount item={item} />
            {shoppingPurchaseDisplayName(item).replace(/ \(estimate\)$/, '')}
          </span>
        </label>
        {hasRecipeSources && <ShoppingSources item={item} inline />}
      </div>
    </div>
  );
}
