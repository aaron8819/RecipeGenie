import { describe, it, expect } from 'vitest'
import {
  categorizeIngredient,
  isExcludedIngredient,
  getExcludedKeyword,
  getShoppingCategories,
  getAllShoppingCategories,
  getCategoryByKey,
  generateCategoryId,
  getNextCategoryOrder,
  SHOPPING_CATEGORIES,
} from '../shopping-categories'
import type { CustomShoppingCategory } from '@/types/database'

/**
 * Unit tests for shopping-categories.ts
 */

describe('SHOPPING_CATEGORIES', () => {
  it('should have all expected default categories', () => {
    const categories = Object.keys(SHOPPING_CATEGORIES)

    expect(categories).toContain('produce')
    expect(categories).toContain('deli')
    expect(categories).toContain('bakery')
    expect(categories).toContain('protein')
    expect(categories).toContain('dairy')
    expect(categories).toContain('pantry')
    expect(categories).toContain('frozen')
    expect(categories).toContain('misc')
  })

  it('should have unique order values', () => {
    const orders = Object.values(SHOPPING_CATEGORIES).map(c => c.order)
    const uniqueOrders = new Set(orders)

    expect(uniqueOrders.size).toBe(orders.length)
  })

  it('should have keywords for each category', () => {
    for (const category of Object.values(SHOPPING_CATEGORIES)) {
      expect(category.keywords).toBeDefined()
      expect(category.keywords.length).toBeGreaterThan(0)
    }
  })
})

describe('categorizeIngredient', () => {
  describe('produce category', () => {
    it('should categorize vegetables as produce', () => {
      expect(categorizeIngredient('tomato')[0]).toBe('produce')
      expect(categorizeIngredient('onion')[0]).toBe('produce')
      expect(categorizeIngredient('garlic')[0]).toBe('produce')
      expect(categorizeIngredient('spinach')[0]).toBe('produce')
      expect(categorizeIngredient('broccoli')[0]).toBe('produce')
    })

    it('should categorize fruits as produce', () => {
      expect(categorizeIngredient('apple')[0]).toBe('produce')
      expect(categorizeIngredient('banana')[0]).toBe('produce')
      expect(categorizeIngredient('lemon')[0]).toBe('produce')
      expect(categorizeIngredient('strawberries')[0]).toBe('produce')
    })

    it('should categorize fresh herbs as produce', () => {
      expect(categorizeIngredient('cilantro')[0]).toBe('produce')
      expect(categorizeIngredient('basil')[0]).toBe('produce')
      expect(categorizeIngredient('parsley')[0]).toBe('produce')
    })
  })

  describe('protein category', () => {
    it('should categorize meats as protein', () => {
      expect(categorizeIngredient('chicken breast')[0]).toBe('protein')
      expect(categorizeIngredient('ground beef')[0]).toBe('protein')
      expect(categorizeIngredient('pork chops')[0]).toBe('protein')
      expect(categorizeIngredient('lamb chops')[0]).toBe('protein')
    })

    it('should categorize seafood as protein', () => {
      expect(categorizeIngredient('salmon')[0]).toBe('protein')
      expect(categorizeIngredient('shrimp')[0]).toBe('protein')
      expect(categorizeIngredient('cod')[0]).toBe('protein')
    })
  })

  describe('dairy category', () => {
    it('should categorize dairy products', () => {
      expect(categorizeIngredient('milk')[0]).toBe('dairy')
      expect(categorizeIngredient('butter')[0]).toBe('dairy')
      expect(categorizeIngredient('eggs')[0]).toBe('dairy')
      expect(categorizeIngredient('yogurt')[0]).toBe('dairy')
      expect(categorizeIngredient('heavy cream')[0]).toBe('dairy')
    })
  })

  describe('pantry category', () => {
    it('should categorize pantry staples', () => {
      expect(categorizeIngredient('flour')[0]).toBe('pantry')
      expect(categorizeIngredient('sugar')[0]).toBe('pantry')
      expect(categorizeIngredient('olive oil')[0]).toBe('pantry')
      expect(categorizeIngredient('soy sauce')[0]).toBe('pantry')
      expect(categorizeIngredient('chicken broth')[0]).toBe('pantry')
    })

    it('should categorize pasta and grains as pantry', () => {
      expect(categorizeIngredient('pasta')[0]).toBe('pantry')
      expect(categorizeIngredient('rice')[0]).toBe('pantry')
      expect(categorizeIngredient('quinoa')[0]).toBe('pantry')
    })

    it('should categorize spices as pantry', () => {
      expect(categorizeIngredient('cumin')[0]).toBe('pantry')
      expect(categorizeIngredient('paprika')[0]).toBe('pantry')
      expect(categorizeIngredient('cinnamon')[0]).toBe('pantry')
    })
  })

  describe('deli category', () => {
    it('should categorize deli meats', () => {
      expect(categorizeIngredient('ham')[0]).toBe('deli')
      expect(categorizeIngredient('prosciutto')[0]).toBe('deli')
      expect(categorizeIngredient('bacon')[0]).toBe('deli')
    })

    it('should categorize cheeses as deli', () => {
      expect(categorizeIngredient('cheddar')[0]).toBe('deli')
      expect(categorizeIngredient('mozzarella')[0]).toBe('deli')
      expect(categorizeIngredient('parmesan')[0]).toBe('deli')
    })
  })

  describe('bakery category', () => {
    it('should categorize bread products', () => {
      expect(categorizeIngredient('bread')[0]).toBe('bakery')
      expect(categorizeIngredient('tortillas')[0]).toBe('bakery')
      expect(categorizeIngredient('bagels')[0]).toBe('bakery')
    })
  })

  describe('frozen category', () => {
    it('should categorize frozen items', () => {
      expect(categorizeIngredient('frozen peas')[0]).toBe('frozen')
      expect(categorizeIngredient('frozen spinach')[0]).toBe('frozen')
      expect(categorizeIngredient('ice cream')[0]).toBe('frozen')
    })
  })

  describe('word boundary matching', () => {
    it('should match whole words only', () => {
      // "pepper" should match as produce
      expect(categorizeIngredient('pepper')[0]).toBe('produce')

      // "peppermint" should NOT match "pepper" keyword
      // It should fall back to pantry (default)
      const result = categorizeIngredient('peppermint')
      expect(result[0]).toBe('pantry')
    })

    it('should match multi-word keywords', () => {
      expect(categorizeIngredient('sun dried tomatoes')[0]).toBe('pantry')
      expect(categorizeIngredient('chicken breast')[0]).toBe('protein')
      expect(categorizeIngredient('olive oil')[0]).toBe('pantry')
    })

    it('should prioritize longer keyword matches', () => {
      // "sun dried tomatoes" should match pantry (longer keyword)
      // NOT produce (tomatoes keyword)
      expect(categorizeIngredient('sun dried tomatoes')[0]).toBe('pantry')
    })
  })

  describe('user overrides', () => {
    it('should apply user category overrides (highest priority)', () => {
      const userOverrides = { 'tofu': 'protein' }

      const result = categorizeIngredient('tofu', null, userOverrides)

      expect(result[0]).toBe('protein')
    })

    it('should match user overrides case-insensitively', () => {
      const userOverrides = { 'tofu': 'protein' }

      // Item name is normalized to lowercase before checking
      const result = categorizeIngredient('TOFU', null, userOverrides)

      // This depends on how the function normalizes - let's check actual behavior
      // The function does: itemLower = itemName.toLowerCase().trim()
      // So 'TOFU' becomes 'tofu' which matches the override
      expect(result[0]).toBe('protein')
    })

    it('should ignore override if category key is invalid', () => {
      const userOverrides = { 'milk': 'nonexistent_category' }

      const result = categorizeIngredient('milk', null, userOverrides)

      // Should fall back to keyword matching (dairy)
      expect(result[0]).toBe('dairy')
    })
  })

  describe('recipe override category', () => {
    it('should use overrideCategory if provided and valid', () => {
      const result = categorizeIngredient('mystery item', 'produce')

      expect(result[0]).toBe('produce')
    })

    it('should ignore invalid overrideCategory', () => {
      const result = categorizeIngredient('milk', 'invalid_category')

      // Should fall back to keyword matching
      expect(result[0]).toBe('dairy')
    })
  })

  describe('default category', () => {
    it('should default to pantry for unknown items', () => {
      const result = categorizeIngredient('xyzabc123')

      expect(result[0]).toBe('pantry')
    })
  })

  describe('case insensitivity', () => {
    it('should match keywords case-insensitively', () => {
      expect(categorizeIngredient('CHICKEN')[0]).toBe('protein')
      expect(categorizeIngredient('Milk')[0]).toBe('dairy')
      expect(categorizeIngredient('BROCCOLI')[0]).toBe('produce')
    })
  })

  describe('return value', () => {
    it('should return [categoryKey, categoryOrder] tuple', () => {
      const result = categorizeIngredient('chicken')

      expect(result).toHaveLength(2)
      expect(typeof result[0]).toBe('string')
      expect(typeof result[1]).toBe('number')
      expect(result[0]).toBe('protein')
      expect(result[1]).toBe(SHOPPING_CATEGORIES.protein.order)
    })
  })
})

describe('isExcludedIngredient', () => {
  it('should return true for exact matches', () => {
    const excludedKeywords = ['salt', 'pepper', 'oil']

    expect(isExcludedIngredient('salt', excludedKeywords)).toBe(true)
    expect(isExcludedIngredient('pepper', excludedKeywords)).toBe(true)
    expect(isExcludedIngredient('oil', excludedKeywords)).toBe(true)
  })

  it('should be case-insensitive', () => {
    const excludedKeywords = ['salt']

    expect(isExcludedIngredient('SALT', excludedKeywords)).toBe(true)
    expect(isExcludedIngredient('Salt', excludedKeywords)).toBe(true)
  })

  it('should NOT match partial/substring matches', () => {
    const excludedKeywords = ['pepper']

    // "black pepper" should NOT be excluded by "pepper" keyword
    expect(isExcludedIngredient('black pepper', excludedKeywords)).toBe(false)
    expect(isExcludedIngredient('red pepper flakes', excludedKeywords)).toBe(false)
  })

  it('should NOT match partial matches in opposite direction', () => {
    const excludedKeywords = ['olive oil']

    // "oil" should NOT be excluded by "olive oil" keyword
    expect(isExcludedIngredient('oil', excludedKeywords)).toBe(false)
    expect(isExcludedIngredient('olive', excludedKeywords)).toBe(false)
  })

  it('should return false for empty excluded keywords', () => {
    expect(isExcludedIngredient('salt', [])).toBe(false)
  })

  it('should handle whitespace', () => {
    const excludedKeywords = ['salt']

    expect(isExcludedIngredient('  salt  ', excludedKeywords)).toBe(true)
  })
})

describe('getExcludedKeyword', () => {
  it('should return matching keyword for exact matches', () => {
    const excludedKeywords = ['salt', 'pepper', 'oil']

    expect(getExcludedKeyword('salt', excludedKeywords)).toBe('salt')
    expect(getExcludedKeyword('pepper', excludedKeywords)).toBe('pepper')
  })

  it('should return null for non-matches', () => {
    const excludedKeywords = ['salt']

    expect(getExcludedKeyword('pepper', excludedKeywords)).toBeNull()
    expect(getExcludedKeyword('table salt', excludedKeywords)).toBeNull()
  })

  it('should be case-insensitive for item name', () => {
    const excludedKeywords = ['Salt']

    expect(getExcludedKeyword('salt', excludedKeywords)).toBe('Salt')
    expect(getExcludedKeyword('SALT', excludedKeywords)).toBe('Salt')
  })

  it('should return the original keyword casing', () => {
    const excludedKeywords = ['SALT']

    const result = getExcludedKeyword('salt', excludedKeywords)
    expect(result).toBe('SALT')
  })
})

describe('getShoppingCategories', () => {
  it('should return all default categories', () => {
    const categories = getShoppingCategories()

    expect(categories.length).toBe(Object.keys(SHOPPING_CATEGORIES).length)
  })

  it('should return categories sorted by order', () => {
    const categories = getShoppingCategories()

    for (let i = 1; i < categories.length; i++) {
      expect(categories[i].order).toBeGreaterThanOrEqual(categories[i - 1].order)
    }
  })

  it('should include key, name, and order for each category', () => {
    const categories = getShoppingCategories()

    for (const cat of categories) {
      expect(cat.key).toBeDefined()
      expect(cat.name).toBeDefined()
      expect(cat.order).toBeDefined()
    }
  })
})

describe('getAllShoppingCategories', () => {
  it('should return default categories when no custom categories', () => {
    const categories = getAllShoppingCategories()

    expect(categories.length).toBe(Object.keys(SHOPPING_CATEGORIES).length)
    expect(categories.every(c => !c.isCustom)).toBe(true)
  })

  it('should include custom categories', () => {
    const customCategories: CustomShoppingCategory[] = [
      { id: 'asian', name: 'Asian Market', order: 10 },
    ]

    const categories = getAllShoppingCategories(customCategories)

    expect(categories.length).toBe(Object.keys(SHOPPING_CATEGORIES).length + 1)

    const customCat = categories.find(c => c.key === 'custom_asian')
    expect(customCat).toBeDefined()
    expect(customCat?.name).toBe('Asian Market')
    expect(customCat?.isCustom).toBe(true)
  })

  it('should apply custom category ordering', () => {
    const customOrder = ['dairy', 'produce', 'protein']

    const categories = getAllShoppingCategories(null, customOrder)

    expect(categories[0].key).toBe('dairy')
    expect(categories[1].key).toBe('produce')
    expect(categories[2].key).toBe('protein')
  })

  it('should put categories not in custom order at the end', () => {
    const customOrder = ['dairy', 'produce']

    const categories = getAllShoppingCategories(null, customOrder)

    expect(categories[0].key).toBe('dairy')
    expect(categories[1].key).toBe('produce')
    // Other categories should be after these
    expect(categories.slice(0, 2).map(c => c.key)).toEqual(['dairy', 'produce'])
  })

  it('should handle empty custom order', () => {
    const categories = getAllShoppingCategories(null, [])

    // Should fall back to default ordering
    for (let i = 1; i < categories.length; i++) {
      expect(categories[i].order).toBeGreaterThanOrEqual(categories[i - 1].order)
    }
  })
})

describe('getCategoryByKey', () => {
  it('should return built-in category by key', () => {
    const result = getCategoryByKey('produce')

    expect(result).toBeDefined()
    expect(result?.name).toBe('Fresh Produce')
    expect(result?.isCustom).toBe(false)
  })

  it('should return custom category by prefixed key', () => {
    const customCategories: CustomShoppingCategory[] = [
      { id: 'asian', name: 'Asian Market', order: 10 },
    ]

    const result = getCategoryByKey('custom_asian', customCategories)

    expect(result).toBeDefined()
    expect(result?.name).toBe('Asian Market')
    expect(result?.isCustom).toBe(true)
  })

  it('should return null for unknown key', () => {
    const result = getCategoryByKey('nonexistent')

    expect(result).toBeNull()
  })

  it('should return null for custom key without matching category', () => {
    const result = getCategoryByKey('custom_unknown', [])

    expect(result).toBeNull()
  })
})

describe('generateCategoryId', () => {
  it('should return a UUID string', () => {
    const id = generateCategoryId()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[a-f0-9-]+$/i)
  })

  it('should generate unique IDs', () => {
    const id1 = generateCategoryId()
    const id2 = generateCategoryId()

    expect(id1).not.toBe(id2)
  })
})

describe('getNextCategoryOrder', () => {
  it('should return max default order + 1 when no custom categories', () => {
    const maxDefaultOrder = Math.max(...Object.values(SHOPPING_CATEGORIES).map(c => c.order))

    const nextOrder = getNextCategoryOrder()

    expect(nextOrder).toBe(maxDefaultOrder + 1)
  })

  it('should return max of all orders + 1 with custom categories', () => {
    const customCategories: CustomShoppingCategory[] = [
      { id: 'asian', name: 'Asian Market', order: 100 },
    ]

    const nextOrder = getNextCategoryOrder(customCategories)

    expect(nextOrder).toBe(101)
  })

  it('should handle empty custom categories array', () => {
    const maxDefaultOrder = Math.max(...Object.values(SHOPPING_CATEGORIES).map(c => c.order))

    const nextOrder = getNextCategoryOrder([])

    expect(nextOrder).toBe(maxDefaultOrder + 1)
  })

  it('should handle custom categories with lower orders than defaults', () => {
    const customCategories: CustomShoppingCategory[] = [
      { id: 'custom1', name: 'Custom 1', order: 1 },
    ]
    const maxDefaultOrder = Math.max(...Object.values(SHOPPING_CATEGORIES).map(c => c.order))

    const nextOrder = getNextCategoryOrder(customCategories)

    expect(nextOrder).toBe(maxDefaultOrder + 1)
  })
})
