import { describe, it, expect } from 'vitest'
import type { ShoppingItem } from '@/types/database'
import { mergeShoppingItems, removeRecipeByNameFromItems } from '../shopping-list-merging'

describe('mergeShoppingItems', () => {
  it('should merge items with same name and compatible units', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'flour',
        amount: 2,
        unit: 'cup',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'Flour',
        amount: 1,
        unit: 'cup',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    expect(result[0].item).toBe('flour')
    expect(result[0].amount).toBe(3)
    expect(result[0].unit).toBe('cup')
    expect(result[0].sources).toHaveLength(2)
  })

  it('should normalize units before merging', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'flour',
        amount: 2,
        unit: 'TBSP',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'flour',
        amount: 1,
        unit: 'tbsp',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    expect(result[0].unit).toBe('tbsp') // Normalized
    expect(result[0].amount).toBe(3)
  })

  it('should merge compatible units (volume)', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'milk',
        amount: 2,
        unit: 'cup',
        categoryKey: 'dairy',
        categoryOrder: 5,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'milk',
        amount: 8,
        unit: 'fl oz',
        categoryKey: 'dairy',
        categoryOrder: 5,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    // 2 cups = ~473ml, 8 fl oz = ~237ml, total = ~710ml = ~3 cups
    expect(result[0].amount).toBeGreaterThan(2.5)
    expect(result[0].amount).toBeLessThan(3.5)
  })

  it('should use additionalAmounts for incompatible units (volume vs weight)', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'flour',
        amount: 2,
        unit: 'cup', // Volume
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'flour',
        amount: 1,
        unit: 'lb', // Weight - incompatible with volume
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    // For incompatible units, keep the first item's amount and add second to additionalAmounts
    expect(result[0].amount).toBe(2) // First item's amount
    expect(result[0].unit).toBe('cup') // First item's unit
    expect(result[0].additionalAmounts).toBeDefined()
    expect(result[0].additionalAmounts!.length).toBe(1)
    expect(result[0].additionalAmounts![0]).toEqual({ amount: 1, unit: 'lb' })
  })

  it('should deduplicate sources by recipe name', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'onions',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'onions',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [
          { recipeName: 'Recipe A' }, // Duplicate
          { recipeName: 'Recipe B' },
        ],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(2)
    expect(result[0].sources?.map((s) => s.recipeName).sort()).toEqual([
      'Recipe A',
      'Recipe B',
    ])
  })

  it('should preserve custom order when requested', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'zucchini',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
      {
        item: 'apple',
        amount: 2,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'banana',
        amount: 3,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems, {
      preserveCustomOrder: true,
    })

    expect(result).toHaveLength(3)
    // Order should be preserved (zucchini, apple, banana)
    expect(result[0].item).toBe('zucchini')
    expect(result[1].item).toBe('apple')
    expect(result[2].item).toBe('banana')
  })

  it('should sort by category and name when not preserving order', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'zucchini',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
      {
        item: 'chicken',
        amount: 1,
        unit: 'lb',
        categoryKey: 'protein',
        categoryOrder: 4,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'apple',
        amount: 2,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems, {
      preserveCustomOrder: false,
    })

    expect(result).toHaveLength(3)
    // Should be sorted: produce (apple, zucchini), then protein (chicken)
    expect(result[0].item).toBe('apple')
    expect(result[1].item).toBe('zucchini')
    expect(result[2].item).toBe('chicken')
  })

  it('should handle items with null amounts', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'salt',
        amount: null,
        unit: '',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'salt',
        amount: 1,
        unit: 'tsp',
        categoryKey: 'pantry',
        categoryOrder: 6,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(1)
    expect(result[0].unit).toBe('tsp')
  })

  it('should merge multiple items with same name', () => {
    const existing: ShoppingItem[] = [
      {
        item: 'garlic',
        amount: 2,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
      {
        item: 'garlic',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const newItems: ShoppingItem[] = [
      {
        item: 'garlic',
        amount: 3,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe C' }],
      },
    ]

    const result = mergeShoppingItems(existing, newItems)

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(6) // 2 + 1 + 3
    expect(result[0].sources).toHaveLength(3)
  })
})

describe('removeRecipeByNameFromItems', () => {
  it('should remove recipe from sources', () => {
    const items: ShoppingItem[] = [
      {
        item: 'onions',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [
          { recipeName: 'Recipe A' },
          { recipeName: 'Recipe B' },
        ],
      },
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe A')

    expect(result).toHaveLength(1)
    expect(result[0].sources).toHaveLength(1)
    expect(result[0].sources![0].recipeName).toBe('Recipe B')
  })

  it('should remove items with no sources left', () => {
    const items: ShoppingItem[] = [
      {
        item: 'onions',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
      {
        item: 'garlic',
        amount: 2,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe B' }],
      },
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe A')

    expect(result).toHaveLength(1)
    expect(result[0].item).toBe('garlic')
  })

  it('should preserve manual items', () => {
    const items: ShoppingItem[] = [
      {
        item: 'onions',
        amount: 1,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Manual' }],
      },
      {
        item: 'garlic',
        amount: 2,
        unit: '',
        categoryKey: 'produce',
        categoryOrder: 1,
        sources: [{ recipeName: 'Recipe A' }],
      },
    ]

    const result = removeRecipeByNameFromItems(items, 'Recipe A')

    // Garlic should be removed (no sources left), onions should be kept (manual)
    expect(result).toHaveLength(1)
    expect(result[0].item).toBe('onions') // Manual item preserved
  })
})
