import { isShoppingCoverageBasis } from './shopping-coverage';
import type { ShoppingDocumentV3, ShoppingManualItemV1, ShoppingRecipeEntryV2 } from './shopping-document';
import type { LegacyIndependentNeed } from './shopping-target-legacy';
import { appendPurchasePlacements, canonicalPurchaseDefault, type PurchaseOrganization } from './shopping-target-order';
import { SHOPPING_CATEGORIES, getMatchedShoppingCategory } from './shopping-categories';
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics';
import { parseRationalLexeme } from './recipe-quantity';
import { isLegacyIndependentNeed } from './shopping-target-legacy';
import type { ShoppingQuantity } from '@/types/database';
import { compareShoppingText } from './shopping-ordering';

export const SHOPPING_IDENTITY_POLICY = 'shopping-identity-2026-09-11';

export interface FrozenManualIdentity {
  purchaseKey: string;
  policyVersion: string;
  version: number;
  meaning: 'extra' | 'reminder' | 'legacyIndependent';
  removed?: boolean;
  legacy?: LegacyIndependentNeed;
  conversion?: LegacyIndependentNeed;
}

export interface ShoppingInitialization {
  policyVersion: typeof SHOPPING_IDENTITY_POLICY;
  organization: PurchaseOrganization;
  manuals: Record<string, FrozenManualIdentity>;
  sources: Record<string, {
    version: number;
    history: 'reconstructed' | 'captured';
    sourceRevision: string | null;
    yieldEvidence: { servings: number; metadata: unknown } | null;
    originalEntry?: Record<string, unknown>;
    occurrences: { id: string; section: string | null; ordinal: number; raw: unknown }[];
  }>;
}

export interface ShoppingPlacementEvidence {
  defaults: Record<string, { categoryKey: string; policyVersion: string }>;
  unresolved: Record<string, { categories: string[]; sequences: Record<string, string[]> }>;
  resolved: Record<string, { categories: string[]; sequences: Record<string, string[]> }>;
}

export function pinnedPurchaseDefault(key: string) {
  const keyword = getMatchedShoppingCategory(key)?.[0] ?? 'misc';
  const semantic = resolveShoppingIngredientSemantics({ item: key, fallbackCategoryKey: keyword });
  return canonicalPurchaseDefault(key, {
    version: SHOPPING_IDENTITY_POLICY,
    semantic: { [key]: semantic.defaultCategoryKey }, keyword: {}, miscellaneous: 'misc',
  });
}

export function legacyQuantity(quantity: ShoppingQuantity | null) {
  if (quantity?.exactQuantityV1) return quantity.exactQuantityV1;
  if (quantity?.amount == null) return null;
  const value = parseRationalLexeme(String(quantity.amount));
  return value ? { version: 1 as const, kind: 'exact' as const, value,
    lexeme: String(quantity.amount), authored: String(quantity.amount),
    source: 'legacy-synthesized' as const } : null;
}

export function legacyManualEnvelope(item: ShoppingManualItemV1, document: ShoppingDocumentV3): LegacyIndependentNeed {
  const key = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
  return {
    kind: 'legacyIndependent', id: item.id, version: 0,
    raw: structuredClone(item) as unknown as Record<string, unknown>,
    displayName: item.displayName, quantity: legacyQuantity(item.quantity),
    categoryEvidence: [...new Set([item.categoryKey, document.preferences.categoryByIngredient[key]].filter(Boolean))],
    orderEvidence: Object.values(document.preferences.ingredientOrderByCategory).filter(sequence => sequence.includes(key)).map(sequence => [...sequence]),
    previousChecked: item.checked, sourceHistory: null,
    unresolvedReasons: [item.quantity ? 'amountMeaningUnavailable' : 'reminderUnconfirmed'],
  };
}

/** Explicit conversion planner. The caller must bind the observed revision.
 * Ambiguous slots are returned for a genuine destination choice, never picked.
 * No resolver runs on a later read of the initialized document.
 */
export function planShoppingInitialization(document: ShoppingDocumentV3, legacyDisplayKeys: string[]) {
  const categories = [...Object.keys(SHOPPING_CATEGORIES), ...document.preferences.customCategories.map(c => `custom_${c.id}`)];
  const organization: PurchaseOrganization = { categories, placements: {}, sequences: {} };
  const conflicts: Record<string, string[]> = {};
  const contentCategories = new Map<string, Set<string>>();
  for (const item of document.manualItems) {
    const key = resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey;
    const choices = contentCategories.get(key) ?? new Set<string>();
    choices.add(item.categoryKey); contentCategories.set(key, choices);
  }
  for (const entry of Object.values(document.recipeEntries)) for (const ingredient of entry.ingredients) {
    const key = ingredient.purchaseKey;
    const choices = contentCategories.get(key) ?? new Set<string>();
    choices.add(document.preferences.categoryByIngredient[key] ?? ingredient.defaultCategoryKey);
    contentCategories.set(key, choices);
  }
  const keys = new Set([
    ...Object.values(document.preferences.ingredientOrderByCategory).flat(),
    ...Object.keys(document.preferences.categoryByIngredient),
    ...Object.values(document.recipeEntries).flatMap(entry => entry.ingredients.map(i => i.purchaseKey)),
    ...contentCategories.keys(),
  ]);
  for (const key of keys) {
    const locations = Object.entries(document.preferences.ingredientOrderByCategory)
      .filter(([, sequence]) => sequence.includes(key)).map(([category]) => category);
    const remembered = document.preferences.categoryByIngredient[key];
    const choices = [...new Set([...locations, ...(remembered ? [remembered] : []), ...(contentCategories.get(key) ?? [])])];
    if (choices.length > 1 || choices.some(category => !categories.includes(category))) conflicts[key] = choices;
  }
  for (const [category, sequence] of Object.entries(document.preferences.ingredientOrderByCategory)) {
    if (!categories.includes(category)) continue;
    organization.sequences[category] = sequence.filter(key => !conflicts[key]);
    for (const key of sequence) {
      if (conflicts[key]) continue;
      const pinned = pinnedPurchaseDefault(key);
      organization.placements[key] = { categoryKey: category, defaultCategoryKey: pinned.categoryKey,
        policyVersion: pinned.policyVersion, version: 0, userOverride: category };
    }
  }
  // Existing display order is seeded once; ordinary additions use batch sorting.
  for (const key of [...legacyDisplayKeys, ...[...keys].sort(compareShoppingText)]) {
    if (organization.placements[key] || conflicts[key] || !keys.has(key)) continue;
    const pinned = pinnedPurchaseDefault(key);
    const category = document.preferences.categoryByIngredient[key] ?? contentCategories.get(key)?.values().next().value ?? pinned.categoryKey;
    organization.placements[key] = { categoryKey: category, defaultCategoryKey: pinned.categoryKey,
      policyVersion: pinned.policyVersion, version: 0,
      ...(document.preferences.categoryByIngredient[key] || contentCategories.has(key) ? { userOverride: category } : {}) };
    organization.sequences[category] = [...(organization.sequences[category] ?? []), key];
  }
  const manuals: ShoppingInitialization['manuals'] = {};
  for (const item of document.manualItems) {
    manuals[item.id] = {
      purchaseKey: resolveShoppingIngredientSemantics({ item: item.displayName, unit: item.quantity?.unit }).purchaseKey,
      policyVersion: SHOPPING_IDENTITY_POLICY, version: 0, meaning: 'legacyIndependent',
      legacy: legacyManualEnvelope(item, document),
    };
  }
  const sources: ShoppingInitialization['sources'] = {};
  for (const entry of Object.values(document.recipeEntries)) sources[entry.recipeId] = reconstructSource(entry);
  return { status: 'Ready' as const, conflicts, initialization: {
    policyVersion: SHOPPING_IDENTITY_POLICY, organization, manuals, sources,
  } satisfies ShoppingInitialization };
}

export function reconstructSource(entry: ShoppingRecipeEntryV2): ShoppingInitialization['sources'][string] {
  return { version: 0, history: 'reconstructed', sourceRevision: null, yieldEvidence: null,
    occurrences: entry.ingredients.map((ingredient, ordinal) => ({
      id: `reconstructed:${entry.recipeId}:${ordinal}`, section: null, ordinal, raw: structuredClone(ingredient),
    })) };
}

export function appendInitializedPurchases(organization: PurchaseOrganization, keys: string[]) {
  return appendPurchasePlacements(organization,
    Object.fromEntries(keys.map(key => [key, pinnedPurchaseDefault(key)])));
}

export function initializeShoppingDocument(document: ShoppingDocumentV3, displayKeys: string[], original?: unknown): ShoppingDocumentV3 {
  if (document.schemaVersion === 4) return document;
  document = structuredClone(document);
  const overrideIds = new Map<string, string>();
  // Historical derived amount/name overrides also have unknown amount intent.
  // Move them into the same editable legacy envelope, keeping the raw override.
  for (const [aggregateKey, override] of Object.entries(document.itemOverrides)) {
    if (!('quantity' in override) && !override.displayName) continue;
    const ingredient = Object.values(document.recipeEntries).flatMap(entry => entry.ingredients).find(i => i.aggregateKey === aggregateKey);
    let id = `legacy-override:${aggregateKey}`;
    while (document.manualItems.some(item => item.id === id)) id += ':';
    overrideIds.set(aggregateKey, id);
    document.manualItems.push({ id, displayName: override.displayName ?? ingredient?.displayName ?? aggregateKey,
      quantity: override.quantity ?? null, categoryKey: ingredient ? document.preferences.categoryByIngredient[ingredient.purchaseKey] ?? ingredient.defaultCategoryKey : 'misc',
      bucket: override.suppressed ? 'excluded' : override.bucket ?? 'items', checked: override.checked ?? false });
  }
  const { initialization, conflicts } = planShoppingInitialization(document, displayKeys);
  const { organization, manuals, sources } = initialization;
  for (const [aggregateKey, override] of Object.entries(document.itemOverrides)) {
    if (!('quantity' in override) && !override.displayName) continue;
    manuals[overrideIds.get(aggregateKey)!].legacy!.raw = { aggregateKey, override: structuredClone(override) };
    delete override.quantity; delete override.displayName;
  }
  const originalEntries = original && typeof original === 'object' && 'recipeEntries' in original ? original.recipeEntries : document.recipeEntries;
  if (originalEntries && typeof originalEntries === 'object') for (const [id, entry] of Object.entries(originalEntries)) {
    if (sources[id] && entry && typeof entry === 'object' && !Array.isArray(entry)) sources[id].originalEntry = structuredClone(entry);
  }
  return {
    ...structuredClone(document), schemaVersion: 4,
    manualItems: document.manualItems.map(item => ({ ...structuredClone(item), identity: manuals[item.id] })),
    recipeEntries: Object.fromEntries(Object.entries(document.recipeEntries).map(([id, entry]) =>
      [id, { ...structuredClone(entry), sourceEvidence: sources[id] }])),
    preferences: { ...structuredClone(document.preferences),
      ingredientOrderByCategory: organization.sequences,
      categoryByIngredient: Object.fromEntries(Object.entries(organization.placements)
        .filter(([, p]) => p.userOverride !== undefined).map(([key, p]) => [key, p.userOverride!])),
    },
    placementEvidence: {
      resolved: {},
      defaults: Object.fromEntries(Object.entries(organization.placements).map(([key, p]) =>
        [key, { categoryKey: p.defaultCategoryKey, policyVersion: p.policyVersion }])),
      unresolved: Object.fromEntries(Object.entries(conflicts).map(([key, categories]) => [key, {
        categories, sequences: Object.fromEntries(Object.entries(document.preferences.ingredientOrderByCategory)
          .filter(([, sequence]) => sequence.includes(key)).map(([category, sequence]) => [category, [...sequence]])),
      }])),
    },
  };
}

export function appendDocumentPurchases(document: ShoppingDocumentV3, keys: string[]): ShoppingDocumentV3 {
  if (document.schemaVersion !== 4 || !document.placementEvidence) throw new Error('Initialization required');
  const categories = [...Object.keys(SHOPPING_CATEGORIES), ...document.preferences.customCategories.map(c => `custom_${c.id}`)];
  const organization: PurchaseOrganization = {
    categories, sequences: document.preferences.ingredientOrderByCategory,
    placements: Object.fromEntries(Object.entries(document.placementEvidence.defaults).map(([key, pinned]) => [key, {
      categoryKey: document.preferences.categoryByIngredient[key] ?? pinned.categoryKey,
      defaultCategoryKey: pinned.categoryKey, policyVersion: pinned.policyVersion, version: 0,
      ...(document.preferences.categoryByIngredient[key] ? { userOverride: document.preferences.categoryByIngredient[key] } : {}),
    }])),
  };
  const appended = appendInitializedPurchases(organization, keys.filter(key => !document.placementEvidence!.unresolved[key]));
  if (appended.status === 'InvalidInput') throw new Error('Invalid purchase placement');
  return { ...document,
    preferences: { ...document.preferences, ingredientOrderByCategory: appended.organization.sequences },
    placementEvidence: { ...document.placementEvidence,
      defaults: Object.fromEntries(Object.entries(appended.organization.placements).map(([key, p]) =>
        [key, { categoryKey: p.defaultCategoryKey, policyVersion: p.policyVersion }])),
    },
  };
}

export function initializedCategory(document: ShoppingDocumentV3, key: string): string {
  if (document.placementEvidence?.unresolved[key]) return 'legacy-placement';
  return document.preferences.categoryByIngredient[key] ?? document.placementEvidence?.defaults[key]?.categoryKey ?? 'legacy-placement';
}

/** Strip only versioned metadata for the existing strict source/quantity validator.
 * No normalization is allowed to discard unsupported data on a runtime read.
 */
export function readInitializedDocument(value: unknown, validateV3: (value: unknown) => { ok: boolean }): ShoppingDocumentV3 | null {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  const text = (v: unknown): v is string => typeof v === 'string' && Boolean(v.trim());
  const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(key => keys.includes(key));
  if (!record(value) || value.schemaVersion !== 4 || !record(value.placementEvidence) ||
    !record(value.recipeEntries) || !Array.isArray(value.manualItems) || !record(value.preferences)) return null;
  const { placementEvidence, acknowledgements, ...base } = value;
  if (acknowledgements !== undefined && (!record(acknowledgements) || Object.entries(acknowledgements).some(([key, ack]) =>
    !text(key) || !record(ack) || !only(ack, ['version', 'basis']) || !Number.isSafeInteger(ack.version) || Number(ack.version) < 0 ||
    (ack.basis !== null && !isShoppingCoverageBasis(ack.basis))))) return null;
  if (!only(placementEvidence, ['defaults', 'unresolved', 'resolved']) || !record(placementEvidence.defaults) || !record(placementEvidence.unresolved) || !record(placementEvidence.resolved)) return null;
  const strippedRecipes: Record<string, unknown> = {};
  for (const [id, entry] of Object.entries(value.recipeEntries)) {
    if (!record(entry) || !record(entry.sourceEvidence)) return null;
    const { sourceEvidence, ...stripped } = entry;
    if (!only(sourceEvidence, ['version', 'history', 'sourceRevision', 'yieldEvidence', 'originalEntry', 'occurrences']) ||
      !Number.isSafeInteger(sourceEvidence.version) || Number(sourceEvidence.version) < 0 ||
      !['reconstructed', 'captured'].includes(String(sourceEvidence.history)) ||
      (sourceEvidence.history === 'captured' ? !text(sourceEvidence.sourceRevision) : sourceEvidence.sourceRevision !== null) ||
      !Array.isArray(sourceEvidence.occurrences) || !Array.isArray(entry.ingredients)) return null;
    if (sourceEvidence.history === 'reconstructed' ? sourceEvidence.yieldEvidence !== null :
      !record(sourceEvidence.yieldEvidence) || !Number.isFinite(sourceEvidence.yieldEvidence.servings) ||
      Number(sourceEvidence.yieldEvidence.servings) <= 0 || !('metadata' in sourceEvidence.yieldEvidence)) return null;
    if (sourceEvidence.originalEntry !== undefined && !record(sourceEvidence.originalEntry)) return null;
    if (sourceEvidence.occurrences.length !== entry.ingredients.length) return null;
    const ids = new Set<string>();
    for (const occurrence of sourceEvidence.occurrences) {
      if (!record(occurrence) || !only(occurrence, ['id', 'section', 'ordinal', 'raw']) ||
        !text(occurrence.id) || ids.has(occurrence.id) || !Number.isSafeInteger(occurrence.ordinal) || Number(occurrence.ordinal) < 0 ||
        (occurrence.section !== null && typeof occurrence.section !== 'string') || !('raw' in occurrence)) return null;
      ids.add(occurrence.id);
    }
    strippedRecipes[id] = stripped;
  }
  const strippedManuals = [];
  for (const item of value.manualItems) {
    if (!record(item) || !record(item.identity)) return null;
    const { identity, ...stripped } = item;
    if (!only(identity, ['purchaseKey', 'policyVersion', 'version', 'meaning', 'legacy', 'conversion', 'removed']) ||
      !text(identity.purchaseKey) || !text(identity.policyVersion) || !Number.isSafeInteger(identity.version) || Number(identity.version) < 0 ||
      !['extra', 'reminder', 'legacyIndependent'].includes(String(identity.meaning)) ||
      (identity.removed !== undefined && typeof identity.removed !== 'boolean')) return null;
    if (identity.meaning === 'legacyIndependent' ? !isLegacyIndependentNeed(identity.legacy) : identity.legacy !== undefined) return null;
    if (identity.conversion !== undefined && !isLegacyIndependentNeed(identity.conversion)) return null;
    strippedManuals.push(stripped);
  }
  if (!validateV3({ ...base, schemaVersion: 3, recipeEntries: strippedRecipes, manualItems: strippedManuals }).ok) return null;
  const document = value as unknown as ShoppingDocumentV3;
  const categories = new Set([...Object.keys(SHOPPING_CATEGORIES), ...document.preferences.customCategories.map(c => `custom_${c.id}`)]);
  const seen = new Set<string>();
  for (const [category, sequence] of Object.entries(document.preferences.ingredientOrderByCategory)) {
    if (!categories.has(category)) return null;
    for (const key of sequence) {
      const pinned = placementEvidence.defaults[key];
      if (seen.has(key) || !record(pinned) || !only(pinned, ['categoryKey', 'policyVersion']) ||
        !text(pinned.categoryKey) || !categories.has(pinned.categoryKey) || !text(pinned.policyVersion) ||
        category !== (document.preferences.categoryByIngredient[key] ?? pinned.categoryKey)) return null;
      seen.add(key);
    }
  }
  if (Object.keys(placementEvidence.defaults).some(key => !seen.has(key))) return null;
  if (Object.keys(document.preferences.categoryByIngredient).some(key => !seen.has(key))) return null;
  for (const [key, evidence] of Object.entries({ ...placementEvidence.resolved, ...placementEvidence.unresolved })) {
    if ((Object.hasOwn(placementEvidence.unresolved, key) && seen.has(key)) || !record(evidence) || !only(evidence, ['categories', 'sequences']) ||
      !Array.isArray(evidence.categories) || !evidence.categories.every(text) || !record(evidence.sequences) ||
      Object.values(evidence.sequences).some(sequence => !Array.isArray(sequence) || !sequence.every(text))) return null;
  }
  const hasPlacement = (key: string) => seen.has(key) || Object.hasOwn(placementEvidence.unresolved as object, key);
  if (Object.values(document.recipeEntries).some(entry => entry.ingredients.some(i => !hasPlacement(i.purchaseKey))) ||
    document.manualItems.some(item => item.identity!.meaning !== 'legacyIndependent' && !hasPlacement(item.identity!.purchaseKey))) return null;
  return structuredClone(document);
}

/** A resolution chooses one local destination and retains the disputed evidence.
 * Returning identities keep their slot unless this explicit choice moves them.
 */
export function resolveShoppingPlacement(document: ShoppingDocumentV3, key: string, categoryChoice: string, anchor: string | null) {
  const next = structuredClone(document);
  const evidence = next.placementEvidence!;
  const currentCategory = initializedCategory(next, key);
  if (evidence.unresolved[key]) {
    evidence.resolved[key] = evidence.unresolved[key];
    delete evidence.unresolved[key];
  }
  const appended = appendDocumentPurchases(next, [key]);
  const category = categoryChoice === '@default' ? appended.placementEvidence!.defaults[key].categoryKey : categoryChoice;
  const categories = [...Object.keys(SHOPPING_CATEGORIES), ...next.preferences.customCategories.map(c => `custom_${c.id}`)];
  if (!categories.includes(category) || anchor === key) throw new Error('Invalid resolution destination');
  if (categoryChoice === '@default') delete appended.preferences.categoryByIngredient[key];
  else appended.preferences.categoryByIngredient[key] = category;
  if (category === currentCategory && anchor === null) return appended;
  for (const c of Object.keys(appended.preferences.ingredientOrderByCategory)) {
    appended.preferences.ingredientOrderByCategory[c] = appended.preferences.ingredientOrderByCategory[c].filter(k => k !== key);
  }
  const sequence = appended.preferences.ingredientOrderByCategory[category] ?? [];
  if (anchor !== null && !sequence.includes(anchor)) throw new Error('Resolution anchor changed');
  sequence.splice(anchor === null ? sequence.length : sequence.indexOf(anchor), 0, key);
  appended.preferences.ingredientOrderByCategory[category] = sequence;
  return appended;
}
