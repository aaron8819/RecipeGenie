import { describe, expect, it } from 'vitest';
import { applyShoppingDocumentMutation, createEmptyShoppingDocument } from '../shopping-document';
import { persistShoppingMutationWithReplay } from '../shopping-document-persistence';
import {
  settingValue, validateSettingIntent, validateSettingsReplacement,
  type ShoppingSettingIntent,
} from '../shopping-settings';

const initial = () => {
  const document = createEmptyShoppingDocument();
  document.preferences.excludedIngredientKeys = ['salt'];
  document.preferences.categoryOrder = ['misc', 'produce'];
  return { document, contentRevision: 7 };
};
const exclusion = (key: string, enabled = true): ShoppingSettingIntent => ({ type: 'setExclusion', key, enabled });
describe('semantic Shopping settings', () => {
  it.each([
    [exclusion('pepper'), exclusion('cumin'), ['salt', 'pepper', 'cumin']],
    [exclusion('pepper'), exclusion('salt', false), ['pepper']],
    [exclusion('salt', false), exclusion('cumin'), ['cumin']],
    [exclusion('pepper'), exclusion('pepper'), ['salt', 'pepper']],
    [exclusion('salt', false), exclusion('salt', false), []],
  ])('preserves disjoint intent and converges repeated transitions', async (a, b, keys) => {
    const observed = initial();
    let stored = applyShoppingDocumentMutation(observed, a);
    let attempts = 0;
    const result = await persistShoppingMutationWithReplay({
      initial: observed, mutation: b,
      write: async (before, next) => {
        attempts++;
        if (before.contentRevision !== stored.contentRevision) return null;
        stored = next; return stored;
      },
      refetch: async () => stored,
      validateReplay: (fresh) => validateSettingIntent(observed, fresh, b),
    });
    expect(result.document.preferences.excludedIngredientKeys).toEqual(keys);
    expect(result.document.preferences.categoryOrder).toEqual(observed.document.preferences.categoryOrder);
    expect(attempts).toBeGreaterThan(0);
  });
  it.each([exclusion('salt'), exclusion('cumin', false)])('refuses stale already-satisfied opposite intent', (intent) => {
    const observed = initial();
    const fresh = applyShoppingDocumentMutation(observed, { ...intent, enabled: !intent.enabled });
    expect(() => validateSettingIntent(observed, fresh, intent)).toThrow('Your change was not saved');
  });
  it('preserves independent families but refuses a stale changed family value', () => {
    const observed = initial();
    const salt = { type: 'setFamilySetting', setting: 'excludeSaltVariants', enabled: true } as const;
    const pepper = { ...salt, setting: 'excludeBlackPepperVariants' } as const;
    const fresh = applyShoppingDocumentMutation(observed, salt);
    expect(() => validateSettingIntent(observed, fresh, pepper)).not.toThrow();
    expect(() => validateSettingIntent(observed, fresh, salt)).toThrow();
    const result = applyShoppingDocumentMutation(fresh, pepper);
    expect(settingValue(result, salt)).toBe(true);
    expect(settingValue(result, pepper)).toBe(true);
  });
  it('refuses stale bulk replacement even when settings returned to the observed value', () => {
    const observed = initial();
    const fresh = { ...observed, contentRevision: observed.contentRevision + 2 };
    expect(() => validateSettingsReplacement(observed, fresh)).toThrow();
    expect(() => validateSettingsReplacement(undefined, observed)).toThrow();
  });
});
