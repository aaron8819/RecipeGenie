import { applyShoppingDocumentMutation, type ShoppingDocumentStateV3 } from '@/lib/shopping-document';
import { validateSettingIntent, ShoppingSettingsConflictError } from '@/lib/shopping-settings';
import { validateManualPurchaseIntent } from '@/lib/shopping-manual-rules';
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics';
import { ShoppingDocumentConflictError } from '@/lib/shopping-document-persistence';
import type { ShoppingCommand } from '@/lib/shopping-command';
import { shoppingContent, type ShoppingContent } from '@/lib/shopping-clear';
import { canUndoShoppingClear } from '@/lib/shopping-clear';

export interface HookLifecycle { epoch: number; inverse?: { content: ShoppingContent; revision: number; epoch: number } }

/** Hook-only transport fixture. Database atomicity is tested in
 * scripts/test-shopping-protocol.ts, not claimed by this in-memory adapter. */
export async function runHookCommand(
  command: ShoppingCommand,
  read: () => ShoppingDocumentStateV3,
  write: (before: ShoppingDocumentStateV3, next: ShoppingDocumentStateV3) => Promise<boolean>,
  pantryItems: import('@/types/database').PantryItem[] = [],
  lifecycle?: HookLifecycle,
) {
  if (command.mutation.type === 'pantry' || command.mutation.type === 'deleteRecipe') throw new Error('Unexpected command');
  const mutation = command.mutation.type === 'undoClear'
    ? { type: 'restoreContent' as const, content: lifecycle?.inverse?.content ?? { recipeEntries: {}, manualItems: [], itemOverrides: {} } }
    : command.mutation;
  const observed = structuredClone(read());
  for (let i = 0; i < 2; i++) {
    const before = structuredClone(read());
    if (command.mutation.type === 'undoClear' && (!lifecycle?.inverse || lifecycle.inverse.revision !== command.observedRevision || lifecycle.inverse.epoch !== lifecycle.epoch)) throw new ShoppingDocumentConflictError();
    if (mutation.type === 'complete' && command.clearUndoRequired !== undefined &&
      before.contentRevision !== command.observedRevision) throw new ShoppingDocumentConflictError();
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
    if (command.mutation.type === 'restoreContent' && before.contentRevision !== command.observedRevision) throw new ShoppingDocumentConflictError();
    if (mutation.type === 'setExclusion' || mutation.type === 'setFamilySetting') validateSettingIntent(observed, before, mutation);
    const next = applyShoppingDocumentMutation(before, mutation);
    if (next === before && mutation.type !== 'restoreContent') return {
      status: 'Unchanged', receipt: { outcome: 'Unchanged', revision: before.contentRevision },
    };
    const nextEpoch = (lifecycle?.epoch ?? 0) + (JSON.stringify(shoppingContent(before.document)) === JSON.stringify(shoppingContent(next.document)) ? 0 : 1);
    if (await write(before, next)) {
      if (lifecycle && mutation.type === 'complete') lifecycle.inverse = { content: shoppingContent(before.document), revision: next.contentRevision, epoch: nextEpoch };
      if (lifecycle && mutation.type === 'restoreContent') lifecycle.inverse = undefined;
      return {
      status: 'Applied', before,
      receipt: { outcome: 'Applied', revision: next.contentRevision,
        undoAvailable: mutation.type === 'complete' && canUndoShoppingClear(before.document) },
    };
    }
  }
  throw new ShoppingDocumentConflictError();
}
