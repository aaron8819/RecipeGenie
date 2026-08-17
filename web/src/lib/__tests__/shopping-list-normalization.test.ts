import { describe, it, expect } from 'vitest'
import {
  normalizeUnit,
  normalizeItemName,
  normalizeShoppingPurchase,
  createShoppingPurchaseKey,
  createItemKey,
} from '../shopping-list-normalization'

/**
 * Unit tests for shopping-list-normalization.ts
 */

describe('normalizeUnit', () => {
  describe('volume units', () => {
    it('should normalize teaspoon variations to tsp', () => {
      expect(normalizeUnit('teaspoon')).toBe('tsp')
      expect(normalizeUnit('teaspoons')).toBe('tsp')
      expect(normalizeUnit('TEASPOON')).toBe('tsp')
      expect(normalizeUnit('Teaspoons')).toBe('tsp')
      expect(normalizeUnit('tsp')).toBe('tsp')
      expect(normalizeUnit('TSP')).toBe('tsp')
    })

    it('should normalize tablespoon variations to tbsp', () => {
      expect(normalizeUnit('tablespoon')).toBe('tbsp')
      expect(normalizeUnit('tablespoons')).toBe('tbsp')
      expect(normalizeUnit('TABLESPOON')).toBe('tbsp')
      expect(normalizeUnit('Tablespoons')).toBe('tbsp')
      expect(normalizeUnit('tbsp')).toBe('tbsp')
      expect(normalizeUnit('TBSP')).toBe('tbsp')
    })

    it('should normalize cup variations to cup', () => {
      expect(normalizeUnit('cup')).toBe('cup')
      expect(normalizeUnit('cups')).toBe('cup')
      expect(normalizeUnit('CUP')).toBe('cup')
      expect(normalizeUnit('Cups')).toBe('cup')
    })

    it('should normalize fluid ounce variations', () => {
      expect(normalizeUnit('fluid ounce')).toBe('fl oz')
      expect(normalizeUnit('fluid ounces')).toBe('fl oz')
      expect(normalizeUnit('FLUID OUNCE')).toBe('fl oz')
    })

    it('should normalize liter variations', () => {
      expect(normalizeUnit('liter')).toBe('l')
      expect(normalizeUnit('liters')).toBe('l')
      expect(normalizeUnit('l')).toBe('l')
      expect(normalizeUnit('L')).toBe('l')
    })

    it('should normalize milliliter variations', () => {
      expect(normalizeUnit('milliliter')).toBe('ml')
      expect(normalizeUnit('milliliters')).toBe('ml')
      expect(normalizeUnit('ml')).toBe('ml')
      expect(normalizeUnit('ML')).toBe('ml')
    })

    it('should normalize pint/quart/gallon', () => {
      expect(normalizeUnit('pint')).toBe('pint')
      expect(normalizeUnit('pints')).toBe('pint')
      expect(normalizeUnit('quart')).toBe('quart')
      expect(normalizeUnit('quarts')).toBe('quart')
      expect(normalizeUnit('gallon')).toBe('gallon')
      expect(normalizeUnit('gallons')).toBe('gallon')
    })
  })

  describe('weight units', () => {
    it('should normalize gram variations', () => {
      expect(normalizeUnit('gram')).toBe('g')
      expect(normalizeUnit('grams')).toBe('g')
      expect(normalizeUnit('g')).toBe('g')
      expect(normalizeUnit('G')).toBe('g')
    })

    it('should normalize kilogram variations', () => {
      expect(normalizeUnit('kilogram')).toBe('kg')
      expect(normalizeUnit('kilograms')).toBe('kg')
      expect(normalizeUnit('kg')).toBe('kg')
      expect(normalizeUnit('KG')).toBe('kg')
    })

    it('should normalize ounce variations', () => {
      expect(normalizeUnit('ounce')).toBe('oz')
      expect(normalizeUnit('ounces')).toBe('oz')
      expect(normalizeUnit('oz')).toBe('oz')
      expect(normalizeUnit('OZ')).toBe('oz')
    })

    it('should normalize pound variations', () => {
      expect(normalizeUnit('pound')).toBe('lb')
      expect(normalizeUnit('pounds')).toBe('lb')
      expect(normalizeUnit('lb')).toBe('lb')
      expect(normalizeUnit('LB')).toBe('lb')
    })
  })

  describe('count units', () => {
    it('should normalize piece/count units to canonical singular forms', () => {
      expect(normalizeUnit('piece')).toBe('piece')
      expect(normalizeUnit('pieces')).toBe('piece')
      expect(normalizeUnit('pc')).toBe('piece')
      expect(normalizeUnit('pcs')).toBe('piece')
      expect(normalizeUnit('whole')).toBe('count')
      expect(normalizeUnit('whole/count')).toBe('count')
      expect(normalizeUnit('whole item')).toBe('count')
      expect(normalizeUnit('count')).toBe('count')
    })

    it('should normalize container units to canonical singular forms', () => {
      expect(normalizeUnit('can')).toBe('can')
      expect(normalizeUnit('cans')).toBe('can')
      expect(normalizeUnit('jar')).toBe('jar')
      expect(normalizeUnit('jars')).toBe('jar')
      expect(normalizeUnit('bottle')).toBe('bottle')
      expect(normalizeUnit('bottles')).toBe('bottle')
      expect(normalizeUnit('box')).toBe('box')
      expect(normalizeUnit('boxes')).toBe('box')
      expect(normalizeUnit('bag')).toBe('bag')
      expect(normalizeUnit('bags')).toBe('bag')
      expect(normalizeUnit('package')).toBe('package')
      expect(normalizeUnit('packages')).toBe('package')
      expect(normalizeUnit('pkg')).toBe('package')
      expect(normalizeUnit('pkgs')).toBe('package')
    })

    it('should normalize produce count units to canonical singular forms', () => {
      expect(normalizeUnit('clove')).toBe('clove')
      expect(normalizeUnit('cloves')).toBe('clove')
      expect(normalizeUnit('slice')).toBe('slice')
      expect(normalizeUnit('slices')).toBe('slice')
      expect(normalizeUnit('bunch')).toBe('bunch')
      expect(normalizeUnit('bunches')).toBe('bunch')
      expect(normalizeUnit('head')).toBe('head')
      expect(normalizeUnit('heads')).toBe('head')
      expect(normalizeUnit('stalk')).toBe('stalk')
      expect(normalizeUnit('stalks')).toBe('stalk')
      expect(normalizeUnit('sprig')).toBe('sprig')
      expect(normalizeUnit('sprigs')).toBe('sprig')
    })

    it('should normalize sized package units without dropping the package type', () => {
      expect(normalizeUnit('can (28 ounces)')).toBe('can (28 oz)')
      expect(normalizeUnit('Jars (16 oz)')).toBe('jar (16 oz)')
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(normalizeUnit('')).toBe('')
    })

    it('should handle whitespace', () => {
      expect(normalizeUnit('  cup  ')).toBe('cup')
      expect(normalizeUnit('\ttsp\n')).toBe('tsp')
    })

    it('should return unknown units as lowercase trimmed', () => {
      expect(normalizeUnit('pinch')).toBe('pinch')
      expect(normalizeUnit('DASH')).toBe('dash')
      expect(normalizeUnit('  Handful  ')).toBe('handful')
    })

    it('should handle mixed case', () => {
      expect(normalizeUnit('CuPs')).toBe('cup')
      expect(normalizeUnit('TaBLeSpOoNs')).toBe('tbsp')
    })
  })
})

describe('normalizeItemName', () => {
  it('should convert to lowercase', () => {
    expect(normalizeItemName('Chicken Breast')).toBe('chicken breast')
    expect(normalizeItemName('GARLIC')).toBe('garlic')
    expect(normalizeItemName('Olive Oil')).toBe('olive oil')
  })

  it('should trim whitespace', () => {
    expect(normalizeItemName('  chicken  ')).toBe('chicken')
    expect(normalizeItemName('\tgarlic\n')).toBe('garlic')
  })

  it('should preserve internal spaces', () => {
    expect(normalizeItemName('Chicken Breast')).toBe('chicken breast')
    expect(normalizeItemName('Black Pepper')).toBe('black pepper')
    expect(normalizeItemName('Extra Virgin Olive Oil')).toBe('olive oil')
  })

  it('should handle empty string', () => {
    expect(normalizeItemName('')).toBe('')
    expect(normalizeItemName('   ')).toBe('')
  })

  it('should preserve special characters', () => {
    expect(normalizeItemName("Frank's Hot Sauce")).toBe("frank's hot sauce")
    expect(normalizeItemName('Jalapeño Pepper')).toBe('jalapeño pepper')
    expect(normalizeItemName('100% Whole Wheat')).toBe('100% whole wheat')
  })

  it('should handle numbers', () => {
    expect(normalizeItemName('7-Up')).toBe('7-up')
    expect(normalizeItemName('14oz Can')).toBe('14oz can')
  })

  it('should preserve legacy aliases for non-shopping normalization consumers', () => {
    expect(normalizeItemName('Yellow Onion')).toBe('onion')
    expect(normalizeItemName('white onions')).toBe('onion')
    expect(normalizeItemName('garlic cloves')).toBe('garlic')
    expect(normalizeItemName('EVOO')).toBe('olive oil')
  })
})

describe('createItemKey', () => {
  it('should create key from normalized item and unit', () => {
    expect(createItemKey('Chicken Breast', 'pounds')).toBe('chicken breast|lb')
    expect(createItemKey('GARLIC', 'cloves')).toBe('garlic|clove')
    expect(createItemKey('Milk', 'CUPS')).toBe('milk|cup')
  })

  it('should create same key for equivalent inputs', () => {
    const key1 = createItemKey('Chicken Breast', 'lb')
    const key2 = createItemKey('chicken breast', 'LB')
    const key3 = createItemKey('  CHICKEN BREAST  ', 'pound')

    expect(key1).toBe(key2)
    expect(key2).toBe(key3)
  })

  it('should create different keys for different items', () => {
    const key1 = createItemKey('Chicken', 'lb')
    const key2 = createItemKey('Turkey', 'lb')

    expect(key1).not.toBe(key2)
  })

  it('should create different keys for different units (if not in same family)', () => {
    const key1 = createItemKey('Cheese', 'cup')
    const key2 = createItemKey('Cheese', 'oz')

    // cup (volume) vs oz (weight) should create different keys
    expect(key1).not.toBe(key2)
  })

  it('should handle empty inputs', () => {
    expect(createItemKey('', '')).toBe('|')
    expect(createItemKey('Salt', '')).toBe('salt|')
    expect(createItemKey('', 'cup')).toBe('|cup')
  })
})

describe('normalizeShoppingPurchase', () => {
  it('maps explicit citrus juice wording to whole fruit purchases', () => {
    expect(normalizeShoppingPurchase({ item: 'juice of 2 limes', amount: null, unit: '' })).toMatchObject({
      purchaseName: 'lime',
      purchaseUnit: 'count',
      purchaseQuantity: 2,
      prepIntent: 'juiced',
      confidence: 'high',
    })
  })

  it('maps whole produce prep forms to the purchase item while preserving original form', () => {
    expect(normalizeShoppingPurchase({ item: '1 lime, juiced', amount: null, unit: '' })).toMatchObject({
      purchaseName: 'lime',
      purchaseUnit: 'count',
      purchaseQuantity: 1,
      originalName: '1 lime, juiced',
      prepIntent: 'juiced',
    })

    expect(normalizeShoppingPurchase({ item: 'diced onion', amount: null, unit: '' })).toMatchObject({
      purchaseName: 'onion',
      purchaseUnit: 'count',
      purchaseQuantity: 1,
      originalName: 'diced onion',
      prepIntent: 'diced',
    })
  })

  it('maps measured citrus juice to an estimated whole fruit purchase', () => {
    expect(normalizeShoppingPurchase({ item: 'lemon juice', amount: 4, unit: 'tbsp' })).toMatchObject({
      purchaseName: 'lemon',
      purchaseUnit: 'count',
      purchaseQuantity: 4 / 3,
      prepIntent: 'juiced',
      confidence: 'medium',
    })
  })

  it('maps explicit and measured citrus zest to whole fruit purchases', () => {
    expect(normalizeShoppingPurchase({ item: 'zest of 0.5 lemon', amount: null, unit: '' })).toMatchObject({
      purchaseName: 'lemon',
      purchaseUnit: 'count',
      purchaseQuantity: 0.5,
      prepIntent: 'zested',
    })

    expect(normalizeShoppingPurchase({ item: 'lime zest', amount: 2, unit: 'tsp' })).toMatchObject({
      purchaseName: 'lime',
      purchaseUnit: 'count',
      purchaseQuantity: 1,
      prepIntent: 'zested',
      confidence: 'medium',
    })
  })

  it('retains composite citrus preparation for safely identified whole fruit', () => {
    expect(normalizeShoppingPurchase({
      item: 'lime',
      amount: 1,
      unit: 'count',
      modifier: 'juice and zest',
    })).toMatchObject({
      purchaseName: 'lime',
      purchaseUnit: 'count',
      prepIntent: 'juiced, zested',
      semantics: {
        purchaseKey: 'lime',
        preparation: ['juiced', 'zested'],
      },
    })
  })

  it('does not over-normalize malformed citrus component data', () => {
    expect(normalizeShoppingPurchase({
      item: 'lime juice',
      amount: 1,
      unit: 'count',
      modifier: 'juice and zest',
    })).toMatchObject({
      purchaseName: 'lime juice',
      purchaseUnit: 'count',
      purchaseQuantity: 1,
      semantics: {
        purchaseKey: 'lime juice',
        preparation: ['juiced', 'zested'],
      },
    })
  })

  it('keeps measured produce forms in their measured units', () => {
    expect(normalizeShoppingPurchase({ item: 'onion', amount: 1, unit: 'cup' })).toMatchObject({
      purchaseName: 'onion',
      purchaseUnit: 'cup',
      purchaseQuantity: 1,
    })
  })

  it('does not default generic item-only ingredients to one', () => {
    expect(normalizeShoppingPurchase({ item: 'cilantro', amount: null, unit: '' })).toMatchObject({
      purchaseName: 'cilantro',
      purchaseUnit: '',
      purchaseQuantity: null,
    })
  })

  it('does not collapse unsafe produce names into broader items', () => {
    expect(createShoppingPurchaseKey('green onion')).toBe('green onion')
    expect(createShoppingPurchaseKey('red onion')).toBe('red onion')
    expect(createShoppingPurchaseKey('tomato paste')).toBe('tomato paste')
  })

  it.each([
    ['2 onions', 1, 'piece'],
    ['2 onions', 2, 'pieces'],
    ['2 onions', 2, 'pc'],
    ['  2 ONIONS  ', 2, 'pcs'],
  ] as const)('preserves piece-family purchase identity for %s / %s %s', (
    item,
    amount,
    unit
  ) => {
    expect(createShoppingPurchaseKey(item, amount, unit)).toBe('2 onion')
  })
})
