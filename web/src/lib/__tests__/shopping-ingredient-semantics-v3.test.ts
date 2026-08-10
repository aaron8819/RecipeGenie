import { describe, expect, it } from 'vitest'
import type { PantryItem } from '@/types/database'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  projectShoppingDocument,
  upgradeShoppingDocumentV2,
  validateShoppingDocumentStateV3,
  validateShoppingDocumentV3,
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

function historicalV3Line(
  purchaseKey: string,
  line = purchaseKey,
  recipeId = 'recipe-a'
): ShoppingRecipeIngredientV2 {
  const current = persistedLine(line, recipeId)
  return {
    ...current,
    purchaseKey,
    aggregateKey: JSON.stringify(['shopping-aggregate', 2, purchaseKey]),
    displayName: purchaseKey,
    pantryMatchKeys: [purchaseKey],
  }
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
    ['garlic', 'finely grated small garlic clove', 'clove'],
    ['garlic', 'garlic', 'clove', 'finely grated'],
    ['avocado', 'sliced avocado'],
    ['avocado', 'diced avocado'],
    ['avocado', 'sliced or diced avocado'],
    ['jasmine rice', 'warm cooked jasmine rice'],
    ['onion', 'white onion'],
    ['onion', 'yellow onion'],
    ['onion', 'onion', '', 'white'],
    ['onion', 'onion', '', 'yellow'],
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
    ['rice', 'fried rice'],
    ['onion', 'pearl onion'],
    ['onion', 'pickled red onion'],
    ['spinach', 'frozen spinach'],
    ['chicken breast', 'chicken thigh'],
  ])('does not merge %s with %s', (left, right) => {
    expect(semantics(left).purchaseKey).not.toBe(semantics(right).purchaseKey)
  })

  it.each([
    ['paprika', 'smoked', 'smoked paprika'],
    ['oregano', 'dried', 'dried oregano'],
    ['yogurt', 'Greek', 'greek yogurt'],
    ['chicken breast', 'boneless', 'boneless chicken breast'],
    ['mystery leaves', 'ceremonial', 'ceremonial mystery leaves'],
  ])('preserves purchase-significant modifier %s + %s', (
    item,
    modifier,
    expected
  ) => {
    expect(semantics(item, '', modifier).purchaseKey).toBe(expected)
    expect(semantics(item).purchaseKey).not.toBe(expected)
  })

  it('still extracts explicitly approved structured preparation', () => {
    expect(semantics('cilantro', '', 'chopped')).toMatchObject({
      purchaseKey: 'cilantro',
      preparation: ['chopped'],
    })
  })

  it.each([
    ['finely grated small garlic clove', '', 'garlic'],
    ['garlic', 'finely grated', 'garlic'],
    ['sliced avocado', '', 'avocado'],
    ['avocado', 'diced', 'avocado'],
    ['as needed water', '', 'water'],
    ['or to taste kosher salt', '', 'kosher salt'],
    ['kosher salt', 'to taste', 'kosher salt'],
    ['warm cooked jasmine rice', '', 'jasmine rice'],
  ])('normalizes item %s with modifier %s to %s', (
    item,
    modifier,
    expected
  ) => {
    expect(semantics(item, '', modifier).purchaseName).toBe(expected)
  })

  it.each([
    ['small onion', '', 'onion'],
    ['large onion', '', 'onion'],
    ['small white onion', '', 'onion'],
    ['large yellow onions', '', 'onion'],
    ['diced small yellow onion', '', 'onion'],
    ['yellow onion', 'small', 'onion'],
    ['small red onion', '', 'red onion'],
    ['large red onion', '', 'red onion'],
    ['small green onion', '', 'green onion'],
    ['red onion', 'large', 'red onion'],
  ])('applies controlled onion size semantics for %s + %s', (
    item,
    modifier,
    expected
  ) => {
    expect(semantics(item, '', modifier).purchaseKey).toBe(expected)
  })

  it('does not broaden onion size handling to egg size', () => {
    expect(semantics('eggs', 'large').purchaseKey).toBe('large egg')
    expect(semantics('egg', '', 'large').purchaseKey).toBe('large egg')
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
    ['rice', 'cauliflower rice', false],
    ['rice', 'broccoli rice', false],
    ['rice', 'fried rice', false],
  ])('matches Pantry %s to %s = %s', (owned, needed, expected) => {
    expect(pantrySemanticsSatisfy(semantics(owned), semantics(needed))).toBe(
      expected
    )
  })

  it.each([
    'pinch of salt',
    'salt to taste',
    'kosher salt, to taste',
    'kosher salt',
    'sea salt',
    'Maldon salt',
    'or to taste kosher salt',
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

  it('keeps ambiguous preparation alternatives literal', () => {
    expect(semantics('tomatoes, drained, chopped, or diced').purchaseKey)
      .toBe('tomatoes drained chopped or diced')
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

  it('merges prepared purchase forms and keeps source preparation evidence', () => {
    const row = projectShoppingDocument(documentWithLines([
      '1 clove garlic',
      '1 finely grated small garlic clove',
      '1 clove garlic, finely grated',
      '1 avocado',
      '1 sliced avocado',
      '1 diced avocado',
      '1 sliced or diced avocado',
    ])).items

    expect(row).toHaveLength(2)
    expect(row.find((item) => item.displayName === 'garlic')).toMatchObject({
      quantity: { amount: 3, unit: 'clove' },
    })
    expect(row.find((item) => item.displayName === 'garlic')?.sources[1]
      .preparationModifiers).toEqual(['finely grated', 'small'])
    expect(row.find((item) => item.displayName === 'garlic')?.sources[2]
      .preparationModifiers).toEqual(['finely grated'])
    expect(row.find((item) => item.displayName === 'avocado')?.sources)
      .toHaveLength(4)
    expect(row.find((item) => item.displayName === 'avocado')?.sources[3]
      .preparationModifiers).toEqual(['diced', 'sliced'])
  })

  it('merges only the approved onion purchase forms', () => {
    const rows = projectShoppingDocument(documentWithLines([
      '1 onion',
      '1 white onion',
      '1 yellow onion',
      '1 red onion',
    ])).items

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.displayName === 'onion')?.quantity)
      .toMatchObject({ amount: 3, unit: 'count' })
    expect(rows.find((row) => row.displayName === 'red onion')).toBeDefined()
  })

  it.each([
    ['as needed water', 'water'],
    ['½ tsp or to taste kosher salt', 'kosher salt'],
    ['2 cup warm cooked jasmine rice', 'jasmine rice'],
    ['1 sliced avocado', 'avocado'],
    ['1 sliced or diced avocado', 'avocado'],
  ])('uses cleaned primary display for %s', (line, expected) => {
    expect(projectShoppingDocument(documentWithLines([line])).rows[0]
      .displayName).toBe(expected)
  })

  it('applies exclusion and Pantry policy after purchase cleanup', () => {
    const water = documentWithLines(['as needed water'])
    water.preferences.excludedIngredientKeys = ['water']
    expect(projectShoppingDocument(water).excluded).toHaveLength(1)

    const salt = documentWithLines(['½ tsp or to taste kosher salt'])
    salt.preferences.excludeSaltVariants = true
    expect(projectShoppingDocument(salt).excluded).toHaveLength(1)

    expect(projectShoppingDocument(
      documentWithLines(['2 cup warm cooked jasmine rice']),
      [pantry('rice')]
    ).alreadyHave).toHaveLength(1)
    expect(projectShoppingDocument(
      documentWithLines(['1 finely grated small garlic clove']),
      [pantry('garlic')]
    ).alreadyHave).toHaveLength(1)
    expect(projectShoppingDocument(
      documentWithLines(['1 sliced avocado']),
      [pantry('avocado')]
    ).alreadyHave).toHaveLength(1)
  })

  it('preserves exact 5/8 cup cilantro without inventing a bunch conversion', () => {
    const row = projectShoppingDocument(
      documentWithLines(['5/8 cup cilantro'])
    ).items[0]

    expect(row.quantity).toMatchObject({
      amount: 5 / 8,
      unit: 'cup',
      exactQuantityV1: {
        kind: 'exact',
        value: { numerator: '5', denominator: '8' },
      },
    })
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

describe('ShoppingDocumentV3 semantic reconciliation', () => {
  function historicalDocument(
    ingredients: Array<[string, string]>
  ): ShoppingDocumentV3 {
    const document = createEmptyShoppingDocument()
    document.recipeEntries = Object.fromEntries(ingredients.map(
      ([recipeId, purchaseKey]) => [recipeId, {
        recipeId,
        recipeName: `Historical ${purchaseKey}`,
        selectedServings: 1,
        scaleV1: { numerator: '1', denominator: '1' },
        ingredients: [historicalV3Line(purchaseKey, `1 ${purchaseKey}`, recipeId)],
      }]
    ))
    return document
  }

  it.each(['yellow onion', 'white onion'])(
    'reconciles an unambiguous persisted %s identity and preferences',
    (historicalKey) => {
      const document = historicalDocument([['recipe-a', historicalKey]])
      const oldAggregate = document.recipeEntries['recipe-a'].ingredients[0]
        .aggregateKey
      document.itemOverrides[oldAggregate] = { checked: true }
      document.preferences.categoryByIngredient[historicalKey] = 'dairy'
      document.preferences.ingredientOrderByCategory = {
        dairy: [historicalKey],
      }
      document.preferences.excludedIngredientKeys = [historicalKey]

      const reconciled = validateShoppingDocumentStateV3({
        document,
        contentRevision: 4,
      })
      expect(reconciled.ok).toBe(true)
      if (!reconciled.ok) return

      const ingredient = reconciled.document.recipeEntries['recipe-a']
        .ingredients[0]
      expect(ingredient).toMatchObject({
        purchaseKey: 'onion',
        displayName: 'onion',
        pantryMatchKeys: ['onion'],
      })
      expect(JSON.parse(ingredient.aggregateKey).slice(0, 3)).toEqual([
        'shopping-aggregate',
        2,
        'onion',
      ])
      expect(reconciled.document.preferences.categoryByIngredient).toEqual({
        onion: 'dairy',
      })
      expect(reconciled.document.preferences.ingredientOrderByCategory)
        .toEqual({ dairy: ['onion'] })
      expect(reconciled.document.preferences.excludedIngredientKeys)
        .toEqual(['onion'])
      expect(reconciled.document.itemOverrides).toEqual({
        [ingredient.aggregateKey]: { checked: true },
      })
      expect(projectShoppingDocument(reconciled.document).rows[0])
        .toMatchObject({ orderingKey: 'onion', categoryKey: 'dairy' })

      const repeated = validateShoppingDocumentStateV3({
        document: reconciled.document,
        contentRevision: 5,
      })
      expect(repeated.ok).toBe(true)
      if (repeated.ok) expect(repeated.document).toEqual(reconciled.document)
    }
  )

  it('preserves conflicting historical category and cross-category order', () => {
    const document = historicalDocument([
      ['recipe-white', 'white onion'],
      ['recipe-yellow', 'yellow onion'],
    ])
    document.preferences.categoryByIngredient = {
      'white onion': 'produce',
      'yellow onion': 'dairy',
    }
    document.preferences.ingredientOrderByCategory = {
      produce: ['white onion'],
      dairy: ['yellow onion'],
    }

    const reconciled = validateShoppingDocumentStateV3({
      document,
      contentRevision: 2,
    })
    expect(reconciled.ok).toBe(true)
    if (!reconciled.ok) return

    expect(reconciled.document.preferences.categoryByIngredient).toEqual(
      document.preferences.categoryByIngredient
    )
    expect(reconciled.document.preferences.ingredientOrderByCategory).toEqual(
      document.preferences.ingredientOrderByCategory
    )
    expect(Object.values(reconciled.document.recipeEntries).map((entry) =>
      entry.ingredients[0].purchaseKey).sort()).toEqual([
      'white onion',
      'yellow onion',
    ])
    expect(projectShoppingDocument(reconciled.document).rows.map((row) => [
      row.orderingKey,
      row.categoryKey,
    ])).toEqual([
      ['white onion', 'produce'],
      ['yellow onion', 'dairy'],
    ])
  })

  it('preserves conflicting row overrides with stable discriminators', () => {
    const document = historicalDocument([
      ['recipe-white', 'white onion'],
      ['recipe-yellow', 'yellow onion'],
    ])
    const [white, yellow] = Object.values(document.recipeEntries).map(
      (entry) => entry.ingredients[0]
    )
    document.itemOverrides[white.aggregateKey] = { checked: true }
    document.itemOverrides[yellow.aggregateKey] = { bucket: 'already_have' }

    const reconciled = validateShoppingDocumentStateV3({
      document,
      contentRevision: 3,
    })
    expect(reconciled.ok).toBe(true)
    if (!reconciled.ok) return

    const ingredients = Object.values(reconciled.document.recipeEntries).map(
      (entry) => entry.ingredients[0]
    )
    expect(ingredients.map((ingredient) => ingredient.purchaseKey))
      .toEqual(['onion', 'onion'])
    expect(new Set(ingredients.map((ingredient) => ingredient.aggregateKey)).size)
      .toBe(2)
    expect(Object.values(reconciled.document.itemOverrides)).toEqual([
      { checked: true },
      { bucket: 'already_have' },
    ])

    const repeated = validateShoppingDocumentStateV3({
      document: reconciled.document,
      contentRevision: 4,
    })
    expect(repeated.ok).toBe(true)
    if (repeated.ok) expect(repeated.document).toEqual(reconciled.document)
  })

  it('merges a reconciled historical aggregate with a newly resolved entry', () => {
    const document = historicalDocument([['recipe-old', 'yellow onion']])
    const reconciled = validateShoppingDocumentStateV3({
      document,
      contentRevision: 1,
    })
    expect(reconciled.ok).toBe(true)
    if (!reconciled.ok) return

    const next = applyShoppingDocumentMutation({
      document: reconciled.document,
      contentRevision: reconciled.contentRevision!,
    }, {
      type: 'upsertRecipe',
      entry: {
        recipeId: 'recipe-new',
        recipeName: 'Current onion',
        selectedServings: 1,
        scaleV1: { numerator: '1', denominator: '1' },
        ingredients: [persistedLine('1 onion', 'recipe-new')],
      },
    })
    expect(projectShoppingDocument(next.document).items).toHaveLength(1)
    expect(projectShoppingDocument(next.document).items[0]).toMatchObject({
      orderingKey: 'onion',
      quantity: { amount: 2, unit: 'count' },
    })
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

  function legacyPreferenceDocument(
    categoryByIngredient: Record<string, string>,
    ingredientOrderByCategory: Record<string, string[]>
  ): ShoppingDocumentV2 {
    const document = legacyCollisionDocument(
      { checked: false },
      { checked: false }
    )
    document.itemOverrides = {}
    document.preferences.categoryByIngredient = categoryByIngredient
    document.preferences.ingredientOrderByCategory = ingredientOrderByCategory
    return document
  }

  function productionPersistenceRegressionDocument(): ShoppingDocumentV2 {
    const empty = createEmptyShoppingDocument()
    const ingredientOrderByCategory: Record<string, string[]> = {}
    const recipeEntries = Object.fromEntries(Array.from({ length: 4 }, (_, recipeIndex) => {
      const recipeId = `recipe-${recipeIndex + 1}`
      const ingredients = Array.from({ length: 24 }, (_, ingredientIndex) => {
        const absoluteIndex = (recipeIndex * 24) + ingredientIndex + 1
        const key = `anonymized-item-${absoluteIndex}`
        const categoryKey = `category-${((absoluteIndex - 1) % 5) + 1}`
        ingredientOrderByCategory[categoryKey] = [
          ...(ingredientOrderByCategory[categoryKey] || []),
          key,
        ]
        return legacyIngredient(key)
      })
      return [recipeId, {
        recipeId,
        recipeName: `Anonymized production recipe ${recipeIndex + 1}`,
        selectedServings: recipeIndex + 1,
        scaleV1: { numerator: String(recipeIndex + 1), denominator: '1' },
        ingredients,
      }]
    }))

    return {
      ...empty,
      schemaVersion: 2,
      recipeEntries,
      manualItems: [{
        id: 'manual-production-shape',
        displayName: 'Anonymized manual item',
        quantity: null,
        categoryKey: 'category-1',
        bucket: 'items',
        checked: false,
      }],
      preferences: {
        ...empty.preferences,
        ingredientOrderByCategory,
      },
    } as ShoppingDocumentV2
  }

  it('upgrades and serializes the exact production persistence shape', () => {
    const upgraded = upgradeShoppingDocumentV2(
      productionPersistenceRegressionDocument()
    )
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    const serialized = JSON.parse(JSON.stringify(upgraded.document))
    expect(validateShoppingDocumentV3(serialized).ok).toBe(true)
    expect(Object.keys(serialized.recipeEntries)).toHaveLength(4)
    expect(Object.values(serialized.recipeEntries).flatMap(
      (entry) => (entry as ShoppingDocumentV3['recipeEntries'][string]).ingredients
    )).toHaveLength(96)
    expect(serialized.manualItems).toHaveLength(1)
    expect(Object.keys(serialized.preferences.ingredientOrderByCategory))
      .toHaveLength(5)
  })

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

  it('deduplicates identical remapped category preferences safely', () => {
    const upgraded = upgradeShoppingDocumentV2(legacyPreferenceDocument(
      { cilantro: 'produce', 'fresh cilantro': 'produce' },
      {}
    ))
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    expect(upgraded.document.preferences.categoryByIngredient).toEqual({
      cilantro: 'produce',
    })
  })

  it('preserves conflicting remapped category preferences', () => {
    const upgraded = upgradeShoppingDocumentV2(legacyPreferenceDocument(
      { cilantro: 'pantry', 'fresh cilantro': 'produce' },
      {}
    ))
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    expect(upgraded.document.preferences.categoryByIngredient).toEqual({
      cilantro: 'pantry',
      'fresh cilantro': 'produce',
    })
  })

  it('deduplicates same-category ordering entries in first-seen order', () => {
    const upgraded = upgradeShoppingDocumentV2(legacyPreferenceDocument(
      {},
      { produce: ['fresh cilantro', 'cilantro'] }
    ))
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    expect(upgraded.document.preferences.ingredientOrderByCategory).toEqual({
      produce: ['cilantro'],
    })
  })

  it('preserves cross-category ordering conflicts', () => {
    const upgraded = upgradeShoppingDocumentV2(legacyPreferenceDocument(
      {},
      {
        produce: ['fresh cilantro'],
        pantry: ['cilantro'],
      }
    ))
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    expect(upgraded.document.preferences.ingredientOrderByCategory).toEqual({
      produce: ['fresh cilantro'],
      pantry: ['cilantro'],
    })
  })

  it('keeps conflicting collapsed recipe identities distinguishable', () => {
    const upgraded = upgradeShoppingDocumentV2(legacyPreferenceDocument(
      { cilantro: 'pantry', 'fresh cilantro': 'produce' },
      {
        pantry: ['cilantro'],
        produce: ['fresh cilantro'],
      }
    ))
    expect(upgraded.ok).toBe(true)
    if (!upgraded.ok) return

    const ingredients = Object.values(upgraded.document.recipeEntries)
      .map((entry) => entry.ingredients[0])
    expect(new Set(ingredients.map((ingredient) => ingredient.purchaseKey)))
      .toEqual(new Set(['cilantro', 'fresh cilantro']))
    expect(new Set(ingredients.map((ingredient) => ingredient.aggregateKey)).size)
      .toBe(2)
  })
})
