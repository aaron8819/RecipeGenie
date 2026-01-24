import { describe, it, expect } from 'vitest'
import type { Recipe, PantryItem } from '@/types/database'
import { generateShoppingList } from '../shopping-list'

describe('generateShoppingList', () => {
  it('should normalize units in generated items', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Test Recipe',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'Flour', amount: 2, unit: 'TBSP' },
          { item: 'Sugar', amount: 1, unit: 'CUP' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const result = generateShoppingList(recipes, [], [], 1.0)

    expect(result.items).toHaveLength(2)
    expect(result.items[0].unit).toBe('tbsp') // Normalized
    expect(result.items[1].unit).toBe('cup') // Normalized
  })

  it('should normalize item names', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Test Recipe',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: '  Chicken Breast  ', amount: 1, unit: 'lb' },
          { item: 'ONIONS', amount: 2, unit: '' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const result = generateShoppingList(recipes, [], [], 1.0)

    expect(result.items).toHaveLength(2)
    // Items are sorted by category, so order may vary - check both
    const itemNames = result.items.map(i => i.item).sort()
    expect(itemNames).toContain('chicken breast') // Normalized
    expect(itemNames).toContain('onions') // Normalized
  })

  it('should merge items with same name and compatible units', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Recipe A',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'flour', amount: 2, unit: 'cup' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'recipe-2',
        user_id: 'user-1',
        name: 'Recipe B',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'Flour', amount: 1, unit: 'cup' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const result = generateShoppingList(recipes, [], [], 1.0)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].item).toBe('flour')
    expect(result.items[0].amount).toBe(3) // 2 + 1
    expect(result.items[0].sources).toHaveLength(2)
  })

  it('should handle scaling', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Test Recipe',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'flour', amount: 2, unit: 'cup' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const result = generateShoppingList(recipes, [], [], 2.0)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].amount).toBe(4) // 2 * 2
    expect(result.totalServings).toBe(8) // 4 * 2
  })

  it('should split items into sections based on pantry', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Test Recipe',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'flour', amount: 2, unit: 'cup' },
          { item: 'salt', amount: 1, unit: 'tsp' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const pantryItems: PantryItem[] = [
      { user_id: 'user-1', item: 'salt', created_at: new Date().toISOString() },
    ]

    const result = generateShoppingList(recipes, pantryItems, [], 1.0)

    expect(result.items).toHaveLength(1)
    expect(result.items[0].item).toBe('flour')
    expect(result.alreadyHave).toHaveLength(1)
    expect(result.alreadyHave[0].item).toBe('salt')
  })

  it('should exclude items matching excluded keywords (exact match only)', () => {
    const recipes: Recipe[] = [
      {
        id: 'recipe-1',
        user_id: 'user-1',
        name: 'Test Recipe',
        category: 'chicken',
        servings: 4,
        favorite: false,
        tags: [],
        ingredients: [
          { item: 'flour', amount: 2, unit: 'cup' },
          { item: 'garlic powder', amount: 1, unit: 'tsp' },
          { item: 'pepper', amount: 1, unit: 'tsp' },
          { item: 'poblano pepper', amount: 2, unit: '' },
        ],
        instructions: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    const result = generateShoppingList(recipes, [], ['pepper'], 1.0)

    expect(result.items).toHaveLength(3) // flour, garlic powder, poblano pepper
    expect(result.items.find(i => i.item === 'flour')).toBeDefined()
    expect(result.items.find(i => i.item === 'garlic powder')).toBeDefined()
    expect(result.items.find(i => i.item === 'poblano pepper')).toBeDefined()
    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].item).toBe('pepper') // Only exact match
  })
})
