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

function persistedIngredient(
  ingredient: Parameters<typeof resolveShoppingIngredient>[0]['ingredient'],
  recipeId: string
): ShoppingRecipeIngredientV2 {
  const {
    runtime: _runtime,
    sourceOrdinal: _sourceOrdinal,
    defaultCategoryOrder: _defaultCategoryOrder,
    ...persisted
  } = resolveShoppingIngredient({ ingredient, recipeId })
  return persisted
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
    ['cilantro', 'finely chopped', ['finely chopped']],
    ['garlic', 'finely minced', ['finely minced']],
    ['onion', 'finely diced', ['finely diced']],
    ['parsley', 'roughly chopped', ['roughly chopped']],
    ['avocado', 'sliced or diced', ['diced', 'sliced']],
  ])('uses structured modifier evidence for %s / %s', (
    item,
    modifier,
    evidence
  ) => {
    expect(semantics(item, '', modifier)).toMatchObject({
      purchaseKey: item,
      preparation: evidence,
    })
  })

  it.each([
    ['finely chopped tomatoes', 'finely chopped tomato'],
    ['finely diced tomatoes', 'finely diced tomato'],
    ['roughly chopped onions', 'roughly chopped onion'],
    ['ground turkey', 'ground turkey'],
    ['smoked paprika', 'smoked paprika'],
    ['dried oregano', 'dried oregano'],
    ['roasted red peppers', 'roasted red pepper'],
    ['pickled onions', 'pickled onion'],
    ['frozen spinach', 'frozen spinach'],
  ])('keeps product-form free text %s distinct', (item, expected) => {
    expect(semantics(item)).toMatchObject({
      purchaseKey: expected,
      preparation: [],
    })
  })

  it.each([
    ['sliced bread', 'bread', 'sliced'],
    ['shredded cheese', 'cheese', 'shredded'],
    ['grated parmesan', 'parmesan', 'grated'],
    ['crushed tomatoes', 'tomato', 'crushed'],
  ])('captures the pre-existing leading-form contract for %s', (
    item,
    purchaseKey,
    preparation
  ) => {
    expect(semantics(item)).toMatchObject({
      purchaseKey,
      preparation: [preparation],
    })
  })

  it.each([
    ['garlic, finely chopped', 'garlic', 'finely chopped'],
    ['cilantro, roughly chopped', 'cilantro', 'roughly chopped'],
    ['onion, finely diced', 'onion', 'finely diced'],
    ['garlic, chopped', 'garlic', 'chopped'],
  ])('uses the longest trailing preparation in %s', (
    line,
    purchaseKey,
    preparation
  ) => {
    expect(semantics(line)).toMatchObject({
      purchaseKey,
      preparation: [preparation],
    })
    expect(parseIngredientLine(line)).toMatchObject({
      item: purchaseKey,
      modifier: preparation,
    })
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey,
      preparation: [preparation],
    })
  })

  it.each([
    ['garlic, very finely chopped', 'garlic very finely chopped'],
    ['garlic, chopped and minced', 'garlic chopped and minced'],
    ['garlic, finely chopped and minced', 'garlic finely chopped and minced'],
    ['garlic, finely roughly chopped', 'garlic finely roughly chopped'],
    ['garlic, chopped or minced', 'garlic chopped or minced'],
    ['cilantro, thoroughly roughly chopped', 'cilantro thoroughly roughly chopped'],
  ])('keeps unsupported trailing compound %s literal', (line, purchaseKey) => {
    expect(semantics(line)).toMatchObject({
      purchaseKey,
      preparation: [],
    })
  })

  it.each([
    [
      'garlic, very finely chopped',
      'garlic',
      'very finely chopped',
      'very finely chopped garlic',
    ],
    [
      'garlic, chopped and minced',
      'garlic',
      'chopped and minced',
      'chopped and minced garlic',
    ],
    [
      'garlic, finely roughly chopped',
      'garlic',
      'finely roughly chopped',
      'finely roughly chopped garlic',
    ],
    [
      'garlic, chopped or minced',
      'garlic',
      'chopped or minced',
      'chopped or minced garlic',
    ],
    [
      'garlic, finely chopped and minced',
      'garlic, finely chopped and minced',
      undefined,
      'garlic finely chopped and minced',
    ],
    [
      'cilantro, thoroughly roughly chopped',
      'cilantro, thoroughly roughly chopped',
      undefined,
      'cilantro thoroughly roughly chopped',
    ],
  ])('keeps parser modifier %s all-or-nothing', (
    line,
    item,
    modifier,
    purchaseKey
  ) => {
    expect(parseIngredientLine(line)).toMatchObject({ item, modifier })
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey,
      preparation: [],
    })
  })

  it.each([
    [
      'garlic, chopped, minced',
      'garlic chopped minced',
    ],
    [
      'garlic, very finely chopped, minced',
      'garlic very finely chopped minced',
    ],
    [
      'garlic, finely chopped, minced',
      'garlic finely chopped minced',
    ],
  ])('keeps the complete multi-comma suffix atomic in %s', (
    line,
    purchaseKey
  ) => {
    expect(parseIngredientLine(line)).toMatchObject({
      item: line,
      modifier: undefined,
    })
    expect(semantics(line)).toMatchObject({
      purchaseKey,
      preparation: [],
    })
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey,
      preparation: [],
    })
  })

  it.each([
    ['garlic, divided, chopped', 'garlic, divided, chopped',
      'garlic divided chopped'],
    ['garlic, chopped, for serving', 'garlic, chopped, for serving',
      'garlic chopped for serving'],
    ['garlic, chopped, minced, divided', 'garlic, chopped, minced, divided',
      'garlic chopped minced divided'],
    ['garlic, finely chopped, divided', 'garlic, finely chopped, divided',
      'garlic finely chopped divided'],
    ['garlic, minced, to taste', 'garlic, minced, to taste',
      'garlic minced to taste'],
    ['garlic, chopped,, minced', 'garlic, chopped,, minced',
      'garlic chopped minced'],
    ['garlic， chopped， minced', 'garlic, chopped, minced',
      'garlic chopped minced'],
    ['garlic, chopped， minced', 'garlic, chopped, minced',
      'garlic chopped minced'],
  ])('keeps qualifier and delimiter compound %s atomic', (
    line,
    parserItem,
    purchaseKey
  ) => {
    const parsed = parseIngredientLine(line)
    expect(parsed.item).toBe(parserItem)
    expect(parsed.modifier).toBeUndefined()

    const resolved = resolveShoppingIngredient({
      ingredient: parsed,
      recipeId: 'recipe-atomic-suffix',
    })
    expect(resolved.purchaseKey).toBe(purchaseKey)
    expect(resolved.preparation).toEqual([])

    expect(semantics(line)).toMatchObject({
      purchaseKey,
      preparation: [],
    })
  })

  it.each([
    ['divided', ['divided']],
    ['to taste', ['to taste']],
    ['plus more', ['plus more']],
    ['for garnish', ['for garnish']],
    ['for serving', ['for serving']],
    ['for topping', ['for topping']],
    ['optional', []],
  ])('uses the central qualifier registry for garlic, %s', (
    modifier,
    preparation
  ) => {
    const line = `garlic, ${modifier}`
    expect(parseIngredientLine(line)).toMatchObject({
      item: 'garlic',
      modifier,
    })
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey: 'garlic',
      preparation,
    })
  })

  it('prevents parser and resolver from sharing an unsupported comma suffix', () => {
    const parsed = parseIngredientLine('garlic, chopped, for serving')
    expect(parsed).toMatchObject({
      item: 'garlic, chopped, for serving',
      modifier: undefined,
    })

    const resolved = resolveShoppingIngredient({
      ingredient: parsed,
      recipeId: 'recipe-cross-layer-atomicity',
    })
    expect(resolved).toMatchObject({
      purchaseKey: 'garlic chopped for serving',
      preparation: [],
    })
  })

  it('retains composite citrus preparation without adding it to identity', () => {
    expect(semantics('lime', 'count', 'juice and zest')).toMatchObject({
      purchaseKey: 'lime',
      preparation: ['juiced', 'zested'],
    })
  })

  it.each([
    ['1 lime, juiced and zested', 'lime'],
    ['1 lemon, juiced and zested', 'lemon'],
    ['1 lime, zested and juiced', 'lime'],
  ])('retains both structured citrus preparations for %s', (line, fruit) => {
    const parsed = parseIngredientLine(line)
    expect(parsed).toMatchObject({
      item: fruit,
      amount: 1,
      unit: 'count',
      modifier: expect.stringMatching(/^(?:juiced and zested|zested and juiced)$/),
    })
    expect(semantics(`${fruit}, ${parsed.modifier}`, 'count')).toMatchObject({
      purchaseKey: fruit,
      preparation: ['juiced', 'zested'],
    })
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey: fruit,
      quantity: { amount: 1, unit: 'count' },
      preparation: ['juiced', 'zested'],
      citrusPrep: undefined,
    })
  })

  it.each(['lime', 'lemon'])(
    'parses whole-fruit juice-and-zest grammar for %s',
    (fruit) => {
      const line = `juice and zest of 1 ${fruit}`
      expect(parseIngredientLine(line)).toMatchObject({ item: line })
      expect(resolvedLine(line)).toMatchObject({
        purchaseKey: fruit,
        quantity: { amount: 1, unit: 'count' },
        preparation: ['juiced', 'zested'],
      })
    }
  )

  it.each([
    ['2 tbsp lime juice', 'lime juice', 2, 'tbsp'],
    ['1 bottle lime juice', 'lime juice', 1, 'bottle'],
    ['1 tbsp lemon zest', 'lemon zest', 1, 'tbsp'],
    ['1 cup orange juice', 'orange juice', 1, 'cup'],
  ])('keeps citrus product/component form %s unchanged', (
    line,
    purchaseKey,
    amount,
    unit
  ) => {
    expect(resolvedLine(line)).toMatchObject({
      purchaseKey,
      quantity: { amount, unit },
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
    ['medium onion', '', 'onion'],
    ['large onion', '', 'onion'],
    ['small white onion', '', 'onion'],
    ['medium white onion', '', 'onion'],
    ['medium yellow onion', '', 'onion'],
    ['large yellow onions', '', 'onion'],
    ['diced small yellow onion', '', 'onion'],
    ['yellow onion', 'small', 'onion'],
    ['small red onion', '', 'red onion'],
    ['large red onion', '', 'red onion'],
    ['small green onion', '', 'green onion'],
    ['medium pearl onion', '', 'pearl onion'],
    ['large pickled red onion', '', 'pickled red onion'],
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

  it('keeps malformed preparation alternatives literal', () => {
    expect(semantics(
      'garlic',
      '',
      'finely minced (or red pepper flakes)'
    ).purchaseKey).toBe('finely minced (or red pepper flakes) garlic')
  })

  it('keeps compound salt and pepper requirements outside both exclusion families', () => {
    expect(semantics('salt and pepper')).toMatchObject({
      purchaseKey: 'salt and pepper',
      familyKey: 'salt and pepper',
    })
  })
})

describe('Shopping projection semantic behavior', () => {
  it.each([
    [['juice and zest of 1 lime'], 1],
    [['juice and zest of 1 lime', 'zest of 1 lime'], 2],
    [['juice and zest of 1 lime', 'juice of 1 lime'], 2],
    [['juice of 1 lime', 'zest of 1 lime'], 2],
    [['juice and zest of 2 limes'], 2],
    [['1 lime, juiced and zested', 'zest of 1 lime'], 2],
  ])('projects conservative whole-citrus demand for %j', (lines, amount) => {
    const row = projectShoppingDocument(documentWithLines(lines)).items[0]
    expect(row).toMatchObject({
      orderingKey: 'lime',
      quantity: { amount, unit: 'count' },
    })
  })

  it('keeps measured citrus components separate from whole fruit', () => {
    const rows = projectShoppingDocument(documentWithLines([
      'juice and zest of 1 lime',
      '2 tbsp lime juice',
    ])).items
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.orderingKey === 'lime')?.quantity)
      .toMatchObject({ amount: 1, unit: 'count' })
    expect(rows.find((row) => row.orderingKey === 'lime juice')?.quantity)
      .toMatchObject({ amount: 2, unit: 'tbsp' })
  })

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

  it('aggregates production garlic and cilantro preparation variants by identity', () => {
    const rows = projectShoppingDocument(documentWithLines([
      '8 cloves garlic',
      '3 cloves garlic, finely chopped',
      '1 tbsp cilantro',
      '1 tbsp cilantro, finely chopped',
    ])).items

    expect(rows).toHaveLength(2)
    expect(rows.find((item) => item.orderingKey === 'garlic')).toMatchObject({
      displayName: 'garlic',
      quantity: { amount: 11, unit: 'clove' },
    })
    expect(rows.find((item) => item.orderingKey === 'cilantro')).toMatchObject({
      displayName: 'cilantro',
      quantity: { amount: 2, unit: 'tbsp' },
    })
  })

  it('keeps alternative evidence but uses a hard requirement for merged display', () => {
    const document = createEmptyShoppingDocument()
    const alternative = persistedIngredient({
      item: 'cilantro',
      amount: 1,
      unit: 'tbsp',
      alternatives: ['parsley'],
    }, 'recipe-a')
    const required = persistedIngredient({
      item: 'cilantro',
      amount: 1,
      unit: 'tbsp',
      modifier: 'finely chopped',
    }, 'recipe-z')
    document.recipeEntries['recipe-a'] = {
      recipeId: 'recipe-a',
      recipeName: 'Alternative cilantro',
      selectedServings: 1,
      scaleV1: { numerator: '1', denominator: '1' },
      ingredients: [alternative],
    }
    document.recipeEntries['recipe-z'] = {
      recipeId: 'recipe-z',
      recipeName: 'Required cilantro',
      selectedServings: 1,
      scaleV1: { numerator: '1', denominator: '1' },
      ingredients: [required],
    }

    expect(alternative).toMatchObject({
      purchaseKey: 'cilantro',
      displayName: 'cilantro (or parsley)',
      pantryMatchKeys: ['cilantro', 'parsley'],
    })
    expect(projectShoppingDocument(document).items).toEqual([
      expect.objectContaining({
        orderingKey: 'cilantro',
        displayName: 'cilantro',
        quantity: expect.objectContaining({ amount: 2, unit: 'tbsp' }),
      }),
    ])
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

describe('ShoppingDocumentV3 frozen semantic validation', () => {
  function frozenDocument(purchaseKey: string): ShoppingDocumentV3 {
    const document = createEmptyShoppingDocument()
    const aggregateKey = JSON.stringify([
      'shopping-aggregate',
      2,
      purchaseKey,
    ])
    const ingredient = historicalV3Line(purchaseKey)
    document.recipeEntries['recipe-frozen'] = {
      recipeId: 'recipe-frozen',
      recipeName: `Frozen ${purchaseKey}`,
      selectedServings: 1,
      scaleV1: { numerator: '1', denominator: '1' },
      ingredients: [{
        ...ingredient,
        aggregateKey,
        displayName: purchaseKey,
        familyKey: purchaseKey,
        preparation: [],
        pantryMatchKeys: [purchaseKey],
      }],
    }
    return document
  }

  it.each([
    'finely chopped cilantro',
    'chopped garlic',
  ])('preserves frozen recipe identity %s across read and projection', (
    purchaseKey
  ) => {
    const document = frozenDocument(purchaseKey)
    const original = JSON.parse(JSON.stringify(document))
    const aggregateKey = document.recipeEntries['recipe-frozen'].ingredients[0]
      .aggregateKey

    expect(validateShoppingDocumentV3(document).ok).toBe(true)
    const validated = validateShoppingDocumentStateV3({
      document,
      contentRevision: 4,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const ingredient = validated.document.recipeEntries['recipe-frozen']
      .ingredients[0]
    expect(ingredient).toMatchObject({
      purchaseKey,
      aggregateKey,
      displayName: purchaseKey,
      preparation: [],
      pantryMatchKeys: [purchaseKey],
    })
    expect(validated.document).toEqual(original)
    expect(projectShoppingDocument(validated.document).items[0]).toMatchObject({
      orderingKey: purchaseKey,
      aggregateKey,
      displayName: purchaseKey,
      sources: [expect.objectContaining({
        preparationModifiers: undefined,
      })],
    })
  })

  it('does not rewrite a frozen contribution during an unrelated mutation', () => {
    const document = frozenDocument('finely chopped cilantro')
    const frozenEntry = JSON.parse(JSON.stringify(
      document.recipeEntries['recipe-frozen']
    ))
    const aggregateKey = frozenEntry.ingredients[0].aggregateKey
    const validated = validateShoppingDocumentStateV3({
      document,
      contentRevision: 8,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const next = applyShoppingDocumentMutation({
      document: validated.document,
      contentRevision: validated.contentRevision!,
    }, {
      type: 'setChecked',
      rowRef: `derived:${aggregateKey}`,
      checked: true,
    })

    expect(next.document.recipeEntries['recipe-frozen']).toEqual(frozenEntry)
    expect(next.document.itemOverrides).toEqual({
      [aggregateKey]: { checked: true },
    })

    const reloaded = validateShoppingDocumentStateV3({
      document: JSON.parse(JSON.stringify(next.document)),
      contentRevision: next.contentRevision,
    })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.document.recipeEntries['recipe-frozen']).toEqual(frozenEntry)
    expect(projectShoppingDocument(reloaded.document).items[0]).toMatchObject({
      orderingKey: 'finely chopped cilantro',
      checked: true,
    })
  })

  it('freezes a corrected qualifier compound through mutation and reload', () => {
    const document = createEmptyShoppingDocument()
    const ingredient = persistedLine('1 garlic, chopped, for serving')
    const frozenIngredient = JSON.parse(JSON.stringify(ingredient))
    document.recipeEntries['recipe-frozen'] = {
      recipeId: 'recipe-frozen',
      recipeName: 'Frozen qualifier-compound garlic',
      selectedServings: 1,
      scaleV1: { numerator: '1', denominator: '1' },
      ingredients: [ingredient],
    }

    const validated = validateShoppingDocumentStateV3({
      document: JSON.parse(JSON.stringify(document)),
      contentRevision: 5,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    expect(validated.document.recipeEntries['recipe-frozen'].ingredients[0])
      .toEqual(frozenIngredient)
    expect(projectShoppingDocument(validated.document).items[0]).toMatchObject({
      orderingKey: 'garlic chopped for serving',
      quantity: { amount: 1, unit: 'count' },
      sources: [expect.objectContaining({
        preparationModifiers: undefined,
      })],
    })

    const next = applyShoppingDocumentMutation({
      document: validated.document,
      contentRevision: validated.contentRevision!,
    }, {
      type: 'setChecked',
      rowRef: `derived:${ingredient.aggregateKey}`,
      checked: true,
    })
    expect(next.document.recipeEntries['recipe-frozen'].ingredients[0])
      .toEqual(frozenIngredient)

    const serialized = JSON.stringify(next.document)
    const reloaded = validateShoppingDocumentStateV3({
      document: JSON.parse(serialized),
      contentRevision: next.contentRevision,
    })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(reloaded.document.recipeEntries['recipe-frozen'].ingredients[0])
      .toEqual(frozenIngredient)
    expect(projectShoppingDocument(reloaded.document).items[0]).toMatchObject({
      orderingKey: 'garlic chopped for serving',
      checked: true,
      quantity: { amount: 1, unit: 'count' },
      sources: [expect.objectContaining({
        preparationModifiers: undefined,
      })],
    })
  })

  it('honors frozen continuous count semantics through mutation and reload', () => {
    const document = frozenDocument('historical citrus')
    const ingredient = document.recipeEntries['recipe-frozen'].ingredients[0]
    ingredient.quantity = { amount: 1.25, unit: 'count' }
    ingredient.purchaseUnit = 'count'
    ingredient.quantityKind = 'continuous'
    const frozenEntry = JSON.parse(JSON.stringify(
      document.recipeEntries['recipe-frozen']
    ))

    const validated = validateShoppingDocumentStateV3({
      document: JSON.parse(JSON.stringify(document)),
      contentRevision: 12,
    })
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(projectShoppingDocument(validated.document).items[0].quantity)
      .toMatchObject({ amount: 1.25, unit: 'count' })

    const next = applyShoppingDocumentMutation({
      document: validated.document,
      contentRevision: validated.contentRevision!,
    }, {
      type: 'setChecked',
      rowRef: `derived:${ingredient.aggregateKey}`,
      checked: true,
    })
    expect(next.document.recipeEntries['recipe-frozen']).toEqual(frozenEntry)

    const reloaded = validateShoppingDocumentStateV3({
      document: JSON.parse(JSON.stringify(next.document)),
      contentRevision: next.contentRevision,
    })
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return
    expect(projectShoppingDocument(reloaded.document).items[0]).toMatchObject({
      checked: true,
      quantity: { amount: 1.25, unit: 'count' },
    })
  })

  it('honors a frozen discrete kind when the current unit is continuous', () => {
    const document = frozenDocument('historical measured item')
    const ingredient = document.recipeEntries['recipe-frozen'].ingredients[0]
    ingredient.quantity = { amount: 1.25, unit: 'cup' }
    ingredient.purchaseUnit = 'cup'
    ingredient.quantityKind = 'discrete'

    expect(validateShoppingDocumentV3(document).ok).toBe(true)
    expect(projectShoppingDocument(document).items[0].quantity)
      .toMatchObject({ amount: 2, unit: 'cup' })
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
