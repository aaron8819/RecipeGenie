import { reconstructShoppingEntry } from './shopping-selection';
import {
  applyShoppingDocumentMutation, createEmptyShoppingDocument, includeReviewedShoppingIngredients,
  projectShoppingDocument, validateShoppingDocumentV3,
  type ShoppingDocumentStateV3, type ShoppingDocumentV3,
} from './shopping-document';
import { readShoppingCompatibility } from './shopping-compatibility';
import { validateManualPurchaseIntent } from './shopping-manual-rules';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';
import { mapRecipeRows } from './recipe-identity';
import { canonicalShoppingPayload, type ShoppingCommand } from './shopping-command';
import { settingValue } from './shopping-settings';
import type { PantryItem } from '@/types/database';
import { isShoppingContentCommand } from './shopping-lifecycle';
import { canUndoShoppingClear } from './shopping-clear';
import { planInitializedShoppingCommand } from './shopping-initialized-command';

export interface ShoppingCommandContext {
  /** Service-only SQL evidence, never accepted from command/client input. */
  lastWriteWasInitialization?: boolean;
  status: string;
  row: { document: unknown; content_revision: number; shopping_clear_undo_available?: boolean; trip_id?: string; trip_revision?: number; content_epoch?: number } | null;
  dependencyRevision: string;
  pantry: PantryItem[];
  recipes: unknown[];
  inverse: Pick<ShoppingDocumentV3, 'recipeEntries' | 'manualItems' | 'itemOverrides' | 'acknowledgements' | 'tripVisibility'> | null;
  inverseRevision: number | null;
  inverseTrip?: string | null;
  inverseEpoch?: number | null;
}

export function planShoppingCommand(context: ShoppingCommandContext, command: ShoppingCommand) {
  const read = context.row ? readShoppingCompatibility(context.row.document, context.row.content_revision) : null;
  const before: ShoppingDocumentStateV3 = read?.status === 'Supported' ? read.state :
    { document: createEmptyShoppingDocument(), contentRevision: 0 };
  const result = (outcome: string, document = before.document, pantryItem: string | null = null) =>
    ({ outcome, document, before, pantryItem });
  if (read && read.status !== 'Supported') return result('UnsupportedDocument');
  const intent = command.mutation;
  if (isShoppingContentCommand(intent.type) && !['undoClear', 'restoreContent'].includes(intent.type) &&
    ((command.tripId !== undefined && command.tripId !== context.row?.trip_id) ||
      ((context.row?.trip_revision ?? context.inverseRevision ?? 0) > command.observedRevision))) return result('TripEnded');
  if (intent.type === 'initialize' || before.document.schemaVersion === 4) {
    return planInitializedShoppingCommand(context, command, before.document);
  }
  if (intent.type === 'organize') return result('InvalidInput');
  const sameRevision = command.observedRevision === before.contentRevision;
  if (intent.type === 'complete' && command.clearUndoRequired !== undefined &&
    (!sameRevision || (command.clearUndoRequired &&
      !(context.row?.shopping_clear_undo_available ?? canUndoShoppingClear(before.document))))) {
    return result('Conflict');
  }
  // Only explicitly independent settings intents may rebase in V3. Target
  // field versions and the final organization command family arrive in Slice 9.
  if (!sameRevision && intent.type !== 'deleteRecipe' && !['complete', 'undoClear', 'restoreContent'].includes(intent.type)) {
    if (intent.type === 'addManualItem' || intent.type === 'editManualItem') {
      if ((context.inverseRevision ?? 0) > command.observedRevision) return result('Conflict');
      if (intent.type === 'editManualItem' && (!command.observedManual ||
        canonicalShoppingPayload(before.document.manualItems.find((item) => item.id === intent.id)) !==
        canonicalShoppingPayload(command.observedManual))) return result('Conflict');
    } else {
      if (intent.type !== 'setExclusion' && intent.type !== 'setFamilySetting') return result('Conflict');
      if (typeof command.observedSetting !== 'boolean' || command.observedSetting === intent.enabled ||
        (intent.type === 'setFamilySetting' && settingValue(before, intent) !== command.observedSetting)) return result('Conflict');
    }
  }
  const rows = projectShoppingDocument(before.document, context.pantry).rows;
  if (intent.type === 'deleteRecipe') {
    const recipes = mapRecipeRows(context.recipes as never);
    return result(recipes.some((r) => r.id === intent.recipeId) ? 'Applied' : 'TargetGone');
  }
  let bridgeMutation: import('./shopping-document').ShoppingDocumentMutation | undefined;
  let pantryItem: string | null = null;
  if (intent.type === 'pantry') {
    const row = rows.find((r) => r.rowRef === intent.rowRef);
    if (!row) return result('TargetGone');
    pantryItem = row.displayName;
    bridgeMutation = row.rowRef.startsWith('manual:')
      ? { type: 'editManualItem', id: row.rowRef.slice(7), changes: { bucket: 'already_have' } }
      : { type: 'setBucketOverride', aggregateKey: row.rowRef.slice(8) };
  }
  const mutation = intent.type === 'undoClear'
    ? { type: 'restoreContent' as const, content: context.inverse! }
    : bridgeMutation ?? intent;
  if (mutation.type === 'pantry') return result('InvalidInput');
  try {
    if (mutation.type === 'restoreContent') {
      if (!context.inverse || context.inverseRevision !== command.observedRevision || context.inverseTrip !== context.row?.trip_id ||
        context.inverseEpoch !== context.row?.content_epoch ||
        canonicalShoppingPayload(context.inverse) !== canonicalShoppingPayload(mutation.content)) return result('UndoUnavailable');

    }
    if (mutation.type === 'restoreContent' && Object.keys(context.inverse!.recipeEntries).some(id => !mapRecipeRows(context.recipes as never).some(recipe => recipe.id === id))) return result('SourceUnavailable');
    if (mutation.type === 'addManualItem' || mutation.type === 'editManualItem') {
      if (mutation.type === 'addManualItem' && before.document.manualItems.some((item) => item.id === mutation.item.id)) return result('Conflict');
      const existing = mutation.type === 'editManualItem'
        ? before.document.manualItems.find((item) => item.id === mutation.id) : undefined;
      if (mutation.type === 'editManualItem' && !existing) return result('TargetGone');
      const item = mutation.type === 'addManualItem' ? mutation.item : { ...existing!, ...mutation.changes };
      const semantics = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit });
      const outcome = validateManualPurchaseIntent(before.document, {
        type: mutation.type === 'addManualItem' ? 'add' : 'edit', rowRef: `manual:${item.id}`,
        purchaseKey: semantics.purchaseKey, pantryItems: context.pantry,
      });
      if (outcome !== 'Allowed') return result(outcome);
    }
    if (mutation.type === 'upsertRecipes' || mutation.type === 'upsertRecipe' || mutation.type === 'rescaleRecipe') {
      const entries = mutation.type === 'upsertRecipes' ? mutation.entries : [mutation.entry];
      if (!Array.isArray(entries) || entries.length > 100) return result('InvalidInput');
      const recipes = mapRecipeRows(context.recipes as never);
      if (command.sourceSelections && (command.sourceSelections.length !== entries.length || command.sourceSelections.some(s => !entries.some(e => e.recipeId === s.recipeId)))) return result('InvalidInput');
      for (const entry of entries) {
        const recipe = recipes.find((r) => r.id === entry.recipeId);
        if (!recipe) return result('TargetGone');
        const expected = reconstructShoppingEntry(recipe, entry, command.sourceSelections);
        if (canonicalShoppingPayload(expected) !== canonicalShoppingPayload(entry)) return result('Conflict');
      }
    }
    const refs = mutation.type === 'setCheckedMany' ? mutation.rowRefs :
      mutation.type === 'setChecked' ? [mutation.rowRef] : [];
    if (refs.some((ref) => !rows.some((row) => row.rowRef === ref))) return result('TargetGone');
    if (mutation.type === 'deleteManualItem' && !before.document.manualItems.some((i) => i.id === mutation.id)) return result('TargetGone');
    if (mutation.type === 'removeRecipe' && !before.document.recipeEntries[mutation.recipeId]) return result('TargetGone');
    if ((mutation.type === 'setBucketOverride' || mutation.type === 'setSuppressed') &&
      !Object.values(before.document.recipeEntries).some((e) => e.ingredients.some((i) => i.aggregateKey === mutation.aggregateKey))) return result('TargetGone');
    if (mutation.type === 'learnOrder' && (!rows.some((r) => r.rowRef === mutation.draggedRowRef && r.categoryKey === mutation.sourceCategoryKey && r.orderingKey === mutation.draggedOrderingKey) ||
      !rows.some((r) => r.rowRef === mutation.targetRowRef && r.categoryKey === mutation.targetCategoryKey && r.orderingKey === mutation.targetOrderingKey))) return result('Conflict');
    let next = applyShoppingDocumentMutation(before, mutation);
    if (command.sourceSelections && (mutation.type === 'upsertRecipe' ||
        mutation.type === 'upsertRecipes' || mutation.type === 'rescaleRecipe')) {
      next = { ...next, document: includeReviewedShoppingIngredients(next.document,
        mutation.type === 'upsertRecipes' ? mutation.entries : [mutation.entry]) };
    }
    const valid = validateShoppingDocumentV3(next.document);
    if (!valid.ok) return result('InvalidInput');
    return result(canonicalShoppingPayload(next.document) === canonicalShoppingPayload(before.document) &&
      !pantryItem ? 'Unchanged' : 'Applied', next.document, pantryItem);
  } catch {
    return result('InvalidInput');
  }
}
