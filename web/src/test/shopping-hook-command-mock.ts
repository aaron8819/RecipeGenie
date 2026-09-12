import { applyShoppingDocumentMutation, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { validateSettingIntent, ShoppingSettingsConflictError } from '@/lib/shopping-settings';
import { validateManualPurchaseIntent } from '@/lib/shopping-manual-rules';
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics';
import { ShoppingDocumentConflictError } from '@/lib/shopping-document-persistence';
import type { ShoppingCommand } from '@/lib/shopping-command';

/** Hook-only transport fixture. Database atomicity is tested in
 * scripts/test-shopping-protocol.ts, not claimed by this in-memory adapter. */
export async function runHookCommand(
  command: ShoppingCommand,
  read: () => ShoppingDocumentStateV3,
  write: (before: ShoppingDocumentStateV3, next: ShoppingDocumentStateV3) => Promise<boolean>,
  pantryItems: import('@/types/database').PantryItem[] = [],
) {
  if (command.mutation.type === 'pantry' || command.mutation.type === 'deleteRecipe') throw new Error('Unexpected command');
  const mutation = command.mutation;
  const observed = structuredClone(read());
  for (let i = 0; i < 2; i++) {
    const before = structuredClone(read());
    if ((mutation.type === 'updatePreferences' || mutation.type === 'updateCategoryPreferences') && before.contentRevision !== command.observedRevision) throw new ShoppingSettingsConflictError();
    if (mutation.type === 'addManualItem' || mutation.type === 'editManualItem') {
      const item = mutation.type === 'addManualItem' ? mutation.item : {
        ...before.document.manualItems.find((item) => item.id === mutation.id)!, ...mutation.changes,
      };
      const purchaseKey = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
      const outcome = validateManualPurchaseIntent(before.document, mutation.type === 'addManualItem'
        ? { type: 'add', rowRef: `manual:${item.id}`, purchaseKey, pantryItems }
        : { type: 'edit', rowRef: `manual:${item.id}`, purchaseKey });
      if (outcome !== 'Allowed') throw new Error('Item already in shopping list');
    }
    if (mutation.type === 'restoreContent' && before.contentRevision !== command.observedRevision) throw new ShoppingDocumentConflictError();
    if (mutation.type === 'setExclusion' || mutation.type === 'setFamilySetting') validateSettingIntent(observed, before, mutation);
    const next = applyShoppingDocumentMutation(before, mutation);
    if (next === before && mutation.type !== 'restoreContent') return {
      status: 'Unchanged', receipt: { outcome: 'Unchanged', revision: before.contentRevision },
    };
    if (await write(before, next)) return {
      status: 'Applied', before,
      receipt: { outcome: 'Applied', revision: next.contentRevision },
    };
  }
  throw new ShoppingDocumentConflictError();
}
