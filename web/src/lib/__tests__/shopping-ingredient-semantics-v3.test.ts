import { describe, expect, it } from 'vitest'
import type { PantryItem } from '@/types/database'
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
  upgradeShoppingDocumentV2,
  type ShoppingDocumentV2,
  type ShoppingDocumentV3,
  type ShoppingRecipeIngredientV2,
} from '../shopping-document'
import {
  exclusionSemanticsMatch,
  pantrySemanticsSatisfy,
  resolveShoppingIngredientSemantics,
} from '../shopping-ingredient-semantics'
import { resolveShoppingIngredient } from '../shopping-ingredient-resolution'
import { parseIngredientLine } from '../recipe-parser'

function semantics(item: string, unit = '', modifier?: string) {
  return resolveShoppingIngredientSemantics({ item, unit, modifier })
}

function resolvedLine(line: string, recipeId = 'recipe-a') {
  return resolveShoppingIngredient({
    ingredient: parseIngredientLine(line),
    recipeId,
  })
}

function persistedLine(
  line: string,
  recipeId = 'recipe-a'
): ShoppingRecipeIngredientV2 {
  const {
    runtime: _runtime,
    sourceOrdinal: _sourceOrdinal,
    defaultCategoryOrder: _defaultCategoryOrder,
    ...ingredient
  } = resolvedLine(line, recipeId)
  return ingredient
}

function documentWithLines(lines: string[]): ShoppingDocumentV3 {
  const document = createEmptyShoppingDocument()
  document.recipeEntries['recipe-a'] = {
    recipeId: 'recipe-a',
    recipeName: 'Anonymous fixture',
    selectedServings: 1,
    scaleV1: { numerator: '1', denominator: '1' },
    ingredients: lines.map((line) => persistedLine(line)),
  }
  return document
}

function pantry(item: string): PantryItem {
  return { item } as PantryItem
}

describe('Shopping ingredient semantics V3 regression contract', () => {
  const mustMerge: Array<[string, string, string?, string?]> = [
    ['cilantro', 'fresh cilantro'],
    ['chopped fresh cilantro', 'cilantro', '', 'chopped'],
    ['egg', 'large eggs', 'large'],
    ['garlic', 'small garlic clove', 'cloves'],
    ['jasmine rice', 'cooked jasmine rice'],
    ['jasmine rice', 'cooked day-old jasmine rice'],
    ['cumin', 'ground cumin'],
    ['onion', 'onions'],
    ['diced onion', 'onion'],
  ]

  it.each(mustMerge)(
    'merges %s with %s only at purchase identity',
    (left, right, leftUnit = '', leftModifier) => {
      expect(semantics(left, leftUnit, leftModifier).purchaseKey).toBe(
        semantics(right).purchaseKey
      )
    }
  )

  it.each([
    ['paprika', 'smoked paprika'],
    ['oregano', 'dried oregano'],
    ['oregano', 'Mexican oregano'],
    ['large egg', 'medium egg'],
    ['red onion', 'yellow onion'],
    ['red onion', 'green onion'],
    ['rice', 'jasmine rice'],
    ['jasmine rice', 'basmati rice'],
    ['yogurt', 'Greek yogurt'],
    ['olive oil', 'extra-virgin olive oil'],
    ['garlic', 'garlic powder'],
    ['chicken breast', 'chicken thigh'],
  ])('does not merge %s with %s', (left, right) => {
    expect(semantics(left).purchaseKey).not.toBe(semantics(right).purchaseKey)
  })

  it.each([
    ['oregano', 'dried oregano', true],
    ['cumin', 'ground cumin', true],
    ['oregano', 'Mexican oregano', false],
    ['paprika', 'smoked paprika', false],
    ['garlic', 'garlic powder', false],
  ])('matches exclusion %s to %s = %s', (excluded, item, expected) => {
    expect(exclusionSemanticsMatch(semantics(excluded), semantics(item))).toBe(
      expected
    )
  })

  it.each([
    ['rice', 'cooked jasmine rice', true],
    ['rice', 'basmati rice', true],
    ['jasmine rice', 'basmati rice', false],
    ['cilantro', 'fresh cilantro', true],
    ['garlic', 'garlic cloves', true],
    ['cumin', 'ground cumin', true],
    ['paprika', 'smoked paprika', false],
    ['oregano', 'Mexican oregano', false],
    ['onion', 'red onion', false],
    ['yogurt', 'Greek yogurt', false],
    ['olive oil', 'extra-virgin olive oil', false],
    ['garlic', 'garlic powder', false],
    ['pepper', 'black pepper', false],
  ])('matches Pantry %s to %s = %s', (owned, needed, expected) => {
    expect(pantrySemanticsSatisfy(semantics(owned), semantics(needed))).toBe(
      expected
    )
  })

  it.each([
    'pinch of salt',
    'salt to taste',
    'kosher salt',
    'sea salt',
    'Maldon salt',
  ])('recognizes %s as the salt family', (item) => {
    expect(semantics(item).familyKey).toBe('salt')
  })

  it.each([
    'black pepper',
    'ground black pepper',
    'freshly ground black pepper',
    'cracked black pepper',
  ])('recognizes %s as the black-pepper family', (item) => {
    expect(semantics(item).familyKey).toBe('black-pepper')
  })

  it.each(['pepper', 'white pepper', 'red pepper flakes', 'chile peppers'])(
    'does not absorb %s into the black-pepper family',
    (item) => expect(semantics(item).familyKey).not.toBe('black-pepper')
  )

  it('keeps unknown inputs literal and conservative', () => {
    expect(semantics('  Preserved Mystery Leaves  ')).toMatchObject({
      purchaseKey: 'preserved mystery leaves',
      familyKey: 'preserved mystery leaves',
      pantryMatchKeys: ['preserved mystery leaves'],
      familyMatchPolicy: {},
    })
  })
})

describe('Shopping projection semantic behavior', () => {
  it.each([
    ['⅜ lemon', 1, 'count'],
    ['1.2 limes', 2, 'count'],
  ])('rounds discrete %s only after aggregation', (line, amount, unit) => {
    const document = documentWithLines([line])
    const row = projectShoppingDocument(document).items[0]
    expect(row.quantity).toMatchObject({ amount, unit })
    expect(document.recipeEntries['recipe-a'].ingredients[0].quantity
      ?.exactQuantityV1).toBeDefined()
  })

  it('aggregates fractional discrete rows before rounding', () => {
    const row = projectShoppingDocument(
      documentWithLines(['½ onion', '½ onion'])
    ).items[0]
    expect(row.quantity).toMatchObject({ amount: 1, unit: 'count' })
  })

  it('does not round measured continuous quantities', () => {
    const row = projectShoppingDocument(
      documentWithLines(['½ cup onion'])
    ).items[0]
    expect(row.quantity).toMatchObject({ amount: 0.5, unit: 'cup' })
  })

  it('preserves non-terminating measured fractions without display rounding', () => {
    const row = projectShoppingDocument(
      documentWithLines(['⅓ cup sugar'])
    ).items[0]
    expect(row.quantity?.amount).toBeCloseTo(1 / 3)
    expect(row.quantity?.exactQuantityV1).toMatchObject({
      kind: 'exact',
      value: { numerator: '1', denominator: '3' },
    })
  })

  it('preserves ranges and packages exactly', () => {
    const document = documentWithLines([
      '1-2 cups milk',
      '2 (14 oz) cans tomatoes',
    ])
    const rows = projectShoppingDocument(document).items
    expect(rows.find((row) => row.displayName === 'milk')?.quantity
      ?.exactQuantityV1?.kind).toBe('range')
    expect(rows.find((row) => row.displayName === 'tomato')?.quantity
      ?.exactPackageV1).toBeDefined()
  })

  it('uses semantic default category before keyword fallback', () => {
    expect(projectShoppingDocument(documentWithLines(['dried oregano']))
      .items[0].categoryKey).toBe('pantry')
  })

  it('applies directional Pantry matching and conservative misses', () => {
    expect(projectShoppingDocument(
      documentWithLines(['cooked jasmine rice']),
      [pantry('rice')]
    ).alreadyHave).toHaveLength(1)
    expect(projectShoppingDocument(
      documentWithLines(['smoked paprika']),
      [pantry('paprika')]
    ).items).toHaveLength(1)
  })

  it.each([
    ['fresh cilantro', 'cilantro'],
    ['garlic cloves', 'garlic'],
    ['ground cumin', 'cumin'],
    ['kosher salt', 'sea salt'],
    ['freshly ground black pepper', 'black pepper'],
  ])('lets Pantry %s satisfy recipe form %s', (line, pantryItem) => {
    expect(projectShoppingDocument(
      documentWithLines([line]),
      [pantry(pantryItem)]
    ).alreadyHave).toHaveLength(1)
  })

  it('applies safe exclusions without broad family equality', () => {
    const oregano = documentWithLines(['dried oregano'])
    oregano.preferences.excludedIngredientKeys = ['oregano']
    expect(projectShoppingDocument(oregano).excluded).toHaveLength(1)

    const mexican = documentWithLines(['Mexican oregano'])
    mexican.preferences.excludedIngredientKeys = ['oregano']
    expect(projectShoppingDocument(mexican).items).toHaveLength(1)
  })

  it.each([
    ['ground cumin', 'cumin'],
    ['dried oregano', 'oregano'],
  ])('excludes safe form %s from %s', (line, excluded) => {
    const document = documentWithLines([line])
    document.preferences.excludedIngredientKeys = [excluded]
    expect(projectShoppingDocument(document).excluded).toHaveLength(1)
  })

  it.each([
    'pinch of salt',
    'salt to taste',
    'kosher salt',
    'sea salt',
    'Maldon salt',
  ])('applies the Salt variants toggle to %s', (line) => {
    const document = documentWithLines([line])
    document.preferences.excludeSaltVariants = true
    expect(projectShoppingDocument(document).excluded).toHaveLength(1)
  })

  it.each([
    'black pepper',
    'ground black pepper',
    'freshly ground black pepper',
    'cracked black pepper',
  ])('applies the Black Pepper variants toggle to %s', (line) => {
    const document = documentWithLines([line])
    document.preferences.excludeBlackPepperVariants = true
    expect(projectShoppingDocument(document).excluded).toHaveLength(1)
  })
})

describe('manual row shadowing', () => {
  function withManual(quantity: null | { amount: number | null; unit: string }) {
    const document = documentWithLines(['1 cup orange juice'])
    document.manualItems.push({
      id: 'manual-orange-juice',
      displayName: 'orange juice',
      quantity,
      categoryKey: 'produce',
      bucket: 'items',
      checked: false,
    })
    return document
  }

  it('shadows an unchecked unquantified duplicate without deleting it', () => {
    const document = withManual(null)
    expect(projectShoppingDocument(document).rows).toHaveLength(1)
    expect(document.manualItems).toHaveLength(1)

    delete document.recipeEntries['recipe-a']
    expect(projectShoppingDocument(document).items[0].rowRef).toBe(
      'manual:manual-orange-juice'
    )
  })

  it('keeps quantified, checked, and conflicting manual rows separate', () => {
    expect(projectShoppingDocument(withManual({ amount: 1, unit: 'cup' })).rows)
      .toHaveLength(2)

    const checked = withManual(null)
    checked.manualItems[0].checked = true
    expect(projectShoppingDocument(checked).rows).toHaveLength(2)

    const pantryBucket = withManual(null)
    pantryBucket.manualItems[0].bucket = 'already_have'
    expect(projectShoppingDocument(pantryBucket).rows).toHaveLength(2)
  })
})

describe('ShoppingDocumentV2 to V3 upgrade', () => {
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

  function legacyCollisionDocument(
    leftOverride: { checked: boolean; displayName?: string },
    rightOverride: { checked: boolean; displayName?: string }
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
      itemOverrides: {
        [cilantro.aggregateKey]: leftOverride,
        [fresh.aggregateKey]: rightOverride,
      },
    } as unknown as ShoppingDocumentV2
  }

  it('recomputes semantic keys and remaps reusable preferences', () => {
    const legacy = {
      ...createEmptyShoppingDocument(),
      schemaVersion: 2,
      recipeEntries: {
        a: {
          recipeId: 'a',
          recipeName: 'Anonymous A',
          selectedServings: 1,
          scaleV1: { numerator: '1', denominator: '1' },
          ingredients: [{
            ingredientKey: 'fresh cilantro',
            aggregateKey: JSON.stringify([
              'shopping-aggregate',
              1,
              'fresh cilantro',
            ]),
            displayName: 'fresh cilantro',
            quantity: null,
            purchaseUnit: '',
            defaultCategoryKey: 'produce',
            pantryMatchKeys: ['fresh cilantro'],
          }],
        },
      },
      preferences: {
        ...createEmptyShoppingDocument().preferences,
        categoryByIngredient: { 'fresh cilantro': 'produce' },
        ingredientOrderByCategory: {
          produce: ['fresh cilantro', 'cilantro'],
        },
        excludedIngredientKeys: ['ground cumin', 'cumin'],
      },
    } as unknown as ShoppingDocumentV2

    const upgraded = upgradeShoppingDocumentV2(legacy)
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    expect(upgraded.document.schemaVersion).toBe(3)
    expect(upgraded.document.recipeEntries.a.ingredients[0]).toMatchObject({
      purchaseKey: 'cilantro',
      familyKey: 'cilantro',
    })
    expect(upgraded.document.preferences.categoryByIngredient).toEqual({
      cilantro: 'produce',
    })
    expect(upgraded.document.preferences.ingredientOrderByCategory.produce)
      .toEqual(['cilantro'])
    expect(upgraded.document.preferences.excludedIngredientKeys).toEqual([
      'cumin',
    ])
  })

  it('merges newly compatible legacy groups with identical overrides', () => {
    const upgraded = upgradeShoppingDocumentV2(
      legacyCollisionDocument(
        { checked: true, displayName: 'cilantro' },
        { displayName: 'cilantro', checked: true }
      )
    )
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    const aggregateKeys = Object.values(upgraded.document.recipeEntries)
      .map((entry) => entry.ingredients[0].aggregateKey)
    expect(new Set(aggregateKeys).size).toBe(1)
    expect(Object.values(upgraded.document.itemOverrides)).toEqual([
      { checked: true, displayName: 'cilantro' },
    ])
  })

  it('keeps newly compatible legacy groups separate when overrides conflict', () => {
    const upgraded = upgradeShoppingDocumentV2(
      legacyCollisionDocument({ checked: true }, { checked: false })
    )
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    const aggregateKeys = Object.values(upgraded.document.recipeEntries)
      .map((entry) => entry.ingredients[0].aggregateKey)
    expect(new Set(aggregateKeys).size).toBe(2)
    expect(Object.values(upgraded.document.itemOverrides)).toEqual(
      expect.arrayContaining([{ checked: true }, { checked: false }])
    )
  })
})
