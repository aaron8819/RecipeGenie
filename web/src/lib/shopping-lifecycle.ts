import type { ShoppingDocumentV3 } from './shopping-document';
import type { ShoppingCommand } from './shopping-command';

/** Owner organization survives a trip. Everything else is content intent. */
export function isShoppingContentCommand(type: ShoppingCommand['mutation']['type']): boolean {
  return !['initialize', 'deleteRecipe', 'setExclusion', 'setFamilySetting',
    'updatePreferences', 'updateCategoryPreferences', 'learnOrder', 'resolvePlacement'].includes(type);
}

export function restoredShoppingContent(document: ShoppingDocumentV3, inverse: Pick<ShoppingDocumentV3,
  'recipeEntries' | 'manualItems' | 'itemOverrides' | 'acknowledgements'>): ShoppingDocumentV3 {
  const next = { ...document, ...structuredClone(inverse) };
  const categories = new Set(['produce', 'deli', 'bakery', 'protein', 'dairy', 'pantry', 'frozen', 'misc',
    ...document.preferences.customCategories.map(category => `custom_${category.id}`)]);
  // Legacy amounts have an independent location. A deleted category is never
  // recreated by content Undo; retained placement determines its fallback.
  next.manualItems = next.manualItems.map(item => categories.has(item.categoryKey) ? item : {
    ...item, categoryKey: document.preferences.categoryByIngredient[item.identity?.purchaseKey ?? ''] ?? 'misc',
  });
  return next;
}
