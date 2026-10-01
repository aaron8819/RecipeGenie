import { validOrganizationIntent } from './shopping-organization';
import type { ShoppingDocumentMutation, ShoppingManualItemV1 } from './shopping-document';

export const SHOPPING_PROTOCOL = 1;
export const SHOPPING_COMMAND_BYTES = 1048576;
export type ShoppingCommand = {
  protocol: 1;
  observedRevision: number;
  mutation: ShoppingDocumentMutation | { type: 'pantry'; rowRef: string } |
    { type: 'deleteRecipe'; recipeId: string } | { type: 'undoClear' } | import('./shopping-organization').OrganizationIntent;
  tripId?: string;
  inspectedCoverage?: Record<string, { version: number; basis: import("./shopping-coverage").ShoppingCoverageBasis | null }>;
  clearUndoRequired?: boolean;
  observedSettingVersion?: number;
  observedSetting?: boolean;
  observedManual?: ShoppingManualItemV1;
  sourceSelections?: import('./shopping-selection').ShoppingRecipeSelection[];
  observedSelections?: Record<string, number | null>;
};

export function canonicalShoppingPayload(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalShoppingPayload).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalShoppingPayload(record[key])}`).join(',')}}`;
}

const fields: Record<string, string[]> = {
  organize: ['action', 'versions'],
  initialize: [], resolveLegacy: ['id', 'expectedVersion', 'choice', 'quantity', 'purchaseName', 'categoryKey', 'anchor'],
  resolvePlacement: ['purchaseKey', 'categoryKey', 'anchor'],
  restoreManualItem: ['id', 'expectedVersion'], rebindManualItem: ['id', 'expectedVersion', 'displayName', 'quantity'],
  setExclusion: ['key', 'enabled'], setFamilySetting: ['setting', 'enabled'],
  upsertRecipe: ['entry'], upsertRecipes: ['entries'], rescaleRecipe: ['entry'],
  removeRecipe: ['recipeId'], setChecked: ['rowRef', 'checked'],
  setCheckedMany: ['rowRefs', 'checked'], setBucketOverride: ['aggregateKey', 'bucket'],
  setSuppressed: ['aggregateKey', 'suppressed'],
  updatePreferences: ['preferences'], updateCategoryPreferences: ['preferences'],
  learnOrder: ['draggedRowRef', 'draggedOrderingKey', 'sourceCategoryKey',
    'targetRowRef', 'targetOrderingKey', 'targetCategoryKey', 'placement'],
  addManualItem: ['item'], editManualItem: ['id', 'changes'],
  deleteManualItem: ['id'], restoreContent: ['content'], complete: [],
  pantry: ['rowRef'], deleteRecipe: ['recipeId'], undoClear: [],
};

// Structural validation is deliberately independent of authorization. The
// server additionally validates targets, source evidence and resulting state.
export function readShoppingCommand(value: unknown): ShoppingCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (Object.keys(command).some((key) => !['protocol', 'observedRevision', 'mutation', 'observedSetting', 'observedSettingVersion', 'observedManual', 'observedSelections', 'sourceSelections', 'clearUndoRequired', 'tripId', 'inspectedCoverage'].includes(key)) ||
    command.protocol !== SHOPPING_PROTOCOL || !Number.isSafeInteger(command.observedRevision) ||
    Number(command.observedRevision) < 0 ||
    (command.observedSetting !== undefined && typeof command.observedSetting !== 'boolean') ||
    (command.clearUndoRequired !== undefined && typeof command.clearUndoRequired !== 'boolean')) return null;
  if (command.tripId !== undefined && (typeof command.tripId !== 'string' || !/^[0-9a-f-]{36}$/i.test(command.tripId))) return null;
  const mutation = command.mutation as Record<string, unknown> | null;
  if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation) ||
    typeof mutation.type !== 'string' || !Object.hasOwn(fields, mutation.type)) return null;
  if (Object.keys(mutation).some((key) => key !== 'type' && !fields[mutation.type as string].includes(key))) return null;
  if (command.clearUndoRequired !== undefined && mutation.type !== 'complete') return null;
  if (mutation.type === 'organize' && !validOrganizationIntent(mutation)) return null;
  if (command.observedSettingVersion !== undefined && (!Number.isSafeInteger(command.observedSettingVersion) || Number(command.observedSettingVersion) < 0)) return null;
  let nodes = 0;
  const bounded = (item: unknown, depth: number): boolean => {
    if (++nodes > 40000 || depth > 24) return false;
    if (typeof item === 'string') return item.length <= 16384;
    if (typeof item === 'number') return Number.isFinite(item);
    if (item === null || typeof item === 'boolean') return true;
    if (Array.isArray(item)) return item.length <= 10000 && item.every((v) => bounded(v, depth + 1));
    if (typeof item !== 'object') return false;
    return Object.entries(item).every(([key, v]) => key.length <= 1024 &&
      !['__proto__', 'constructor', 'prototype'].includes(key) && bounded(v, depth + 1));
  };
  if (!bounded(value, 0)) return null;
  if ('expectedVersion' in mutation && (!Number.isSafeInteger(mutation.expectedVersion) || Number(mutation.expectedVersion) < 0)) return null;
  if (mutation.type === 'resolveLegacy' && (!['extra', 'total', 'reminder'].includes(String(mutation.choice)) ||
    typeof mutation.purchaseName !== 'string' || !mutation.purchaseName.trim() || typeof mutation.categoryKey !== 'string' ||
    (mutation.anchor !== null && typeof mutation.anchor !== 'string'))) return null;
  if (mutation.type === 'rebindManualItem' && (typeof mutation.displayName !== 'string' || !mutation.displayName.trim())) return null;
  if (mutation.type === 'resolvePlacement' && (typeof mutation.purchaseKey !== 'string' || !mutation.purchaseKey.trim() ||
    typeof mutation.categoryKey !== 'string' || !mutation.categoryKey || (mutation.anchor !== null && typeof mutation.anchor !== 'string'))) return null;
  if (command.observedSelections !== undefined && (!command.observedSelections || typeof command.observedSelections !== 'object' ||
    Array.isArray(command.observedSelections) || Object.values(command.observedSelections).some(v => v !== null && (!Number.isSafeInteger(v) || Number(v) < 0)))) return null;
  if (command.sourceSelections !== undefined) {
    const selections = command.sourceSelections;
    if (!['upsertRecipes', 'upsertRecipe', 'rescaleRecipe'].includes(mutation.type) ||
      !Array.isArray(selections) || selections.length > 100 ||
      new Set(selections.map(s => s?.recipeId)).size !== selections.length ||
      selections.some(s => !s || typeof s !== 'object' || Array.isArray(s) ||
        Object.keys(s).some(k => !['recipeId', 'selectedYield', 'ingredientOrdinals', 'contentSnapshot'].includes(k)) ||
        typeof s.recipeId !== 'string' || !s.recipeId || typeof s.contentSnapshot !== 'string' ||
        !Number.isFinite(s.selectedYield) || s.selectedYield <= 0 ||
        !Array.isArray(s.ingredientOrdinals) || !s.ingredientOrdinals.length ||
        new Set(s.ingredientOrdinals).size !== s.ingredientOrdinals.length ||
        s.ingredientOrdinals.some((i: unknown) => !Number.isSafeInteger(i) || Number(i) < 0))) return null;
  }
  const stringFields = ['key', 'setting', 'recipeId', 'rowRef', 'id', 'aggregateKey',
    'draggedRowRef', 'draggedOrderingKey', 'sourceCategoryKey', 'targetRowRef',
    'targetOrderingKey', 'targetCategoryKey', 'placement'];
  for (const key of fields[mutation.type]) {
    if (['bucket'].includes(key)) continue;
    if (!(key in mutation)) return null;
    if (stringFields.includes(key) && (typeof mutation[key] !== 'string' || !mutation[key])) return null;
  }
  for (const key of ['enabled', 'checked', 'suppressed']) {
    if (key in mutation && typeof mutation[key] !== 'boolean') return null;
  }
  if (mutation.type === 'setFamilySetting' &&
    !['excludeSaltVariants', 'excludeBlackPepperVariants'].includes(String(mutation.setting))) return null;
  if ('bucket' in mutation && !['items', 'already_have', 'excluded'].includes(String(mutation.bucket))) return null;
  if (mutation.type === 'learnOrder' && !['before', 'after'].includes(String(mutation.placement))) return null;
  if (mutation.type === 'setCheckedMany' && (!Array.isArray(mutation.rowRefs) ||
    mutation.rowRefs.length > 1000 || mutation.rowRefs.some((v) => typeof v !== 'string'))) return null;
  if (mutation.type === 'editManualItem' && (!mutation.changes || typeof mutation.changes !== 'object' ||
    Array.isArray(mutation.changes) || Object.keys(mutation.changes).some((key) =>
      !['displayName', 'quantity', 'categoryKey', 'bucket', 'checked'].includes(key)))) return null;
  return value as ShoppingCommand;
}

export interface ShoppingReceipt {
  outcome: string;
  revision: number;
  contentEpoch?: number;
  tripId?: string;
  pantryId?: string | null;
  pantryWasAdded?: boolean;
  undoAvailable?: boolean | null;
}

export const shoppingOutcomeMessage = (status: string): string => ({
  Conflict: 'Shopping changed in another session. Review the latest list and try again.',
  TargetGone: 'That Shopping item is no longer available. Review the latest list.',
  InvalidInput: 'This Shopping change is not valid. Review your input.',
  UnsupportedDocument: 'This shopping list could not be opened. Your saved list has not been changed.',
  UpdateRequired: 'Shopping has been updated. Refresh the application to continue.',
  RetryCapacity: 'Too many pending Shopping changes. Keep your input and retry after earlier changes expire.',
  OutcomeUnknown: 'The Shopping outcome is unknown. Review the saved list before taking another action.',
  RetryExpired: 'The Shopping retry window expired. Review the saved list; this action was not repeated.',
  UnknownAdmission: 'This Shopping attempt could not be found. Review the saved list before another action.',
  PayloadMismatch: 'This Shopping attempt has different input. The change was not repeated.',
  TripEnded: 'This Shopping trip ended. Review the current list before another change.',
  RequirementChanged: 'The requirement changed. Review the current amount before checking it.',
  SourceUnavailable: 'A saved recipe is no longer available. Undo was not applied.',
  UndoUnavailable: 'Shopping changed after Clear; Undo was not applied.',
  DependencyUnavailable: 'Could not verify Shopping dependencies. Your input is preserved; retry this change.',
}[status] || 'Could not update the shopping list. Your input is preserved; retry this change.');
