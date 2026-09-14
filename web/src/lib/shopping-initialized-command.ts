import { applyShoppingDocumentMutation, createShoppingRecipeEntry, projectShoppingDocument, validateShoppingDocumentV3,
  type ShoppingDocumentV3, type ShoppingManualItemV1 } from './shopping-document';
import { appendDocumentPurchases, initializeShoppingDocument, legacyQuantity, readInitializedDocument,
  SHOPPING_IDENTITY_POLICY, resolveShoppingPlacement } from './shopping-initialization';
import { canonicalShoppingPayload, type ShoppingCommand } from './shopping-command';
import { editLegacyIndependentNeed } from './shopping-target-legacy';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';
import { mapRecipeRows } from './recipe-identity';
import { splicePurchasePlacement, type PurchaseOrganization } from './shopping-target-order';
import { SHOPPING_CATEGORIES } from './shopping-categories';
import { shoppingInverseBytes } from './shopping-clear';
import type { ShoppingCommandContext } from './shopping-command-planner';

/** Runs only inside the admitted command planner. No clock, I/O or cache state. */
export function planInitializedShoppingCommand(context: ShoppingCommandContext, command: ShoppingCommand, document: ShoppingDocumentV3) {
  const revision = context.row?.content_revision ?? 0;
  const before = { document, contentRevision: revision };
  const result = (outcome: string, next = document, pantryItem: string | null = null) => ({ outcome, document: next, before, pantryItem });
  const mutation = command.mutation;
  const sameRevision = command.observedRevision === revision;
  const isSetting = mutation.type === 'setExclusion' || mutation.type === 'setFamilySetting';
  if (mutation.type === 'initialize') {
    if (document.schemaVersion === 4) return result('Unchanged');
    if (!sameRevision) return result('Conflict');
    const initialized = initializeShoppingDocument(document, projectShoppingDocument(document, context.pantry).rows.map(row => row.orderingKey), context.row?.document);
    return readInitializedDocument(initialized, validateShoppingDocumentV3) && shoppingInverseBytes(initialized) <= 4194304
      ? result('Applied', initialized) : result('InvalidInput');
  }
  if (document.schemaVersion !== 4) return result('InvalidInput');
  const recipes = mapRecipeRows(context.recipes as never);
  if (mutation.type === 'deleteRecipe') return result(recipes.some(r => r.id === mutation.recipeId) ? 'Applied' : 'TargetGone');
  const selectionIds = mutation.type === 'removeRecipe' ? [mutation.recipeId] :
    mutation.type === 'upsertRecipes' ? mutation.entries.map(entry => entry.recipeId) :
      mutation.type === 'upsertRecipe' || mutation.type === 'rescaleRecipe' ? [mutation.entry.recipeId] : [];
  // The revision binds older callers; explicit tokens also bind open editors
  // and queued removals even when their caller has fetched a newer revision.
  if (selectionIds.length && ((!sameRevision && !command.observedSelections) ||
    (command.observedSelections && selectionIds.some(id => !Object.hasOwn(command.observedSelections!, id) ||
      command.observedSelections![id] !== (document.recipeEntries[id]?.sourceEvidence?.version ?? null))))) return result('Conflict');
  if (!sameRevision && !isSetting && mutation.type !== 'complete') {
    if ((context.inverseRevision ?? 0) > command.observedRevision) return result('Conflict');
    if (mutation.type === 'editManualItem') {
      if (!command.observedManual || canonicalShoppingPayload(document.manualItems.find(item => item.id === mutation.id)) !==
        canonicalShoppingPayload(command.observedManual)) return result('Conflict');
    } else if (!selectionIds.length && !['addManualItem', 'resolveLegacy', 'rebindManualItem', 'restoreManualItem'].includes(mutation.type)) return result('Conflict');
  }
  let next = structuredClone(document);
  let pantryItem: string | null = null;
  try {
    if (mutation.type === 'resolvePlacement') {
      if (!sameRevision) return result('Conflict');
      if (!next.placementEvidence!.unresolved[mutation.purchaseKey]) return result('TargetGone');
      next = resolveShoppingPlacement(next, mutation.purchaseKey, mutation.categoryKey, mutation.anchor);
    } else if (mutation.type === 'addManualItem') {
      if (document.manualItems.some(item => item.id === mutation.item.id)) return result('Conflict');
      const { identity: _untrustedIdentity, ...item } = mutation.item;
      const purchaseKey = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
      next.manualItems.push({ ...item, checked: false, identity: { purchaseKey, policyVersion: SHOPPING_IDENTITY_POLICY,
        version: 0, meaning: item.quantity === null ? 'reminder' : 'extra' } });
      next = appendDocumentPurchases(next, [purchaseKey]);
    } else if (mutation.type === 'editManualItem' || mutation.type === 'rebindManualItem' || mutation.type === 'resolveLegacy' ||
      mutation.type === 'deleteManualItem' || mutation.type === 'restoreManualItem') {
      const item = next.manualItems.find(item => item.id === mutation.id);
      if (!item || !item.identity || (item.identity.removed && mutation.type !== 'restoreManualItem')) return result('TargetGone');
      if ('expectedVersion' in mutation && mutation.expectedVersion !== item.identity.version) return result('Conflict');
      const originalItem = canonicalShoppingPayload(item);
      if (mutation.type === 'deleteManualItem') item.identity.removed = true;
      else if (mutation.type === 'restoreManualItem') {
        if (!item.identity.removed) return result('Unchanged');
        delete item.identity.removed;
      } else if (mutation.type === 'editManualItem') {
        const changes = mutation.changes;
        if ('identity' in changes || 'categoryKey' in changes) return result('InvalidInput');
        if (item.identity.meaning === 'legacyIndependent') {
          const edit = editLegacyIndependentNeed(item.identity.legacy!, item.identity.legacy!.version, {
            ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
            ...(changes.quantity !== undefined ? { quantity: legacyQuantity(changes.quantity) } : {}),
            ...(changes.checked !== undefined ? { previousChecked: changes.checked } : {}),
          });
          if (!('need' in edit)) return result(edit.status);
          item.identity.legacy = edit.need;
        } else if (changes.displayName !== undefined && changes.displayName !== item.displayName &&
          resolveShoppingIngredientSemantics({ item: changes.displayName, unit: changes.quantity?.unit ?? item.quantity?.unit }).purchaseKey !== item.identity.purchaseKey) {
          return result('Conflict'); // Identity changes require a previewed rebind.
        }
        Object.assign(item, changes);
        if (item.identity.meaning !== 'legacyIndependent') item.identity.meaning = item.quantity === null ? 'reminder' : 'extra';
      } else if (mutation.type === 'rebindManualItem') {
        if (item.identity.meaning === 'legacyIndependent') return result('InvalidInput');
        item.displayName = mutation.displayName; item.quantity = mutation.quantity;
        item.identity.purchaseKey = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
        item.identity.policyVersion = SHOPPING_IDENTITY_POLICY;
        item.identity.meaning = item.quantity === null ? 'reminder' : 'extra';
        next = appendDocumentPurchases(next, [item.identity.purchaseKey]);
      } else {
        if (!sameRevision || item.identity.meaning !== 'legacyIndependent') return result('Conflict');
        if (mutation.choice === 'extra' && canonicalShoppingPayload(mutation.quantity) !== canonicalShoppingPayload(item.quantity)) return result('InvalidInput');
        if (mutation.choice === 'reminder' && mutation.quantity !== null) return result('InvalidInput');
        if (mutation.choice === 'total' && mutation.quantity === null) return result('InvalidInput');
        const purchaseKey = resolveShoppingIngredientSemantics({ item: mutation.purchaseName, unit: mutation.quantity?.unit }).purchaseKey;
        item.identity.conversion = structuredClone(item.identity.legacy!);
        delete item.identity.legacy;
        item.identity.meaning = mutation.quantity === null ? 'reminder' : 'extra';
        item.identity.purchaseKey = purchaseKey;
        item.displayName = mutation.purchaseName; item.quantity = mutation.quantity; item.checked = false;
        next = resolveShoppingPlacement(next, purchaseKey, mutation.categoryKey, mutation.anchor);
      }
      const updatedItem = next.manualItems.find(candidate => candidate.id === mutation.id)!;
      if (originalItem !== canonicalShoppingPayload(updatedItem)) updatedItem.identity!.version++;
    } else if (mutation.type === 'upsertRecipe' || mutation.type === 'upsertRecipes' || mutation.type === 'rescaleRecipe') {
      const entries = mutation.type === 'upsertRecipes' ? mutation.entries : [mutation.entry];
      if (!Array.isArray(entries) || entries.length > 100 || new Set(entries.map(entry => entry.recipeId)).size !== entries.length) return result('InvalidInput');
      const keys: string[] = [];
      for (const entry of entries) {
        const recipe = recipes.find(recipe => recipe.id === entry.recipeId);
        if (!recipe) return result('TargetGone');
        const expected = createShoppingRecipeEntry(recipe, entry.selectedServings, entry.scaleV1);
        const { sourceEvidence: _provided, ...payload } = entry;
        if (canonicalShoppingPayload(expected) !== canonicalShoppingPayload(payload)) return result('Conflict');
        const old = document.recipeEntries[entry.recipeId];
        let ordinal = 0;
        const sourceEvidence = {
          version: old?.sourceEvidence?.version ?? revision + 1, history: 'captured' as const, sourceRevision: recipe.updated_at,
          yieldEvidence: { servings: recipe.servings, metadata: recipe.yield_metadata ?? null },
          occurrences: recipe.ingredientSections.flatMap((section, sectionIndex) => section.ingredients.map((ingredient, index) => ({
            id: `capture:${recipe.id}:${recipe.updated_at}:${sectionIndex}:${index}`, section: section.label,
            ordinal: ordinal++, raw: structuredClone(ingredient),
          }))),
        };
        const captured = { ...expected, sourceEvidence };
        // The owner revision survives removal and Clear. Mint from it, never
        // from a counter that disappears with the selection (including ABA).
        if (old && canonicalShoppingPayload(captured) !== canonicalShoppingPayload(old)) {
          sourceEvidence.version = Math.max(revision + 1, sourceEvidence.version + 1);
        }
        next.recipeEntries[entry.recipeId] = captured;
        keys.push(...entry.ingredients.map(ingredient => ingredient.purchaseKey));
      }
      next = appendDocumentPurchases(next, keys);
    } else if (mutation.type === 'complete') {
      if (command.clearUndoRequired !== undefined && (!sameRevision ||
        (command.clearUndoRequired && context.row?.shopping_clear_undo_available !== true))) return result('Conflict');
      next.recipeEntries = {}; next.manualItems = []; next.itemOverrides = {};
    } else if (mutation.type === 'restoreContent' || mutation.type === 'undoClear') {
      if (!sameRevision || !context.inverse || context.inverseRevision !== revision || Object.keys(context.inverse.recipeEntries).length) return result('UndoUnavailable');
      if (mutation.type === 'restoreContent' && canonicalShoppingPayload(mutation.content) !== canonicalShoppingPayload(context.inverse)) return result('UndoUnavailable');
      next = { ...next, ...structuredClone(context.inverse) };
    } else if (isSetting) {
      if (!sameRevision && (command.observedSetting === undefined || command.observedSetting === mutation.enabled ||
        (mutation.type === 'setFamilySetting' && document.preferences[mutation.setting] !== command.observedSetting))) return result('Conflict');
      next = applyShoppingDocumentMutation(before, mutation).document;
    } else if (mutation.type === 'removeRecipe') {
      if (!next.recipeEntries[mutation.recipeId]) return result('TargetGone');
      delete next.recipeEntries[mutation.recipeId];
    } else if (mutation.type === 'setChecked' || mutation.type === 'setCheckedMany') {
      const refs = mutation.type === 'setChecked' ? [mutation.rowRef] : mutation.rowRefs;
      // Only legacy independent check evidence is editable in this activation.
      // A new obtained-basis acknowledgement belongs to Slice 8.
      if (refs.some(ref => !next.manualItems.some(item => `manual:${item.id}` === ref && item.identity?.meaning === 'legacyIndependent' && !item.identity.removed))) return result('InvalidInput');
      for (const item of next.manualItems) if (refs.includes(`manual:${item.id}`) && item.checked !== mutation.checked) {
        item.checked = mutation.checked; item.identity!.legacy!.previousChecked = mutation.checked;
        item.identity!.version++; item.identity!.legacy!.version++;
      }
    } else if (mutation.type === 'setBucketOverride' || mutation.type === 'setSuppressed') {
      const row = projectShoppingDocument(next, context.pantry).rows.find(row => row.rowRef === `derived:${mutation.aggregateKey}`);
      if (!row) return result('TargetGone');
      const bucket = mutation.type === 'setSuppressed' ? mutation.suppressed ? 'excluded' : 'items' : mutation.bucket;
      for (const item of next.manualItems) if (item.identity?.purchaseKey === row.orderingKey && item.identity.meaning !== 'legacyIndependent') {
        if (item.bucket !== (bucket ?? 'items')) { item.bucket = bucket ?? 'items'; item.identity.version++; }
      }
      for (const entry of Object.values(next.recipeEntries)) for (const ingredient of entry.ingredients) if (ingredient.purchaseKey === row.orderingKey) {
        const override = { ...next.itemOverrides[ingredient.aggregateKey] };
        delete override.suppressed;
        if (bucket) override.bucket = bucket; else delete override.bucket;
        next.itemOverrides[ingredient.aggregateKey] = override;
      }
    } else if (mutation.type === 'pantry') {
      const row = projectShoppingDocument(next, context.pantry).rows.find(row => row.rowRef === mutation.rowRef);
      if (!row) return result('TargetGone');
      pantryItem = row.displayName;
      for (const item of next.manualItems) if (`manual:${item.id}` === mutation.rowRef || row.requirements?.some(part => part.manualId === item.id)) {
        if (item.bucket !== 'already_have') {
          item.bucket = 'already_have'; item.identity!.version++;
        }
      }
      for (const entry of Object.values(next.recipeEntries)) for (const ingredient of entry.ingredients) if (ingredient.purchaseKey === row.orderingKey) {
        next.itemOverrides[ingredient.aggregateKey] = { ...next.itemOverrides[ingredient.aggregateKey], bucket: 'already_have' };
      }
    } else if (mutation.type === 'learnOrder') {
      if (!sameRevision) return result('Conflict');
      const key = mutation.draggedOrderingKey;
      if (!next.placementEvidence!.defaults[key] || !next.placementEvidence!.defaults[mutation.targetOrderingKey]) return result('Conflict');
      const org: PurchaseOrganization = {
        categories: [...Object.keys(SHOPPING_CATEGORIES), ...next.preferences.customCategories.map(c => `custom_${c.id}`)],
        sequences: next.preferences.ingredientOrderByCategory,
        placements: Object.fromEntries(Object.entries(next.placementEvidence!.defaults).map(([k, p]) => [k, {
          categoryKey: next.preferences.categoryByIngredient[k] ?? p.categoryKey, defaultCategoryKey: p.categoryKey,
          policyVersion: p.policyVersion, version: 0,
          ...(next.preferences.categoryByIngredient[k] ? { userOverride: next.preferences.categoryByIngredient[k] } : {}),
        }])),
      };
      if (org.placements[key].categoryKey !== mutation.sourceCategoryKey || org.placements[mutation.targetOrderingKey].categoryKey !== mutation.targetCategoryKey) return result('Conflict');
      const moved = splicePurchasePlacement(org, { key, expectedVersion: 0, destination: {
        categoryKey: mutation.targetCategoryKey, at: mutation.placement, anchor: mutation.targetOrderingKey, anchorVersion: 0,
      } });
      if (!('organization' in moved)) return result(moved.status);
      next.preferences.ingredientOrderByCategory = moved.organization.sequences;
      next.preferences.categoryByIngredient[key] = mutation.targetCategoryKey;
    } else if (mutation.type === 'updatePreferences' || mutation.type === 'updateCategoryPreferences') {
      // Keep independent labels/settings operable. Replacement organization
      // writes cannot reconstruct or erase saved slots; full controls are Slice 9.
      if (!sameRevision) return result('Conflict');
      for (const key of ['ingredientOrderByCategory'] as const) {
        if (key in mutation.preferences && canonicalShoppingPayload(mutation.preferences[key]) !== canonicalShoppingPayload(document.preferences[key])) return result('Conflict');
      }
      const desiredOverrides = mutation.preferences.categoryByIngredient ?? next.preferences.categoryByIngredient;
      const desiredCategories = mutation.preferences.customCategories ?? next.preferences.customCategories;
      const deleted = next.preferences.customCategories.filter(c => !desiredCategories.some(other => other.id === c.id)).map(c => `custom_${c.id}`);
      next.preferences = { ...next.preferences, ...mutation.preferences, categoryByIngredient: { ...next.preferences.categoryByIngredient } };
      // Preserve the existing category controls under a strict revision fence.
      // Never rebuild hidden/dormant positions from projected rows.
      for (const category of deleted) {
        for (const key of document.preferences.ingredientOrderByCategory[category] ?? []) {
          next.preferences.categoryByIngredient[key] = 'misc';
          next.preferences.ingredientOrderByCategory.misc = [...(next.preferences.ingredientOrderByCategory.misc ?? []), key];
        }
        delete next.preferences.ingredientOrderByCategory[category];
        next.preferences.categoryOrder = next.preferences.categoryOrder.filter(key => key !== category);
        for (const item of next.manualItems) if (item.identity?.meaning === 'legacyIndependent' && item.categoryKey === category) item.categoryKey = 'misc';
      }
      for (const key of new Set([...Object.keys(document.preferences.categoryByIngredient), ...Object.keys(desiredOverrides)])) {
        if (!next.placementEvidence!.defaults[key]) {
          if (desiredOverrides[key] !== document.preferences.categoryByIngredient[key]) return result('Conflict');
          continue;
        }
        if (deleted.includes(document.preferences.categoryByIngredient[key])) continue;
        if (desiredOverrides[key] !== document.preferences.categoryByIngredient[key]) {
          next = resolveShoppingPlacement(next, key, desiredOverrides[key] ?? '@default', null);
        }
      }
    } else return result('InvalidInput');
    // Overrides belong to live recipe atoms. Keep shared atoms' overrides and
    // all purchase placement, but retire overrides for removed/replaced atoms.
    if (selectionIds.length) {
      const active = new Set(Object.values(next.recipeEntries).flatMap(entry => entry.ingredients.map(i => i.aggregateKey)));
      next.itemOverrides = Object.fromEntries(Object.entries(next.itemOverrides).filter(([key]) => active.has(key)));
    }
    if (!readInitializedDocument(next, validateShoppingDocumentV3) || shoppingInverseBytes(next) > 4194304) return result('InvalidInput');
    return result(canonicalShoppingPayload(next) === canonicalShoppingPayload(document) && !pantryItem ? 'Unchanged' : 'Applied', next, pantryItem);
  } catch { return result('InvalidInput'); }
}
