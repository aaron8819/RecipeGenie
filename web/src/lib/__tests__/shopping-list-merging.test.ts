import { describe, it, expect } from 'vitest'
import {
  mergeShoppingItems,
  removeRecipeFromItems,
  removeRecipeByNameFromItems,
} from '../shopping-list-merging'
import type { ShoppingItem } from '@/types/database'

/**
 * Unit tests for shopping-list-merging.ts
 */

// Helper to create a mock shopping item
function createMockItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    item: 'test item',
    amount: 1,
    unit: 'cup',
    categoryKey: 'produce',
    categoryOrder: 1,
    sources: [{ recipeId: 'recipe-1', recipeName: 'Test Recipe' }],
    ...overrides,
  }
}

describe('mergeShoppingItems', () => {
  describe('basic merging', () => {
    it('should merge items with same name from different sources', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'Milk', amount: 1, unit: 'cup', sources: [{ recipeId: 'r1', recipeName: 'Recipe 1' }] }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'milk', amount: 1, unit: 'cup', sources: [{ recipeId: 'r2', recipeName: 'Recipe 2' }] }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      expect(result[0].amount).toBe(2) // 1 + 1
      expect(result[0].sources).toHaveLength(2)
    })

    it('should add new items that do not exist', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'milk', amount: 1, unit: 'cup' }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'eggs', amount: 6, unit: '' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(2)
      expect(result.map(i => i.item)).toContain('milk')
      expect(result.map(i => i.item)).toContain('eggs')
    })

    it('should normalize item names before merging (case-insensitive)', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'MILK', amount: 1, unit: 'cup' }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'Milk', amount: 1, unit: 'cup' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      expect(result[0].amount).toBe(2)
    })
  })

  describe('unit merging', () => {
    it('should merge compatible volume units (cups + fl oz)', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'milk', amount: 1, unit: 'cup' }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'milk', amount: 8, unit: 'fl oz' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      // 1 cup + 8 fl oz = 1 cup + 1 cup = 2 cups
      expect(result[0].amount).toBe(2)
      expect(result[0].unit).toBe('cup')
    })

    it('should merge compatible weight units (lb + oz)', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'chicken', amount: 1, unit: 'lb' }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'chicken', amount: 8, unit: 'oz' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      // 1 lb + 8 oz = 1.5 lb
      expect(result[0].amount).toBe(1.5)
      expect(result[0].unit).toBe('lb')
    })

    it('should use additionalAmounts for incompatible units', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'cheese', amount: 1, unit: 'cup', categoryKey: 'dairy', categoryOrder: 5 }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'cheese', amount: 8, unit: 'oz', categoryKey: 'dairy', categoryOrder: 5 }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      // cup (volume) and oz (weight) are incompatible
      expect(result[0].amount).toBe(1)
      expect(result[0].unit).toBe('cup')
      expect(result[0].additionalAmounts).toBeDefined()
      expect(result[0].additionalAmounts).toHaveLength(1)
      expect(result[0].additionalAmounts![0].amount).toBe(8)
      expect(result[0].additionalAmounts![0].unit).toBe('oz')
    })
  })

  describe('source deduplication', () => {
    it('should deduplicate sources by recipeId', () => {
      const existing: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          sources: [{ recipeId: 'r1', recipeName: 'Recipe 1' }]
        }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          sources: [
            { recipeId: 'r1', recipeName: 'Recipe 1' }, // Duplicate
            { recipeId: 'r2', recipeName: 'Recipe 2' }, // New
          ]
        }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result[0].sources).toHaveLength(2)
      const sourceIds = result[0].sources?.map(s => s.recipeId)
      expect(sourceIds).toContain('r1')
      expect(sourceIds).toContain('r2')
    })

    it('should handle sources without recipeId (legacy)', () => {
      const existing: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          sources: [{ recipeName: 'Recipe 1' }]
        }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          sources: [{ recipeName: 'Recipe 2' }]
        }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result[0].sources).toHaveLength(2)
    })
  })

  describe('options', () => {
    it('should preserve user overrides when preserveUserOverrides is true', () => {
      const existing: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          amount: 1,
          categoryKey: 'dairy',
          categoryOrder: 5,
        }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({
          item: 'milk',
          amount: 1,
          categoryKey: 'produce', // Different category
          categoryOrder: 1,
        }),
      ]

      const result = mergeShoppingItems(existing, newItems, { preserveUserOverrides: true })

      // Should keep the existing item's category
      expect(result[0].categoryKey).toBe('dairy')
      expect(result[0].categoryOrder).toBe(5)
    })

    it('should sort by category when preserveCustomOrder is false', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'milk', categoryKey: 'dairy', categoryOrder: 5 }),
        createMockItem({ item: 'apple', categoryKey: 'produce', categoryOrder: 1 }),
      ]
      const newItems: ShoppingItem[] = []

      const result = mergeShoppingItems(existing, newItems, { preserveCustomOrder: false })

      expect(result[0].categoryKey).toBe('produce') // Order 1
      expect(result[1].categoryKey).toBe('dairy') // Order 5
    })

    it('should preserve order when preserveCustomOrder is true', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'milk', categoryKey: 'dairy', categoryOrder: 5 }),
        createMockItem({ item: 'apple', categoryKey: 'produce', categoryOrder: 1 }),
      ]
      const newItems: ShoppingItem[] = []

      const result = mergeShoppingItems(existing, newItems, { preserveCustomOrder: true })

      // Original order should be preserved
      expect(result[0].item).toBe('milk')
      expect(result[1].item).toBe('apple')
    })

    it('should apply userCategoryOverrides when merging items', () => {
      // User overrides are applied during merge operations
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'tofu', amount: 1, unit: 'lb', categoryKey: 'produce', categoryOrder: 1, sources: [{ recipeId: 'r1', recipeName: 'Recipe 1' }] }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'tofu', amount: 1, unit: 'lb', categoryKey: 'produce', categoryOrder: 1, sources: [{ recipeId: 'r2', recipeName: 'Recipe 2' }] }),
      ]
      const userOverrides = { tofu: 'protein' }

      const result = mergeShoppingItems(existing, newItems, { userCategoryOverrides: userOverrides })

      expect(result).toHaveLength(1)
      expect(result[0].categoryKey).toBe('protein')
    })

    it('should preserve existing category when no merge occurs and no new items', () => {
      // When no merging happens, existing category is preserved
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'tofu', categoryKey: 'produce', categoryOrder: 1 }),
      ]
      const newItems: ShoppingItem[] = []
      const userOverrides = { tofu: 'protein' }

      const result = mergeShoppingItems(existing, newItems, { userCategoryOverrides: userOverrides })

      // Category is not updated because no merge occurred
      expect(result[0].categoryKey).toBe('produce')
    })
  })

  describe('edge cases', () => {
    it('should handle empty existing array', () => {
      const existing: ShoppingItem[] = []
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'milk' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
    })

    it('should handle empty new items array', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'milk' }),
      ]
      const newItems: ShoppingItem[] = []

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
    })

    it('should handle both arrays empty', () => {
      const result = mergeShoppingItems([], [])
      expect(result).toHaveLength(0)
    })

    it('should handle null amounts', () => {
      const existing: ShoppingItem[] = [
        createMockItem({ item: 'salt', amount: null, unit: '' }),
      ]
      const newItems: ShoppingItem[] = [
        createMockItem({ item: 'salt', amount: 1, unit: 'tsp' }),
      ]

      const result = mergeShoppingItems(existing, newItems)

      expect(result).toHaveLength(1)
      // Should have the amount from the new item
      expect(result[0].amount).toBe(1)
    })
  })
})

describe('removeRecipeFromItems', () => {
  it('should remove recipe from item sources by recipeId', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [
          { recipeId: 'r1', recipeName: 'Recipe 1' },
          { recipeId: 'r2', recipeName: 'Recipe 2' },
        ],
      }),
    ]

    const result = removeRecipeFromItems(items, 'r1')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeId).toBe('r2')
  })

  it('should remove item entirely when no sources remain', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [{ recipeId: 'r1', recipeName: 'Recipe 1' }],
      }),
    ]

    const result = removeRecipeFromItems(items, 'r1')

    expect(result).toHaveLength(0)
  })

  it('should keep manual items even when last recipe source is removed', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [
          { recipeId: 'r1', recipeName: 'Recipe 1' },
          { recipeId: '', recipeName: 'Manual' },
        ],
      }),
    ]

    const result = removeRecipeFromItems(items, 'r1')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeName).toBe('Manual')
  })

  it('should handle items without the specified recipe', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [{ recipeId: 'r1', recipeName: 'Recipe 1' }],
      }),
      createMockItem({
        item: 'eggs',
        sources: [{ recipeId: 'r2', recipeName: 'Recipe 2' }],
      }),
    ]

    const result = removeRecipeFromItems(items, 'r1')

    expect(result).toHaveLength(1)
    expect(result[0].item).toBe('eggs')
  })

  it('should handle empty array', () => {
    const result = removeRecipeFromItems([], 'r1')
    expect(result).toHaveLength(0)
  })

  it('should handle items with empty sources', () => {
    const items: ShoppingItem[] = [
      createMockItem({ item: 'milk', sources: [] }),
    ]

    const result = removeRecipeFromItems(items, 'r1')

    expect(result).toHaveLength(0) // No sources, so removed
  })
})

describe('removeRecipeByNameFromItems', () => {
  it('should remove recipe from item sources by recipeName', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [
          { recipeName: 'Recipe 1' },
          { recipeName: 'Recipe 2' },
        ],
      }),
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe 1')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeName).toBe('Recipe 2')
  })

  it('should remove item entirely when no sources remain', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [{ recipeName: 'Recipe 1' }],
      }),
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe 1')

    expect(result).toHaveLength(0)
  })

  it('should keep manual items', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [
          { recipeName: 'Recipe 1' },
          { recipeName: 'Manual' },
        ],
      }),
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe 1')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeName).toBe('Manual')
  })

  it('should be case-sensitive for recipe names', () => {
    const items: ShoppingItem[] = [
      createMockItem({
        item: 'milk',
        sources: [
          { recipeName: 'Recipe 1' },
          { recipeName: 'recipe 1' }, // Different case
        ],
      }),
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe 1')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeName).toBe('recipe 1')
  })

  it('should handle empty array', () => {
    const result = removeRecipeByNameFromItems([], 'Recipe 1')
    expect(result).toHaveLength(0)
  })
})
