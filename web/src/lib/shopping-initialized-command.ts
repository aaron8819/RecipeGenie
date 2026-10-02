import { reconstructShoppingEntry } from './shopping-selection';
import { applyOrganization, inspectOrganization, organizationVersion, purchaseOrganization } from './shopping-organization';
import { shoppingRowCoverage } from './shopping-coverage-runtime';
import { planShoppingAcknowledgement } from './shopping-coverage';
import { applyShoppingDocumentMutation, projectShoppingDocument, validateShoppingDocumentV3,
  type ShoppingDocumentV3, type ShoppingManualItemV1 } from './shopping-document';
import { appendDocumentPurchases, initializeShoppingDocument, legacyQuantity, readInitializedDocument,
  SHOPPING_IDENTITY_POLICY, resolveShoppingPlacement } from './shopping-initialization';
import { canonicalShoppingPayload, type ShoppingCommand } from './shopping-command';
import { editLegacyIndependentNeed } from './shopping-target-legacy';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';
import { mapRecipeRows } from './recipe-identity';
import { shoppingInverseBytes } from './shopping-clear';
import type { ShoppingCommandContext } from './shopping-command-planner';
import { restoredShoppingContent } from './shopping-lifecycle';
import { recoverShoppingPlacement } from './shopping-placement-recovery';
import { advanceManualFieldVersions, manualEditMatches } from './shopping-manual-versions';
import { recoverTripVisibility } from './shopping-trip-visibility';

/** Runs only inside the admitted command planner. No clock, I/O or cache state. */
export function planInitializedShoppingCommand(context: ShoppingCommandContext, command: ShoppingCommand, document: ShoppingDocumentV3) {
  const revision = context.row?.content_revision ?? 0;
  const before = { document, contentRevision: revision };
  const result = (outcome: string, next = document, pantryItem: string | null = null) => ({ outcome, document: next, before, pantryItem });
  const mutation = command.mutation;
  const sameRevision = command.observedRevision === revision;
  const isSetting = mutation.type === 'setExclusion' || mutation.type === 'setFamilySetting';
  if (mutation.type === 'initialize') {
    if (!sameRevision) return result('Conflict');
    const initialized = document.schemaVersion === 4
      ? recoverShoppingPlacement(document, context.lastWriteWasInitialization === true)
      : initializeShoppingDocument(document, projectShoppingDocument(document, context.pantry).rows.map(row => row.orderingKey), context.row?.document);
    if (initialized === document) return result('Unchanged');
    return readInitializedDocument(initialized, validateShoppingDocumentV3) && shoppingInverseBytes(initialized) <= 4194304
      ? result('Applied', initialized) : result('InvalidInput');
  }
  if (document.schemaVersion !== 4) return result('InvalidInput');
  if (mutation.type === 'organize') {
    try {
      const planned = applyOrganization(document, mutation);
      if (!('document' in planned)) return result(planned.status);
      if (!readInitializedDocument(planned.document, validateShoppingDocumentV3) || shoppingInverseBytes(planned.document) > 4194304) return result('InvalidInput');
      return result('Applied', planned.document);
    } catch { return result('InvalidInput'); }
  }
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
  if (!sameRevision && !isSetting && !['complete', 'undoClear', 'restoreContent', 'setChecked', 'setCheckedMany'].includes(mutation.type)) {
    if ((context.inverseRevision ?? 0) > command.observedRevision) return result('Conflict');
    if (mutation.type === 'editManualItem') {
      if (!command.observedManual) return result('Conflict');
    } else if (!selectionIds.length && !['addManualItem', 'resolveLegacy', 'rebindManualItem', 'restoreManualItem'].includes(mutation.type)) return result('Conflict');
  }
  let next = structuredClone(recoverTripVisibility(document));
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
      let visibilityChanged = false;
      if (mutation.type === 'deleteManualItem') item.identity.removed = true;
      else if (mutation.type === 'restoreManualItem') {
        if (!item.identity.removed) return result('Unchanged');
        delete item.identity.removed;
      } else if (mutation.type === 'editManualItem') {
        const changes = mutation.changes;
        if (command.observedManual && !manualEditMatches(item, command.observedManual, mutation)) return result('Conflict');
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
        if (changes.bucket !== undefined && item.identity.meaning !== 'legacyIndependent') {
          visibilityChanged = (next.tripVisibility?.[item.identity.purchaseKey] ?? document.manualItems.find(i => i.id === item.id)!.bucket) !== changes.bucket;
          for (const other of next.manualItems) {
            if (other.id !== item.id && other.identity?.meaning !== 'legacyIndependent' && other.identity?.purchaseKey === item.identity.purchaseKey &&
                (visibilityChanged || other.bucket !== changes.bucket)) {
              other.bucket = changes.bucket; other.identity.version++;
            }
          }
          next.tripVisibility = { ...next.tripVisibility, [item.identity.purchaseKey]: changes.bucket };
        }
        if (item.identity.meaning !== 'legacyIndependent') item.identity.meaning = item.quantity === null ? 'reminder' : 'extra';
      } else if (mutation.type === 'rebindManualItem') {
        if (item.identity.meaning === 'legacyIndependent') return result('InvalidInput');
        item.displayName = mutation.displayName; item.quantity = mutation.quantity;
        item.identity.purchaseKey = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
        item.bucket = next.tripVisibility?.[item.identity.purchaseKey] ?? 'items';
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
      if (visibilityChanged || originalItem !== canonicalShoppingPayload(updatedItem)) updatedItem.identity!.version++;
    } else if (mutation.type === 'upsertRecipe' || mutation.type === 'upsertRecipes' || mutation.type === 'rescaleRecipe') {
      const entries = mutation.type === 'upsertRecipes' ? mutation.entries : [mutation.entry];
      if (!Array.isArray(entries) || entries.length > 100 || new Set(entries.map(entry => entry.recipeId)).size !== entries.length) return result('InvalidInput');
      if (command.sourceSelections && (command.sourceSelections.length !== entries.length || command.sourceSelections.some(s => !entries.some(e => e.recipeId === s.recipeId)))) return result('InvalidInput');
      const keys: string[] = [];
      for (const entry of entries) {
        const recipe = recipes.find(recipe => recipe.id === entry.recipeId);
        if (!recipe) return result('TargetGone');
        const expected = reconstructShoppingEntry(recipe, entry, command.sourceSelections);
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
        const selected = command.sourceSelections?.find(selection => selection.recipeId === recipe.id);
        if (selected) {
          const ordinals = new Set(selected.ingredientOrdinals);
          sourceEvidence.occurrences = sourceEvidence.occurrences.filter(source => ordinals.has(source.ordinal));
        }
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
      if (next.acknowledgements) next.acknowledgements = {};
      if (next.tripVisibility) next.tripVisibility = {};
    } else if (mutation.type === 'restoreContent' || mutation.type === 'undoClear') {
      if (!context.inverse || context.inverseRevision !== command.observedRevision ||
        context.inverseTrip !== context.row?.trip_id || context.inverseEpoch !== context.row?.content_epoch) return result('UndoUnavailable');
      if (Object.keys(context.inverse.recipeEntries).some(id => !recipes.some(recipe => recipe.id === id))) return result('SourceUnavailable');
      if (mutation.type === 'restoreContent' && canonicalShoppingPayload(mutation.content) !== canonicalShoppingPayload(context.inverse)) return result('UndoUnavailable');
      next = restoredShoppingContent(next, context.inverse);
    } else if (isSetting) {
      const field = mutation.type === 'setExclusion' ? `exclusion:${mutation.key}` : `setting:${mutation.setting}`;
      if (command.observedSettingVersion !== undefined && command.observedSettingVersion !== organizationVersion(document, field)) return result('Conflict');
      if (command.observedSettingVersion === undefined && !sameRevision && (command.observedSetting === undefined || command.observedSetting === mutation.enabled ||
        (mutation.type === 'setFamilySetting' && document.preferences[mutation.setting] !== command.observedSetting))) return result('Conflict');
      next = applyShoppingDocumentMutation(before, mutation).document;
      if (canonicalShoppingPayload(next) !== canonicalShoppingPayload(document)) next = { ...next,
        organizationVersions: { ...document.organizationVersions, [field]: organizationVersion(document, field) + 1 } };
    } else if (mutation.type === 'removeRecipe') {
      if (!next.recipeEntries[mutation.recipeId]) return result('TargetGone');
      delete next.recipeEntries[mutation.recipeId];
    } else if (mutation.type === 'setChecked' || mutation.type === 'setCheckedMany') {
      const refs = mutation.type === 'setChecked' ? [mutation.rowRef] : mutation.rowRefs;
      const rows = projectShoppingDocument(document, context.pantry).rows;
      for (const ref of refs) {
        const row = rows.find(row => row.rowRef === ref);
        if (!row || row.bucket !== 'items') return result('TargetGone');
        if (row.legacy) {
          if (!sameRevision) return result('Conflict');
          const item = next.manualItems.find(item => `manual:${item.id}` === ref)!;
          if (item.checked !== mutation.checked) {
            item.checked = mutation.checked; item.identity!.legacy!.previousChecked = mutation.checked;
            item.identity!.version++; item.identity!.legacy!.version++;
          }
          continue;
        }
        const inspected = command.inspectedCoverage?.[row.orderingKey];
        const current = document.acknowledgements?.[row.orderingKey];
        if (!inspected || inspected.version !== (current?.version ?? 0)) return result('Conflict');
        if (mutation.checked) {
          if (!inspected.basis) return result('InvalidInput');
          const planned = planShoppingAcknowledgement({ expectedVersion: inspected.version, currentVersion: current?.version ?? 0,
            inspected: inspected.basis, current: shoppingRowCoverage(row), availability: 'available' });
          if (planned.status !== 'Checked') return result(planned.status);
          next.acknowledgements = { ...next.acknowledgements, [row.orderingKey]: { version: revision + 1, basis: planned.obtained } };
        } else if (current?.basis) {
          next.acknowledgements = { ...next.acknowledgements, [row.orderingKey]: { version: revision + 1, basis: null } };
        }
      }
    } else if (mutation.type === 'setBucketOverride' || mutation.type === 'setSuppressed') {
      const row = projectShoppingDocument(next, context.pantry).rows.find(row => row.rowRef === `derived:${mutation.aggregateKey}`);
      if (!row) return result('TargetGone');
      const bucket = mutation.type === 'setSuppressed' ? mutation.suppressed ? 'excluded' : 'items' : mutation.bucket;
      const previousBucket = next.tripVisibility?.[row.orderingKey];
      next.tripVisibility = { ...next.tripVisibility };
      if (bucket) next.tripVisibility[row.orderingKey] = bucket;
      else delete next.tripVisibility[row.orderingKey];
      for (const item of next.manualItems) if (item.identity?.purchaseKey === row.orderingKey && item.identity.meaning !== 'legacyIndependent') {
        if (item.bucket !== (bucket ?? 'items') || (previousBucket ?? item.bucket) !== (bucket ?? 'items')) {
          item.bucket = bucket ?? 'items'; item.identity.version++;
        }
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
      const previousBucket = next.tripVisibility?.[row.orderingKey];
      if (!row.legacy) next.tripVisibility = { ...next.tripVisibility, [row.orderingKey]: 'already_have' };
      for (const item of next.manualItems) if (`manual:${item.id}` === mutation.rowRef || row.requirements?.some(part => part.manualId === item.id)) {
        if (item.bucket !== 'already_have' || (previousBucket ?? item.bucket) !== 'already_have') {
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
      const org = purchaseOrganization(next);
      if (org.placements[key].categoryKey !== mutation.sourceCategoryKey || org.placements[mutation.targetOrderingKey].categoryKey !== mutation.targetCategoryKey) return result('Conflict');
      const moved = applyOrganization(next, inspectOrganization(next, { kind: 'move', key, destination: {
        categoryKey: mutation.targetCategoryKey, at: mutation.placement, anchor: mutation.targetOrderingKey,
        anchorVersion: org.placements[mutation.targetOrderingKey].version,
      } }));
      if (!('document' in moved)) return result(moved.status);
      next = moved.document;
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
    // Source-specific compatibility overrides may retire; purchase visibility
    // above belongs to the trip and survives absent recipe/manual demand.
    if (selectionIds.length) {
      const active = new Set(Object.values(next.recipeEntries).flatMap(entry => entry.ingredients.map(i => i.aggregateKey)));
      next.itemOverrides = Object.fromEntries(Object.entries(next.itemOverrides).filter(([key]) => active.has(key)));
    }
    if (canonicalShoppingPayload(next.preferences) !== canonicalShoppingPayload(document.preferences) && !isSetting && mutation.type !== 'learnOrder') {
      const versions = { ...next.organizationVersions };
      const bump = (field: string) => { versions[field] = organizationVersion(document, field) + 1; };
      for (const key of new Set([...next.preferences.excludedIngredientKeys, ...document.preferences.excludedIngredientKeys])) {
        if (next.preferences.excludedIngredientKeys.includes(key) !== document.preferences.excludedIngredientKeys.includes(key)) bump(`exclusion:${key}`);
      }
      for (const setting of ['excludeSaltVariants', 'excludeBlackPepperVariants'] as const) {
        if (next.preferences[setting] !== document.preferences[setting]) bump(`setting:${setting}`);
      }
      if (canonicalShoppingPayload(next.preferences.ingredientOrderByCategory) !== canonicalShoppingPayload(document.preferences.ingredientOrderByCategory) ||
          canonicalShoppingPayload(next.preferences.categoryByIngredient) !== canonicalShoppingPayload(document.preferences.categoryByIngredient)) {
        bump('purchases');
        // Legacy whole-map commands are revision-fenced; conservatively fence their inspected targets too.
        if (['updatePreferences', 'updateCategoryPreferences', 'resolvePlacement', 'resolveLegacy'].includes(mutation.type)) {
          for (const key of Object.keys(next.placementEvidence!.defaults)) bump(`purchase:${key}`);
        }
      }
      if (canonicalShoppingPayload(next.preferences.customCategories) !== canonicalShoppingPayload(document.preferences.customCategories)) {
        bump('categories');
        for (const c of [...next.preferences.customCategories, ...document.preferences.customCategories]) { bump(`category:custom_${c.id}`); bump(`label:custom_${c.id}`); }
      }
      if (canonicalShoppingPayload(next.preferences.categoryOrder) !== canonicalShoppingPayload(document.preferences.categoryOrder)) {
        bump('sections'); for (const key of next.preferences.categoryOrder) bump(`section:${key}`);
      }
      next.organizationVersions = versions;
    }
    const previousManuals = new Map(document.manualItems.map(item => [item.id, item]));
    for (const item of next.manualItems) {
      const previous = previousManuals.get(item.id);
      if (previous && canonicalShoppingPayload(previous) !== canonicalShoppingPayload(item)) {
        advanceManualFieldVersions(previous, item, mutation);
      }
    }
    if (!readInitializedDocument(next, validateShoppingDocumentV3) || shoppingInverseBytes(next) > 4194304) return result('InvalidInput');
    return result(canonicalShoppingPayload(next) === canonicalShoppingPayload(document) && !pantryItem ? 'Unchanged' : 'Applied', next, pantryItem);
  } catch { return result('InvalidInput'); }
}
