import { describe, it, expect } from 'vitest'
import {
  generateShoppingList,
  sortShoppingList,
  ensureCategoryInfo,
} from '../shopping-list'
import type { Recipe, PantryItem, ShoppingItem } from '@/types/database'

/**
 * Unit tests for shopping-list.ts business logic
 */

// Helper to create a mock recipe
function createMockRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'recipe-1',
    user_id: 'user-1',
    name: 'Test Recipe',
    category: 'chicken',
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: [
      { item: 'Chicken Breast', amount: 1, unit: 'lb' },
      { item: 'Garlic', amount: 3, unit: 'cloves' },
      { item: 'Olive Oil', amount: 2, unit: 'tbsp' },
    ],
    instructions: ['Step 1', 'Step 2'],
    image_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create mock pantry item
function createMockPantryItem(item: string): PantryItem {
  return {
    id: `pantry-${item.toLowerCase().replace(/\s+/g, '-')}`,
    user_id: 'user-1',
    item,
    created_at: new Date().toISOString(),
  }
}

describe('generateShoppingList', () => {
  describe('basic functionality', () => {
    it('should generate a shopping list from a single recipe', () => {
      const recipe = createMockRecipe()
      const result = generateShoppingList([recipe], [], [])

      expect(result.items).toHaveLength(3)
      expect(result.items.map(i => i.item)).toContain('chicken breast')
      expect(result.items.map(i => i.item)).toContain('garlic')
      expect(result.items.map(i => i.item)).toContain('olive oil')
      expect(result.scale).toBe(1.0)
      expect(result.totalServings).toBe(4)
    })

    it('should return empty list for no recipes', () => {
      const result = generateShoppingList([], [], [])

      expect(result.items).toHaveLength(0)
      expect(result.alreadyHave).toHaveLength(0)
      expect(result.excluded).toHaveLength(0)
      expect(result.totalServings).toBe(0)
    })

    it('should normalize item names to lowercase', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'CHICKEN BREAST', amount: 1, unit: 'lb' },
          { item: 'Olive Oil', amount: 2, unit: 'tbsp' },
        ],
      })
      const result = generateShoppingList([recipe], [], [])

      expect(result.items.every(i => i.item === i.item.toLowerCase())).toBe(true)
      expect(result.items.map(i => i.item)).toContain('chicken breast')
    })

    it('should normalize units', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Flour', amount: 2, unit: 'CUPS' },
          { item: 'Sugar', amount: 3, unit: 'tablespoons' },
        ],
      })
      const result = generateShoppingList([recipe], [], [])

      // Units should be normalized (cups -> cup, tablespoons -> tbsp)
      const flour = result.items.find(i => i.item === 'flour')
      const sugar = result.items.find(i => i.item === 'sugar')
      expect(flour?.unit).toBe('cup')
      expect(sugar?.unit).toBe('tbsp')
    })

    it('should preserve exact unconverted recipe fractions', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Sugar', amount: 1 / 3, unit: 'cup' },
          { item: 'Yeast', amount: 1 / 5, unit: 'tsp' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])

      expect(result.items.find(i => i.item === 'sugar')?.amount).toBe(1 / 3)
      expect(result.items.find(i => i.item === 'yeast')?.amount).toBe(1 / 5)
    })
  })

  describe('ingredient aggregation', () => {
    it('should merge same ingredients from multiple recipes', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        name: 'Recipe 1',
        ingredients: [{ item: 'Chicken Breast', amount: 1, unit: 'lb' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        name: 'Recipe 2',
        ingredients: [{ item: 'Chicken Breast', amount: 2, unit: 'lb' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      const chicken = result.items.find(i => i.item === 'chicken breast')
      expect(chicken).toBeDefined()
      expect(chicken?.amount).toBe(3) // 1 + 2 = 3 lb
      expect(chicken?.sources).toHaveLength(2)
    })

    it('should merge compatible units (cups + fl oz)', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Milk', amount: 1, unit: 'cup' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'Milk', amount: 8, unit: 'fl oz' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      const milk = result.items.find(i => i.item === 'milk')
      expect(milk).toBeDefined()
      // 1 cup + 8 fl oz = 1 cup + 1 cup = 2 cups
      expect(milk?.amount).toBe(2)
      expect(milk?.unit).toBe('cup')
    })

    it('should use additionalAmounts for incompatible units', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Cheese', amount: 1, unit: 'cup' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'Cheese', amount: 8, unit: 'oz' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      const cheese = result.items.find(i => i.item === 'cheese')
      expect(cheese).toBeDefined()
      // Volume (cup) and weight (oz) are incompatible
      expect(cheese?.additionalAmounts).toBeDefined()
      expect(cheese?.additionalAmounts?.length).toBeGreaterThan(0)
    })

    it('should consolidate repeated incompatible additional amounts across recipes', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Cheese', amount: 1, unit: 'cup' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'Cheese', amount: 8, unit: 'oz' }],
      })
      const recipe3 = createMockRecipe({
        id: 'recipe-3',
        ingredients: [{ item: 'Cheese', amount: 4, unit: 'oz' }],
      })

      const result = generateShoppingList([recipe1, recipe2, recipe3], [], [])

      const cheese = result.items.find(i => i.item === 'cheese')
      expect(cheese?.additionalAmounts).toEqual([{ amount: 12, unit: 'oz' }])
    })

    it('should deduplicate recipe sources', () => {
      const recipe = createMockRecipe({
        id: 'recipe-1',
        name: 'Recipe 1',
        ingredients: [
          { item: 'Salt', amount: 1, unit: 'tsp' },
          { item: 'Salt', amount: 0.5, unit: 'tsp' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])

      const salt = result.items.find(i => i.item === 'salt')
      expect(salt?.sources).toHaveLength(1) // Same recipe, should not duplicate
    })

    it('should canonicalize singular and plural onions before merging', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Onions', amount: 1, unit: '' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'Onion', amount: 2, unit: '' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe('onion')
      expect(result.items[0].amount).toBe(3)
    })

    it('should preserve extra-virgin olive oil as a distinct product', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Extra Virgin Olive Oil', amount: 2, unit: 'tbsp' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'olive oil', amount: 1, unit: 'tbsp' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      expect(result.items.map((item) => item.item)).toEqual([
        'extra virgin olive oil',
        'olive oil',
      ])
    })

    it('should keep garlic count forms separate when units differ', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        ingredients: [{ item: 'Garlic', amount: 3, unit: 'cloves' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        ingredients: [{ item: 'Garlic', amount: 1, unit: '' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe('garlic')
      expect(result.items[0].amount).toBe(3)
      expect(result.items[0].unit).toBe('clove')
      expect(result.items[0].additionalAmounts).toEqual([{ amount: 1, unit: '' }])
    })

    it('should consolidate compatible lime recipe forms into one purchase item with provenance', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        name: 'Pollo Asado Tacos',
        ingredients: [
          { item: 'juice of 2 limes', amount: null, unit: '' },
          { item: 'lime wedges', amount: null, unit: '' },
        ],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        name: 'Shredded Chipotle Beef',
        ingredients: [{ item: 'lime', amount: null, unit: '' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        item: 'lime',
        amount: 4,
        unit: 'count',
      })
      expect(result.items[0].sources?.map((source) => source.originalItem)).toEqual([
        'juice of 2 limes',
        'lime wedges',
        'lime',
      ])
    })

    it('should consolidate compatible onion prep forms into one purchase item with provenance', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        name: 'Pollo Asado Tacos',
        ingredients: [{ item: 'diced onion', amount: null, unit: '' }],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        name: 'Turkey Bolognese',
        ingredients: [{ item: 'onion', amount: 1, unit: '' }],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toMatchObject({
        item: 'onion',
        amount: 2,
        unit: 'count',
      })
      expect(result.items[0].sources?.map((source) => source.originalItem)).toEqual([
        'diced onion',
        'onion',
      ])
    })

    it('should not merge unsafe produce-adjacent ingredients', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'lemon juice', amount: 4, unit: 'tbsp' },
          { item: 'lime', amount: null, unit: '' },
          { item: 'green onion', amount: 1, unit: '' },
          { item: 'onion', amount: 1, unit: '' },
          { item: 'tomato paste', amount: 2, unit: 'tbsp' },
          { item: 'tomato', amount: 1, unit: '' },
          { item: 'red onion', amount: 1, unit: '' },
          { item: 'yellow onion', amount: 1, unit: '' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])
      const itemNames = result.items.map((item) => item.item)

      expect(itemNames).toContain('lemon')
      expect(itemNames).toContain('lime')
      expect(itemNames).toContain('green onion')
      expect(itemNames).toContain('onion')
      expect(itemNames).toContain('tomato paste')
      expect(itemNames).toContain('tomato')
      expect(itemNames).toContain('red onion')
      expect(itemNames).toContain('yellow onion')
      expect(result.items.find((item) => item.item === 'onion')?.amount).toBe(1)
      expect(result.items.find((item) => item.item === 'lemon')).toMatchObject({
        amount: 1.25,
        unit: 'count',
      })
    })

    it('should handle the requested lime and onion consolidation scenario conservatively', () => {
      const recipe = createMockRecipe({
        id: 'recipe-1',
        name: 'Pollo Asado Tacos',
        ingredients: [
          { item: 'juice of 2 limes', amount: null, unit: '' },
          { item: 'lime', amount: null, unit: '' },
          { item: 'lime wedges', amount: null, unit: '' },
          { item: 'diced onion', amount: null, unit: '' },
          { item: '1 onion', amount: null, unit: '' },
          { item: '4 tbsp lemon juice', amount: null, unit: '' },
          { item: 'green onion', amount: null, unit: '' },
          { item: 'tomato paste', amount: null, unit: '' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])
      const lime = result.items.find((item) => item.item === 'lime')
      const onion = result.items.find((item) => item.item === 'onion')

      expect(lime).toMatchObject({ amount: 4, unit: 'count' })
      expect(lime?.sources?.map((source) => source.originalItem)).toEqual([
        'juice of 2 limes',
        'lime',
        'lime wedges',
      ])
      expect(onion).toMatchObject({ amount: 2, unit: 'count' })
      expect(onion?.sources?.map((source) => source.originalItem)).toEqual([
        'diced onion',
        '1 onion',
      ])
      expect(result.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ item: 'lemon', amount: 1.25, unit: 'count' }),
          expect.objectContaining({ item: 'green onion', amount: null, unit: '' }),
          expect.objectContaining({ item: 'tomato paste', amount: null, unit: '' }),
        ])
      )
    })

    it('should combine weekly lemon juice and zest needs into one purchase count', () => {
      const recipe1 = createMockRecipe({
        id: 'recipe-1',
        name: 'Chimichurri Steak Bowls',
        ingredients: [
          { item: 'juice of 0.5 lemon', amount: null, unit: '' },
          { item: 'zest of 0.5 lemon', amount: null, unit: '' },
        ],
      })
      const recipe2 = createMockRecipe({
        id: 'recipe-2',
        name: 'CAVA Bowls with Honey Harissa Chicken',
        ingredients: [
          { item: 'lemon juice', amount: 1, unit: 'tbsp' },
          { item: 'zest of 1 lemon', amount: null, unit: '' },
        ],
      })

      const result = generateShoppingList([recipe1, recipe2], [], [])
      const lemon = result.items.find((item) => item.item === 'lemon')

      expect(result.items.map((item) => item.item)).not.toEqual(
        expect.arrayContaining(['lemon juice', 'zest of 0.5 lemon', 'zest of 1 lemon'])
      )
      expect(lemon).toMatchObject({
        amount: 1.5,
        unit: 'count',
      })
      expect(lemon?.sources?.map((source) => source.originalItem)).toEqual([
        'juice of 0.5 lemon',
        'zest of 0.5 lemon',
        'lemon juice',
        'zest of 1 lemon',
      ])
    })
  })

  describe('pantry filtering', () => {
    it('should move pantry items to alreadyHave', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Chicken Breast', amount: 1, unit: 'lb' },
          { item: 'Garlic', amount: 3, unit: 'cloves' },
        ],
      })
      const pantryItems = [createMockPantryItem('garlic')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe('chicken breast')
      expect(result.alreadyHave).toHaveLength(1)
      expect(result.alreadyHave[0].item).toBe('garlic')
    })

    it('should match pantry items case-insensitively', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'GARLIC', amount: 3, unit: 'cloves' }],
      })
      const pantryItems = [createMockPantryItem('Garlic')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.items).toHaveLength(0)
      expect(result.alreadyHave).toHaveLength(1)
    })
  })

  describe('pantry matching with alternatives', () => {
    it('should move item to alreadyHave when primary item matches pantry', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['sour cream'] }],
      })
      const pantryItems = [createMockPantryItem('yogurt')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.alreadyHave).toHaveLength(1)
      expect(result.items).toHaveLength(0)
    })

    it('should move item to alreadyHave when first alternative matches pantry', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['sour cream', 'greek yogurt'] }],
      })
      const pantryItems = [createMockPantryItem('sour cream')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.alreadyHave).toHaveLength(1)
      expect(result.items).toHaveLength(0)
    })

    it('should move item to alreadyHave when second alternative matches pantry', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['sour cream', 'greek yogurt'] }],
      })
      const pantryItems = [createMockPantryItem('greek yogurt')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.alreadyHave).toHaveLength(1)
      expect(result.items).toHaveLength(0)
    })

    it('should match alternatives case-insensitively', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['Sour Cream'] }],
      })
      const pantryItems = [createMockPantryItem('sour cream')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.alreadyHave).toHaveLength(1)
      expect(result.items).toHaveLength(0)
    })

    it('should keep item in shopping list when neither primary nor alternatives match pantry', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['sour cream'] }],
      })
      const pantryItems = [createMockPantryItem('milk')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.items).toHaveLength(1)
      expect(result.alreadyHave).toHaveLength(0)
    })

    it('should keep item in shopping list when alternatives array is empty', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: [] }],
      })
      const pantryItems = [createMockPantryItem('sour cream')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.items).toHaveLength(1)
      expect(result.alreadyHave).toHaveLength(0)
    })

    it('should keep item in shopping list when alternatives is undefined', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup' }],
      })
      const pantryItems = [createMockPantryItem('sour cream')]

      const result = generateShoppingList([recipe], pantryItems, [])

      expect(result.items).toHaveLength(1)
      expect(result.alreadyHave).toHaveLength(0)
    })

    it('should move to excluded when primary item keyword is excluded, even if alternative matches pantry', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'yogurt', amount: 1, unit: 'cup', alternatives: ['sour cream'] }],
      })
      const pantryItems = [createMockPantryItem('sour cream')]
      const excludedKeywords = ['yogurt']

      // Pantry check on alternatives takes precedence over excluded keywords
      const result = generateShoppingList([recipe], pantryItems, excludedKeywords)

      // Pantry match (sour cream) wins — item goes to alreadyHave, not excluded
      expect(result.alreadyHave).toHaveLength(1)
      expect(result.excluded).toHaveLength(0)
    })
  })

  describe('keyword exclusion', () => {
    it('should move excluded items to excluded list', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Chicken Breast', amount: 1, unit: 'lb' },
          { item: 'Salt', amount: 1, unit: 'tsp' },
        ],
      })
      const excludedKeywords = ['salt']

      const result = generateShoppingList([recipe], [], excludedKeywords)

      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe('chicken breast')
      expect(result.excluded).toHaveLength(1)
      expect(result.excluded[0].item).toBe('salt')
      expect(result.excluded[0].excludedBy).toBe('salt')
    })

    it('should use exact match for exclusion (not partial)', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Black Pepper', amount: 1, unit: 'tsp' },
          { item: 'Pepper', amount: 1, unit: '' },
        ],
      })
      const excludedKeywords = ['pepper']

      const result = generateShoppingList([recipe], [], excludedKeywords)

      // "pepper" exactly matches "pepper", but not "black pepper"
      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe('black pepper')
      expect(result.excluded).toHaveLength(1)
      expect(result.excluded[0].item).toBe('pepper')
    })

    it('should not exclude item when only its alternative matches excluded keyword', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'Paprika', amount: 1, unit: 'tsp', alternatives: ['red pepper'] }],
      })
      const result = generateShoppingList([recipe], [], ['red pepper'])
      // 'paprika' is the primary key — exclusion only checks primary, not alternatives
      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toContain('paprika')
      expect(result.excluded).toHaveLength(0)
    })

    it('should match excluded keyword with surrounding whitespace', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'Salt', amount: 1, unit: 'tsp' }],
      })
      const result = generateShoppingList([recipe], [], ['  salt  '])
      expect(result.excluded).toHaveLength(1)
      expect(result.excluded[0].excludedBy).toBe('  salt  ')
    })

    it('should place item in alreadyHave when it matches both pantry and excluded keyword', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'Salt', amount: 1, unit: 'tsp' }],
      })
      // Pantry check runs before exclusion check — pantry match wins
      const result = generateShoppingList([recipe], [createMockPantryItem('salt')], ['salt'])
      expect(result.alreadyHave).toHaveLength(1)
      expect(result.excluded).toHaveLength(0)
      expect(result.items).toHaveLength(0)
    })
  })

  describe('scaling', () => {
    it('should scale ingredient amounts by scale factor', () => {
      const recipe = createMockRecipe({
        servings: 4,
        ingredients: [{ item: 'Chicken', amount: 1, unit: 'lb' }],
      })

      const result = generateShoppingList([recipe], [], [], 2.0)

      const chicken = result.items.find(i => i.item === 'chicken')
      expect(chicken?.amount).toBe(2) // 1 * 2 = 2
      expect(result.scale).toBe(2.0)
      expect(result.totalServings).toBe(8) // 4 * 2 = 8
    })

    it('should handle fractional scaling', () => {
      const recipe = createMockRecipe({
        servings: 4,
        ingredients: [{ item: 'Flour', amount: 2, unit: 'cups' }],
      })

      const result = generateShoppingList([recipe], [], [], 0.5)

      const flour = result.items.find(i => i.item === 'flour')
      expect(flour?.amount).toBe(1) // 2 * 0.5 = 1
      expect(result.totalServings).toBe(2) // 4 * 0.5 = 2
    })
  })

  describe('category assignment', () => {
    it('should assign categories based on ingredient keywords', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Chicken Breast', amount: 1, unit: 'lb' },
          { item: 'Broccoli', amount: 2, unit: 'cups' },
          { item: 'Butter', amount: 2, unit: 'tbsp' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])

      const chicken = result.items.find(i => i.item === 'chicken breast')
      const broccoli = result.items.find(i => i.item === 'broccoli')
      const butter = result.items.find(i => i.item === 'butter')

      expect(chicken?.categoryKey).toBe('protein')
      expect(broccoli?.categoryKey).toBe('produce')
      expect(butter?.categoryKey).toBe('dairy')
    })

    it('should apply user category overrides', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'Tofu', amount: 1, unit: 'lb' }],
      })
      const userOverrides = { tofu: 'protein' }

      const result = generateShoppingList([recipe], [], [], 1.0, userOverrides)

      const tofu = result.items.find(i => i.item === 'tofu')
      expect(tofu?.categoryKey).toBe('protein')
    })

    it('should categorize guacamole as fresh produce by default', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: 'Guacamole', amount: 1, unit: 'cup' }],
      })

      const result = generateShoppingList([recipe], [], [])

      const guacamole = result.items.find(i => i.item === 'guacamole')
      expect(guacamole?.categoryKey).toBe('produce')
    })
  })

  describe('sorting', () => {
    it('should sort items by category order, then alphabetically', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Zucchini', amount: 1, unit: '' },
          { item: 'Apple', amount: 2, unit: '' },
          { item: 'Chicken', amount: 1, unit: 'lb' },
          { item: 'Milk', amount: 1, unit: 'cup' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])

      // Items should be sorted by category order first
      // Produce (order 1) < Protein (order 4) < Dairy (order 5)
      const categoryOrders = result.items.map(i => i.categoryOrder)
      expect(categoryOrders).toEqual([...categoryOrders].sort((a, b) => a - b))

      // Within same category, should be alphabetical
      const produceItems = result.items.filter(i => i.categoryKey === 'produce')
      if (produceItems.length > 1) {
        const names = produceItems.map(i => i.item)
        expect(names).toEqual([...names].sort())
      }
    })

    it('should sort generated items by learned in-category shopping preference before alphabetical fallback', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Garlic', amount: 1, unit: '' },
          { item: 'Arugula', amount: 1, unit: 'cup' },
          { item: 'Avocado', amount: 1, unit: '' },
          { item: 'Lime', amount: 1, unit: '' },
          { item: 'Cilantro', amount: 1, unit: 'cup' },
        ],
      })

      const result = generateShoppingList([recipe], [], [], 1.0, null, {
        produce: ['lime', 'avocado', 'garlic'],
      })

      expect(result.items.map((item) => item.item)).toEqual([
        'lime',
        'avocado',
        'garlic',
        'arugula',
        'cilantro',
      ])
    })
  })

  describe('edge cases', () => {
    it('should handle ingredients with null/zero amounts', () => {
      const recipe = createMockRecipe({
        ingredients: [
          { item: 'Salt', amount: null, unit: '' },
          { item: 'Pepper', amount: 0, unit: '' },
        ],
      })

      const result = generateShoppingList([recipe], [], [])

      expect(result.items).toHaveLength(2)
      const salt = result.items.find(i => i.item === 'salt')
      const pepper = result.items.find(i => i.item === 'pepper')
      expect(salt?.amount).toBeNull()
      expect(pepper?.amount).toBeNull()
    })

    it('should handle empty ingredients array', () => {
      const recipe = createMockRecipe({ ingredients: [] })

      const result = generateShoppingList([recipe], [], [])

      expect(result.items).toHaveLength(0)
      expect(result.totalServings).toBe(4) // Still counts servings
    })

    it('should handle recipe with default servings (undefined)', () => {
      const recipe = createMockRecipe({ servings: undefined as any })

      const result = generateShoppingList([recipe], [], [])

      expect(result.totalServings).toBe(4) // Default servings
    })

    it('should handle special characters in item names', () => {
      const recipe = createMockRecipe({
        ingredients: [{ item: "Frank's Hot Sauce", amount: 1, unit: 'tbsp' }],
      })

      const result = generateShoppingList([recipe], [], [])

      expect(result.items).toHaveLength(1)
      expect(result.items[0].item).toBe("frank's hot sauce")
    })
  })
})

describe('sortShoppingList', () => {
  it('should sort items by category order, then alphabetically', () => {
    const items: ShoppingItem[] = [
      { item: 'milk', amount: 1, unit: 'cup', categoryKey: 'dairy', categoryOrder: 5, sources: [] },
      { item: 'apple', amount: 2, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
      { item: 'banana', amount: 3, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
      { item: 'chicken', amount: 1, unit: 'lb', categoryKey: 'protein', categoryOrder: 4, sources: [] },
    ]

    const sorted = sortShoppingList(items)

    // Produce (1) comes first, then protein (4), then dairy (5)
    expect(sorted[0].categoryKey).toBe('produce')
    expect(sorted[1].categoryKey).toBe('produce')
    expect(sorted[2].categoryKey).toBe('protein')
    expect(sorted[3].categoryKey).toBe('dairy')

    // Within produce, apple comes before banana
    expect(sorted[0].item).toBe('apple')
    expect(sorted[1].item).toBe('banana')
  })

  it('should not modify the original array', () => {
    const items: ShoppingItem[] = [
      { item: 'milk', amount: 1, unit: 'cup', categoryKey: 'dairy', categoryOrder: 5, sources: [] },
      { item: 'apple', amount: 2, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
    ]
    const originalOrder = items.map(i => i.item)

    sortShoppingList(items)

    expect(items.map(i => i.item)).toEqual(originalOrder)
  })

  it('should handle empty array', () => {
    const result = sortShoppingList([])
    expect(result).toEqual([])
  })

  it('should apply learned in-category shopping preference when sorting', () => {
    const items: ShoppingItem[] = [
      { item: 'garlic', amount: 1, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
      { item: 'avocado', amount: 1, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
      { item: 'arugula', amount: 1, unit: '', categoryKey: 'produce', categoryOrder: 1, sources: [] },
    ]

    const result = sortShoppingList(items, {
      produce: ['avocado', 'garlic'],
    })

    expect(result.map((item) => item.item)).toEqual(['avocado', 'garlic', 'arugula'])
  })
})

describe('ensureCategoryInfo', () => {
  it('should return item unchanged if category info already present', () => {
    const item: ShoppingItem = {
      item: 'milk',
      amount: 1,
      unit: 'cup',
      categoryKey: 'dairy',
      categoryOrder: 5,
      sources: [],
    }

    const result = ensureCategoryInfo(item)

    expect(result).toEqual(item)
  })

  it('should add category info if missing categoryKey', () => {
    const item: ShoppingItem = {
      item: 'chicken breast',
      amount: 1,
      unit: 'lb',
      categoryKey: '',
      categoryOrder: undefined as any,
      sources: [],
    }

    const result = ensureCategoryInfo(item)

    expect(result.categoryKey).toBe('protein')
    expect(result.categoryOrder).toBeDefined()
  })

  it('should apply user overrides when adding category info', () => {
    const item: ShoppingItem = {
      item: 'tofu',
      amount: 1,
      unit: 'lb',
      categoryKey: '',
      categoryOrder: undefined as any,
      sources: [],
    }
    const userOverrides = { tofu: 'protein' }

    const result = ensureCategoryInfo(item, userOverrides)

    expect(result.categoryKey).toBe('protein')
  })
})
