import type { ShoppingDocumentV3 } from './shopping-document';
import { SHOPPING_CATEGORIES } from './shopping-categories';
import { compareShoppingText } from './shopping-ordering';
import { splicePurchasePlacement, type PurchaseDestination, type PurchaseOrganization } from './shopping-target-order';

export type OrganizationAction =
  | { kind: 'move'; key: string; destination: PurchaseDestination; override?: string | null }
  | { kind: 'reset'; keys: string[]; mode: 'position' | 'category' | 'both'; bulk: boolean }
  | { kind: 'createCategory'; id: string; name: string }
  | { kind: 'renameCategory'; key: string; name: string }
  | { kind: 'deleteCategory'; key: string; fallback: string }
  | { kind: 'restoreCategory'; category: { id: string; name: string; order: number }; keys: string[]; legacyIds: string[]; before: string | null }
  | { kind: 'restorePlacements'; moves: { key: string; destination: PurchaseDestination; override: string | null }[] }
  | { kind: 'moveSection'; key: string; anchor: string; at: 'before' | 'after' }
  | { kind: 'resetSections' };

export interface OrganizationIntent {
  type: 'organize';
  action: OrganizationAction;
  versions: Record<string, number>;
}

export function validOrganizationIntent(value: unknown): value is OrganizationIntent {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
  const version = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
  const destination = (v: unknown) => record(v) && text(v.categoryKey) &&
    (v.at === 'start' || v.at === 'end' ? Object.keys(v).length === 2 :
      (v.at === 'before' || v.at === 'after') && text(v.anchor) && version(v.anchorVersion) && Object.keys(v).length === 4);
  const category = (v: unknown) => record(v) && text(v.id) && text(v.name) && version(v.order) && Object.keys(v).length === 3;
  if (!record(value) || value.type !== 'organize' || !record(value.action) || !record(value.versions) ||
    Object.values(value.versions).some(v => !version(v))) return false;
  const a = value.action;
  const fields: Record<string, string[]> = {
    move: ['kind', 'key', 'destination', 'override'], reset: ['kind', 'keys', 'mode', 'bulk'],
    createCategory: ['kind', 'id', 'name'], renameCategory: ['kind', 'key', 'name'],
    deleteCategory: ['kind', 'key', 'fallback'], restoreCategory: ['kind', 'category', 'keys', 'legacyIds', 'before'],
    restorePlacements: ['kind', 'moves'], moveSection: ['kind', 'key', 'anchor', 'at'], resetSections: ['kind'],
  };
  if (!text(a.kind) || !Object.hasOwn(fields, a.kind) || Object.keys(a).some(k => !fields[a.kind as string].includes(k))) return false;
  switch (a.kind) {
    case 'move': return text(a.key) && !!destination(a.destination) && (a.override === undefined || a.override === null || text(a.override));
    case 'reset': return strings(a.keys) && ['position', 'category', 'both'].includes(String(a.mode)) && typeof a.bulk === 'boolean';
    case 'createCategory': return text(a.id) && text(a.name);
    case 'renameCategory': return text(a.key) && text(a.name);
    case 'deleteCategory': return text(a.key) && text(a.fallback);
    case 'restoreCategory': return !!category(a.category) && strings(a.keys) && strings(a.legacyIds) && (a.before === null || text(a.before));
    case 'restorePlacements': return Array.isArray(a.moves) && a.moves.every(m => record(m) && text(m.key) && destination(m.destination) &&
      (m.override === null || text(m.override)) && Object.keys(m).length === 3);
    case 'moveSection': return text(a.key) && text(a.anchor) && ['before', 'after'].includes(String(a.at));
    case 'resetSections': return true;
  }
  return false;
}

export function organizationVersion(document: ShoppingDocumentV3, field: string) {
  return document.organizationVersions?.[field] ?? 0;
}

export function purchaseOrganization(document: ShoppingDocumentV3): PurchaseOrganization {
  return {
    categories: [...Object.keys(SHOPPING_CATEGORIES), ...document.preferences.customCategories.map(c => `custom_${c.id}`)],
    sequences: document.preferences.ingredientOrderByCategory,
    placements: Object.fromEntries(Object.entries(document.placementEvidence?.defaults ?? {}).map(([key, pinned]) => [key, {
      categoryKey: document.preferences.categoryByIngredient[key] ?? pinned.categoryKey,
      defaultCategoryKey: pinned.categoryKey, policyVersion: pinned.policyVersion,
      version: organizationVersion(document, `purchase:${key}`),
      ...(document.preferences.categoryByIngredient[key] ? { userOverride: document.preferences.categoryByIngredient[key] } : {}),
    }])),
  };
}

export function sectionSequence(document: ShoppingDocumentV3) {
  const categories = purchaseOrganization(document).categories;
  return [...new Set([...document.preferences.categoryOrder, ...categories])].filter(k => categories.includes(k));
}

/** Only touched fields and stable anchors authorize a rebase. Scope epochs
 * include insertions/deletions for deliberate bulk operations. */
export function organizationFields(action: OrganizationAction): string[] {
  switch (action.kind) {
    case 'move': return [`purchase:${action.key}`, `category:${action.destination.categoryKey}`,
      ...('anchor' in action.destination ? [`purchase:${action.destination.anchor}`] : [])];
    case 'reset': return ['purchases', 'categories', ...action.keys.map(k => `purchase:${k}`)];
    case 'createCategory': return [`category:custom_${action.id}`];
    case 'renameCategory': return [`category:${action.key}`, `label:${action.key}`];
    case 'deleteCategory': return ['purchases', 'categories', `category:${action.key}`, `label:${action.key}`, `category:${action.fallback}`];
    case 'restoreCategory': return ['purchases', 'categories', 'sections', `category:custom_${action.category.id}`];
    case 'restorePlacements': return ['purchases', 'categories'];
    case 'moveSection': return [`category:${action.key}`, `category:${action.anchor}`, `section:${action.key}`, `section:${action.anchor}`];
    case 'resetSections': return ['sections', 'categories'];
  }
}

export function inspectOrganization(document: ShoppingDocumentV3, action: OrganizationAction): OrganizationIntent {
  return { type: 'organize', action, versions: Object.fromEntries(organizationFields(action).map(f => [f, organizationVersion(document, f)])) };
}

export function applyOrganization(document: ShoppingDocumentV3, intent: OrganizationIntent) {
  const fail = (status: 'Conflict' | 'TargetGone' | 'InvalidInput') => ({ status });
  if (!validOrganizationIntent(intent)) return fail('InvalidInput');
  const action = intent.action;
  if (organizationFields(action).some(f => intent.versions[f] !== organizationVersion(document, f))) return fail('Conflict');
  const next = structuredClone(document);
  let org = purchaseOrganization(next);
  const bump = (field: string) => {
    next.organizationVersions = { ...next.organizationVersions, [field]: organizationVersion(document, field) + 1 };
  };
  const writeOrg = () => {
    next.preferences.ingredientOrderByCategory = org.sequences;
    next.preferences.categoryByIngredient = Object.fromEntries(Object.entries(org.placements)
      .filter(([, p]) => p.userOverride !== undefined).map(([k, p]) => [k, p.userOverride!]));
  };
  const move = (key: string, destination: PurchaseDestination, override?: string | null) => {
    const moved = splicePurchasePlacement(org, { key, expectedVersion: org.placements[key]?.version, destination });
    if (!('organization' in moved)) return moved.status;
    org = moved.organization;
    if (override === null) delete org.placements[key].userOverride;
    else if (override !== undefined) org.placements[key].userOverride = override;
    bump(`purchase:${key}`); bump('purchases');
    return null;
  };
  if (action.kind === 'move') {
    if (action.override !== undefined && action.override !== null && action.override !== action.destination.categoryKey) return fail('InvalidInput');
    if (action.override === null && org.placements[action.key]?.defaultCategoryKey !== action.destination.categoryKey) return fail('InvalidInput');
    const error = move(action.key, action.destination, action.override);
    if (error) return fail(error);
    writeOrg();
  } else if (action.kind === 'reset') {
    if (!action.keys.length || new Set(action.keys).size !== action.keys.length) return fail('InvalidInput');
    if (action.keys.some(k => !org.placements[k])) return fail('TargetGone');
    const keys = sectionSequence(next).flatMap(c => org.sequences[c] ?? []).filter(k => action.keys.includes(k));
    for (const key of keys) {
      const p = org.placements[key];
      if (action.mode !== 'position') {
        if (p.categoryKey !== p.defaultCategoryKey) {
          const error = move(key, { categoryKey: p.defaultCategoryKey, at: 'end' }, null);
          if (error) return fail(error);
        } else delete p.userOverride;
      }
      bump(`purchase:${key}`);
    }
    if (action.mode !== 'category') {
      if (action.bulk) {
        for (const category of org.categories) {
          const sequence = org.sequences[category] ?? [];
          const selected = sequence.filter(k => action.keys.includes(k)).sort(compareShoppingText);
          // Scope is explicit; untouched pairs keep their relative order.
          org.sequences[category] = [...sequence.filter(k => !action.keys.includes(k)), ...selected];
        }
      } else {
        if (keys.length !== 1) return fail('InvalidInput');
        const p = org.placements[keys[0]];
        const error = move(keys[0], { categoryKey: p.categoryKey, at: 'end' }, p.userOverride ?? null);
        if (error) return fail(error);
      }
    }
    bump('purchases'); writeOrg();
  } else if (action.kind === 'createCategory') {
    if (!/^[a-zA-Z0-9_-]+$/.test(action.id) || !action.name.trim()) return fail('InvalidInput');
    const key = `custom_${action.id}`;
    if (org.categories.includes(key)) return fail('Conflict');
    next.preferences.customCategories.push({ id: action.id, name: action.name.trim(), order: next.preferences.customCategories.length });
    next.preferences.categoryOrder = [...sectionSequence(document), key];
    bump(`category:${key}`); bump('categories'); bump('sections');
  } else if (action.kind === 'renameCategory') {
    const category = next.preferences.customCategories.find(c => `custom_${c.id}` === action.key);
    if (!category) return fail('TargetGone');
    if (!action.name.trim()) return fail('InvalidInput');
    category.name = action.name.trim(); bump(`label:${action.key}`);
  } else if (action.kind === 'deleteCategory') {
    if (!next.preferences.customCategories.some(c => `custom_${c.id}` === action.key) || !org.categories.includes(action.fallback)) return fail('TargetGone');
    if (action.key === action.fallback) return fail('InvalidInput');
    for (const key of [...(org.sequences[action.key] ?? [])]) {
      const error = move(key, { categoryKey: action.fallback, at: 'end' });
      if (error) return fail(error);
    }
    delete org.sequences[action.key]; writeOrg();
    next.preferences.customCategories = next.preferences.customCategories.filter(c => `custom_${c.id}` !== action.key);
    next.preferences.categoryOrder = sectionSequence(document).filter(k => k !== action.key);
    for (const item of next.manualItems) if (item.categoryKey === action.key) item.categoryKey = action.fallback;
    // Retained legacy evidence remains verbatim; only active references move.
    bump(`category:${action.key}`); bump('categories'); bump('sections'); bump('purchases');
  } else if (action.kind === 'restoreCategory') {
    const key = `custom_${action.category.id}`;
    if (org.categories.includes(key) || (action.before !== null && !org.categories.includes(action.before))) return fail('Conflict');
    if (action.keys.some(k => !org.placements[k])) return fail('TargetGone');
    next.preferences.customCategories.push(structuredClone(action.category));
    org.categories.push(key);
    for (const purchase of action.keys) {
      const error = move(purchase, { categoryKey: key, at: 'end' });
      if (error) return fail(error);
    }
    writeOrg();
    const sections = sectionSequence(document);
    sections.splice(action.before === null ? sections.length : sections.indexOf(action.before), 0, key);
    next.preferences.categoryOrder = sections;
    for (const item of next.manualItems) if (action.legacyIds.includes(item.id)) item.categoryKey = key;
    bump(`category:${key}`); bump('categories'); bump('sections'); bump('purchases');
  } else if (action.kind === 'restorePlacements') {
    if (!action.moves.length || new Set(action.moves.map(m => m.key)).size !== action.moves.length) return fail('InvalidInput');
    for (const saved of action.moves) {
      if (saved.override !== null && saved.override !== saved.destination.categoryKey) return fail('InvalidInput');
      if (saved.override === null && org.placements[saved.key]?.defaultCategoryKey !== saved.destination.categoryKey) return fail('InvalidInput');
      // The whole inspected scope was validated above. Earlier splices in this
      // atomic inverse may have advanced an anchor, without renewing approval.
      const destination = 'anchor' in saved.destination ? { ...saved.destination,
        anchorVersion: org.placements[saved.destination.anchor]?.version } : saved.destination;
      const error = move(saved.key, destination, saved.override);
      if (error) return fail(error);
    }
    writeOrg();
  } else if (action.kind === 'moveSection') {
    const sequence = sectionSequence(next);
    if (!sequence.includes(action.key) || !sequence.includes(action.anchor)) return fail('TargetGone');
    if (action.key === action.anchor) return fail('InvalidInput');
    const rest = sequence.filter(k => k !== action.key);
    rest.splice(rest.indexOf(action.anchor) + (action.at === 'after' ? 1 : 0), 0, action.key);
    next.preferences.categoryOrder = rest; bump(`section:${action.key}`); bump('sections');
  } else if (action.kind === 'resetSections') {
    next.preferences.categoryOrder = [...Object.keys(SHOPPING_CATEGORIES), ...next.preferences.customCategories.map(c => `custom_${c.id}`).sort(compareShoppingText)];
    for (const key of org.categories) bump(`section:${key}`);
    bump('sections');
  } else return fail('InvalidInput');
  return { status: 'Applied' as const, document: next };
}

/** Save a relative inverse, never an old sequence/map. Its approval is bound
 * to the post-move key and saved anchor; unrelated insertions may survive. */
export function moveInverse(document: ShoppingDocumentV3, key: string): OrganizationAction | null {
  const org = purchaseOrganization(document);
  const p = org.placements[key];
  if (!p) return null;
  const sequence = org.sequences[p.categoryKey] ?? [];
  const index = sequence.indexOf(key);
  const anchor = sequence[index + 1] ?? sequence[index - 1];
  const destination: PurchaseDestination = anchor ? { categoryKey: p.categoryKey,
    at: sequence[index + 1] ? 'before' : 'after', anchor, anchorVersion: org.placements[anchor].version }
    : { categoryKey: p.categoryKey, at: 'start' };
  return { kind: 'move', key, destination, override: p.userOverride ?? null };
}

export function organizationInverse(document: ShoppingDocumentV3, action: OrganizationAction): OrganizationAction | null {
  if (action.kind === 'move') return moveInverse(document, action.key);
  if (action.kind === 'reset' && !action.bulk && action.keys.length === 1) return moveInverse(document, action.keys[0]);
  if (action.kind === 'reset') {
    const org = purchaseOrganization(document);
    const moves = org.categories.flatMap(categoryKey => {
      const sequence = org.sequences[categoryKey] ?? [];
      return sequence.flatMap((key, index) => {
        if (!action.keys.includes(key)) return [];
        const anchor = sequence[index + 1];
        const destination: PurchaseDestination = anchor ? { categoryKey, at: 'before', anchor,
          anchorVersion: org.placements[anchor].version } : { categoryKey, at: 'end' };
        return [{ key, destination, override: org.placements[key].userOverride ?? null }];
      }).reverse();
    });
    return { kind: 'restorePlacements', moves };
  }
  if (action.kind === 'deleteCategory') {
    const category = document.preferences.customCategories.find(c => `custom_${c.id}` === action.key);
    if (!category) return null;
    const sections = sectionSequence(document);
    return { kind: 'restoreCategory', category: structuredClone(category),
      keys: [...(document.preferences.ingredientOrderByCategory[action.key] ?? [])],
      legacyIds: document.manualItems.filter(m => m.categoryKey === action.key).map(m => m.id),
      before: sections[sections.indexOf(action.key) + 1] ?? null };
  }
  return null;
}
