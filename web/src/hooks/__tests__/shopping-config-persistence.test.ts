import { describe, expect, it } from 'vitest'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  upgradeShoppingDocumentV2,
  validateShoppingDocumentStateV3,
  type ShoppingDocumentStateV3,
  type ShoppingDocumentV2,
} from '@/lib/shopping-document'
import {
  createShoppingConfigUpdateMutation,
  shoppingDocumentToConfig,
} from '@/hooks/shopping/use-shopping-document'

function legacyIngredient(item: string) {
  return {
    ingredientKey: item,
    aggregateKey: JSON.stringify(['shopping-aggregate', 1, item]),
    displayName: item,
    quantity: { amount: 1, unit: 'count' },
    purchaseUnit: 'count',
    defaultCategoryKey: 'produce',
    pantryMatchKeys: [item],
  }
}

function legacyPreferenceDocument(
  categoryByIngredient: Record<string, string>,
  ingredientOrderByCategory: Record<string, string[]>
): ShoppingDocumentV2 {
  const cilantro = legacyIngredient('cilantro')
  const fresh = legacyIngredient('fresh cilantro')
  return {
    ...createEmptyShoppingDocument(),
    schemaVersion: 2,
    recipeEntries: {
      a: {
        recipeId: 'a',
        recipeName: 'Anonymous A',
        selectedServings: 1,
        scaleV1: { numerator: '1', denominator: '1' },
        ingredients: [cilantro],
      },
      b: {
        recipeId: 'b',
        recipeName: 'Anonymous B',
        selectedServings: 1,
        scaleV1: { numerator: '1', denominator: '1' },
        ingredients: [fresh],
      },
    },
    itemOverrides: {},
    preferences: {
      ...createEmptyShoppingDocument().preferences,
      categoryByIngredient,
      ingredientOrderByCategory,
    },
  } as unknown as ShoppingDocumentV2
}

function upgrade(document: ShoppingDocumentV2): ShoppingDocumentStateV3 {
  const result = upgradeShoppingDocumentV2(document)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected a valid V2 fixture')
  return { document: result.document, contentRevision: 0 }
}

function settingsRoundTrip(
  state: ShoppingDocumentStateV3
): ShoppingDocumentStateV3 {
  const config = shoppingDocumentToConfig(state)
  const updated = applyShoppingDocumentMutation(
    state,
    createShoppingConfigUpdateMutation({
      category_overrides: config.category_overrides,
      custom_categories: config.custom_categories,
      category_order: config.category_order || ['pantry', 'produce'],
    })
  )
  const reloaded = validateShoppingDocumentStateV3(
    JSON.parse(JSON.stringify({
      document: updated.document,
      contentRevision: updated.contentRevision,
    }))
  )
  expect(reloaded.ok).toBe(true)
  expect(reloaded.contentRevision).toBeDefined()
  if (!reloaded.ok || reloaded.contentRevision === undefined) {
    throw new Error('Expected persisted V3 state to reload')
  }
  return {
    document: reloaded.document,
    contentRevision: reloaded.contentRevision,
  }
}

describe('Shopping V3 settings identity persistence', () => {
  it('preserves conflicting category identities through repeated round trips', () => {
    const first = settingsRoundTrip(upgrade(legacyPreferenceDocument(
      { cilantro: 'pantry', 'fresh cilantro': 'produce' },
      {}
    )))
    const second = settingsRoundTrip(first)

    expect(first.document.preferences.categoryByIngredient).toEqual({
      cilantro: 'pantry',
      'fresh cilantro': 'produce',
    })
    expect(second.document).toEqual(first.document)
  })

  it('keeps identical category preferences safely deduplicated', () => {
    const state = settingsRoundTrip(upgrade(legacyPreferenceDocument(
      { cilantro: 'produce', 'fresh cilantro': 'produce' },
      {}
    )))

    expect(state.document.preferences.categoryByIngredient).toEqual({
      cilantro: 'produce',
    })
  })

  it('preserves cross-category learned ordering identities', () => {
    const state = settingsRoundTrip(upgrade(legacyPreferenceDocument(
      { cilantro: 'pantry', 'fresh cilantro': 'produce' },
      {
        pantry: ['cilantro'],
        produce: ['fresh cilantro'],
      }
    )))

    expect(state.document.preferences.ingredientOrderByCategory).toEqual({
      pantry: ['cilantro'],
      produce: ['fresh cilantro'],
    })
  })

  it('keeps same-category ordering deduplicated and stable', () => {
    const state = settingsRoundTrip(upgrade(legacyPreferenceDocument(
      {},
      { produce: ['fresh cilantro', 'cilantro'] }
    )))

    expect(state.document.preferences.ingredientOrderByCategory).toEqual({
      produce: ['cilantro'],
    })
  })

  it('still canonicalizes newly entered raw exclusion text', () => {
    const state: ShoppingDocumentStateV3 = {
      document: createEmptyShoppingDocument(),
      contentRevision: 0,
    }
    const updated = applyShoppingDocumentMutation(
      state,
      createShoppingConfigUpdateMutation({
        excluded_keywords: ['fresh cilantro', 'ground cumin'],
      })
    )

    expect(updated.document.preferences.excludedIngredientKeys).toEqual([
      'cilantro',
      'cumin',
    ])
  })
})
