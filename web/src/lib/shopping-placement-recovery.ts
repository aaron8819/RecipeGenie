import type { ShoppingDocumentV3 } from './shopping-document';
import { canonicalShoppingPayload } from './shopping-command';
import { SHOPPING_IDENTITY_POLICY } from './shopping-initialization';
import { SHOPPING_CATEGORIES } from './shopping-categories';

/** Detection is read-only. A default is never proof that a user did not move.
 * Only reconstructed source/envelope evidence can identify the old discrepancy.
 * Explicit overrides and resolved evidence are authoritative, including resets
 * after resolution. Source versions are selection versions, NOT move versions.
 */
export function shoppingPlacementRecoveryCandidates(document: ShoppingDocumentV3) {
  const candidates: Record<string, { categories: string[]; complete: boolean }> = {};
  if (document.schemaVersion !== 4 || !document.placementEvidence) return candidates;
  for (const [key, pinned] of Object.entries(document.placementEvidence.defaults)) {
    if (pinned.policyVersion !== SHOPPING_IDENTITY_POLICY ||
      Object.hasOwn(document.preferences.categoryByIngredient, key) ||
      document.placementEvidence.unresolved[key] || document.placementEvidence.resolved[key]) continue;
    const categories = new Set<string>();
    let complete = true;
    for (const entry of Object.values(document.recipeEntries)) {
      const ingredients = entry.ingredients.filter(i => i.purchaseKey === key);
      if (!ingredients.length) continue;
      const source = entry.sourceEvidence;
      if (source?.history !== 'reconstructed') { complete = false; continue; }
      const { sourceEvidence: _source, ...original } = entry;
      if (source.version !== 0 || canonicalShoppingPayload(source.originalEntry) !== canonicalShoppingPayload(original) ||
        canonicalShoppingPayload(source.occurrences.map(o => o.raw)) !== canonicalShoppingPayload(entry.ingredients)) complete = false;
      for (const i of ingredients) categories.add(i.defaultCategoryKey);
      const originalIngredients = source.originalEntry?.ingredients;
      const retained = [...(Array.isArray(originalIngredients) ? originalIngredients : []), ...source.occurrences.map(o => o.raw)];
      for (const i of retained) {
        if (i && typeof i === 'object' && 'purchaseKey' in i && i.purchaseKey === key &&
          'defaultCategoryKey' in i && typeof i.defaultCategoryKey === 'string' && i.defaultCategoryKey.trim()) categories.add(i.defaultCategoryKey);
      }
    }
    for (const item of document.manualItems) {
      if (item.identity?.purchaseKey !== key) continue;
      const legacy = item.identity.legacy ?? item.identity.conversion;
      if (!legacy) { complete = false; continue; }
      legacy.categoryEvidence.forEach(category => categories.add(category));
      // Manual-only placement was not established by the defective initializer.
      // Converted/edited envelopes cannot prove an untouched initialization.
      if (item.identity.version !== 0 || item.identity.meaning !== 'legacyIndependent') complete = false;
    }
    if ([...categories].some(category => category !== pinned.categoryKey)) candidates[key] = { categories: [...categories], complete };
  }
  return candidates;
}

/** Explicit command only; the caller binds the current document revision.
 * SQL proves lastWriteWasInitialization from a hash-bound Applied receipt at
 * exactly that revision. Missing/pruned receipts and all later writes fail shut.
 * The existing resolved/unresolved archive is the durable, per-purchase marker.
 */
export function recoverShoppingPlacement(document: ShoppingDocumentV3, lastWriteWasInitialization: boolean) {
  const candidates = shoppingPlacementRecoveryCandidates(document);
  if (!Object.keys(candidates).length) return document;
  const next = structuredClone(document);
  const evidence = next.placementEvidence!;
  const categories = new Set([...Object.keys(SHOPPING_CATEGORIES), ...document.preferences.customCategories.map(c => `custom_${c.id}`)]);
  // Process in retained sequence order, preserving relative order within each
  // generated sequence. Never derive slots from visible rows (hidden keys count).
  const keys = Object.values(document.preferences.ingredientOrderByCategory).flat().filter(key => candidates[key]);
  for (const key of keys) {
    const candidate = candidates[key];
    const current = evidence.defaults[key].categoryKey;
    const destination = candidate.categories[0];
    const sequences = Object.fromEntries(Object.entries(document.preferences.ingredientOrderByCategory)
      .filter(([, sequence]) => sequence.includes(key)).map(([category, sequence]) => [category, [...sequence]]));
    const retained = { categories: [...new Set([current, ...candidate.categories])], sequences };
    // A populated destination may carry a relative anchor that was never kept.
    // Do not invent its interleaving with recovered keys.
    const origins = new Set(keys.filter(k => candidates[k].categories.includes(destination))
      .map(k => document.placementEvidence!.defaults[k].categoryKey));
    const safe = lastWriteWasInitialization && candidate.complete && candidate.categories.length === 1 &&
      categories.has(destination) && origins.size === 1 && !(document.preferences.ingredientOrderByCategory[destination]?.length);
    for (const sequence of Object.values(next.preferences.ingredientOrderByCategory)) {
      const index = sequence.indexOf(key);
      if (index >= 0) sequence.splice(index, 1);
    }
    if (safe) {
      next.preferences.categoryByIngredient[key] = destination;
      (next.preferences.ingredientOrderByCategory[destination] ??= []).push(key);
      evidence.resolved[key] = retained;
    } else {
      evidence.unresolved[key] = retained;
      delete evidence.defaults[key];
    }
  }
  return next;
}
