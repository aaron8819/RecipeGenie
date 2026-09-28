import type { ShoppingDocumentStateV3 } from './shopping-document';
import { ShoppingDocumentConflictError } from './shopping-document-persistence';

export type ShoppingFamilySetting = 'excludeSaltVariants' | 'excludeBlackPepperVariants';
export type ShoppingSettingIntent =
  | { type: 'setExclusion'; key: string; enabled: boolean }
  | { type: 'setFamilySetting'; setting: ShoppingFamilySetting; enabled: boolean };

export class ShoppingSettingsConflictError extends ShoppingDocumentConflictError {
  constructor() {
    super();
    this.name = 'ShoppingSettingsConflictError';
    this.message = 'Shopping settings changed in another session. Your change was not saved. Review the latest settings and try again.';
  }
}

export function settingValue(state: ShoppingDocumentStateV3, intent: ShoppingSettingIntent): boolean {
  return intent.type === 'setExclusion'
    ? state.document.preferences.excludedIngredientKeys.includes(intent.key)
    : state.document.preferences[intent.setting];
}

// V3 has no persistent per-key history. An already-satisfied stale intent is
// ambiguous (it could undo the opposite action), so require its exact revision.
// Actual exclusion transitions can converge to the same membership; family
// changes require their observed value. ABA with an equal value is undetectable.
export function validateSettingIntent(
  observed: ShoppingDocumentStateV3 | undefined,
  fresh: ShoppingDocumentStateV3,
  intent: ShoppingSettingIntent
): void {
  if (!observed) throw new ShoppingSettingsConflictError();
  if (fresh.contentRevision === observed.contentRevision) return;
  const expected = settingValue(observed, intent);
  if (expected === intent.enabled ||
      (intent.type === 'setFamilySetting' && settingValue(fresh, intent) !== expected)) {
    throw new ShoppingSettingsConflictError();
  }
}

export function validateSettingsReplacement(
  observed: ShoppingDocumentStateV3 | undefined,
  fresh: ShoppingDocumentStateV3
): void {
  if (!observed || fresh.contentRevision !== observed.contentRevision) {
    throw new ShoppingSettingsConflictError();
  }
}
