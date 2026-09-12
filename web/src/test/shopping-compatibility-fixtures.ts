import { canonicalizeRecipeFixture } from './recipe-fixtures'
import { createEmptyShoppingDocument, createShoppingRecipeEntry } from '@/lib/shopping-document'
import { parseQuantityV1 } from '@/lib/recipe-quantity'
import type { LegacyIndependentNeed } from '@/lib/shopping-target-legacy'

export const ONE = { numerator: '1', denominator: '1' }
export function shoppingCompatibilityFixture() {
  const document = createEmptyShoppingDocument()
  const recipes = [
    canonicalizeRecipeFixture({ id: '00000000-0000-4000-8000-000000000001', name: 'Soup',
      fixtureIngredients: [{ item: 'lemon', amount: 2, unit: 'count' }] }),
    canonicalizeRecipeFixture({ id: '00000000-0000-4000-8000-000000000002', name: 'Soup',
      fixtureIngredients: [{ item: 'lemon', amount: 1, unit: 'count' }] }),
    canonicalizeRecipeFixture({ id: '00000000-0000-4000-8000-000000000003', name: 'Manual',
      fixtureIngredients: ['1–2', '1–2'].map(amount => ({ item: 'carrot', amount, unit: '', quantityV1: parseQuantityV1(amount)! })) }),
    canonicalizeRecipeFixture({ id: '00000000-0000-4000-8000-000000000004', name: 'Hidden',
      fixtureIngredients: [{ item: 'lime', amount: 1, unit: '' }] }),
    canonicalizeRecipeFixture({ id: '00000000-0000-4000-8000-000000000005', name: 'Empty' }),
  ]
  for (const recipe of recipes) document.recipeEntries[recipe.id] = createShoppingRecipeEntry(recipe, 4, ONE)
  const hidden = document.recipeEntries[recipes[3].id].ingredients[0].aggregateKey
  document.itemOverrides[hidden] = { suppressed: true }
  document.manualItems.push({ id: 'manual-extra', displayName: 'lemons', quantity: { amount: 3, unit: 'count' },
    categoryKey: 'produce', bucket: 'items', checked: false },
  { id: 'unknown-category', displayName: 'paper towels', quantity: null,
    categoryKey: 'missing-category', bucket: 'items', checked: false })
  document.preferences.ingredientOrderByCategory = { produce: ['carrot', 'dormant', 'lemon', 'lime'] }
  return { document, recipes }
}

export const legacyIndependentFixture: LegacyIndependentNeed = {
  kind: 'legacyIndependent', id: 'legacy-1', version: 3,
  raw: { id: 'legacy-1', amount: 3, checked: true, categoryKey: 'missing-category' },
  displayName: 'lemons', quantity: parseQuantityV1('3'),
  categoryEvidence: ['produce', 'missing-category'],
  orderEvidence: [['hidden', 'lemon'], ['lemon', 'hidden']],
  previousChecked: true, sourceHistory: null,
  unresolvedReasons: ['amount-meaning-unavailable', 'conflicting-placement'],
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}
