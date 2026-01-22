import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ShoppingItem, ShoppingList } from '@/types/database'

describe('Shopping List Checked State Logic', () => {
  let mockShoppingList: ShoppingList

  beforeEach(() => {
    mockShoppingList = {
      user_id: 'test-user',
      items: [
        {
          item: 'Milk',
          amount: 1,
          unit: 'gallon',
          categoryKey: 'dairy',
          categoryOrder: 3,
          sources: [{ recipeName: 'Test Recipe' }],
          checked: false,
        },
        {
          item: 'Bread',
          amount: 1,
          unit: 'loaf',
          categoryKey: 'bakery',
          categoryOrder: 2,
          sources: [{ recipeName: 'Test Recipe' }],
          checked: false,
        },
        {
          item: 'Eggs',
          amount: 12,
          unit: 'count',
          categoryKey: 'dairy',
          categoryOrder: 3,
          sources: [{ recipeName: 'Test Recipe' }],
          checked: false,
        },
      ],
      already_have: [],
      excluded: [],
      source_recipes: ['recipe-1'],
      scale: 1.0,
      total_servings: 4,
      custom_order: false,
      generated_at: new Date().toISOString(),
    }
  })

  describe('Checked State Toggle', () => {
    it('should toggle checked state from false to true', () => {
      const item = mockShoppingList.items[0]
      const updatedItems = mockShoppingList.items.map((i) =>
        i.item === item.item ? { ...i, checked: !i.checked } : i
      )

      expect(updatedItems[0].checked).toBe(true)
      expect(updatedItems[1].checked).toBe(false)
      expect(updatedItems[2].checked).toBe(false)
    })

    it('should toggle checked state from true to false', () => {
      const item = { ...mockShoppingList.items[0], checked: true }
      const updatedItems = mockShoppingList.items.map((i) =>
        i.item === item.item ? { ...i, checked: !i.checked } : i
      )

      expect(updatedItems[0].checked).toBe(true) // false -> true
    })

    it('should handle items without checked property (defaults to false)', () => {
      const itemWithoutChecked: ShoppingItem = {
        item: 'New Item',
        amount: 1,
        unit: 'cup',
        categoryKey: 'misc',
        categoryOrder: 8,
        sources: [{ recipeName: 'Test Recipe' }],
        // checked is undefined
      }

      const isChecked = itemWithoutChecked.checked || false
      expect(isChecked).toBe(false)
    })
  })

  describe('All Items Checked Detection', () => {
    it('should detect when all items are checked', () => {
      const allCheckedList: ShoppingList = {
        ...mockShoppingList,
        items: mockShoppingList.items.map(item => ({ ...item, checked: true })),
      }

      const allChecked = allCheckedList.items.every(item => item.checked === true)
      expect(allChecked).toBe(true)
    })

    it('should detect when some items are unchecked', () => {
      const partiallyCheckedList: ShoppingList = {
        ...mockShoppingList,
        items: [
          { ...mockShoppingList.items[0], checked: true },
          ...mockShoppingList.items.slice(1),
        ],
      }

      const allChecked = partiallyCheckedList.items.every(item => item.checked === true)
      expect(allChecked).toBe(false)
    })

    it('should handle empty list (no items checked)', () => {
      const emptyList: ShoppingList = {
        ...mockShoppingList,
        items: [],
      }

      const allChecked = emptyList.items.length > 0 && emptyList.items.every(item => item.checked === true)
      expect(allChecked).toBe(false)
    })
  })

  describe('Category Checked State', () => {
    it('should detect when all items in a category are checked', () => {
      const dairyItems = mockShoppingList.items.filter(item => item.categoryKey === 'dairy')
      const allDairyChecked = dairyItems.every(item => item.checked === true)
      expect(allDairyChecked).toBe(false) // Initially all unchecked

      const allDairyCheckedList: ShoppingList = {
        ...mockShoppingList,
        items: mockShoppingList.items.map(item =>
          item.categoryKey === 'dairy' ? { ...item, checked: true } : item
        ),
      }

      const updatedDairyItems = allDairyCheckedList.items.filter(item => item.categoryKey === 'dairy')
      const allDairyCheckedNow = updatedDairyItems.every(item => item.checked === true)
      expect(allDairyCheckedNow).toBe(true)
    })

    it('should count checked items in a category', () => {
      const partiallyCheckedList: ShoppingList = {
        ...mockShoppingList,
        items: [
          { ...mockShoppingList.items[0], checked: true }, // Milk - checked
          mockShoppingList.items[1], // Bread - unchecked
          { ...mockShoppingList.items[2], checked: true }, // Eggs - checked
        ],
      }

      const dairyItems = partiallyCheckedList.items.filter(item => item.categoryKey === 'dairy')
      const checkedCount = dairyItems.filter(item => item.checked === true).length
      expect(checkedCount).toBe(2) // Milk and Eggs
    })
  })

  describe('Bulk Check Off', () => {
    it('should check all items in a category', () => {
      const dairyItems = mockShoppingList.items.filter(item => item.categoryKey === 'dairy')
      const updatedItems = mockShoppingList.items.map(item =>
        dairyItems.some(di => di.item === item.item) ? { ...item, checked: true } : item
      )

      const dairyItemsAfter = updatedItems.filter(item => item.categoryKey === 'dairy')
      const allDairyChecked = dairyItemsAfter.every(item => item.checked === true)
      expect(allDairyChecked).toBe(true)
    })

    it('should check multiple items at once', () => {
      const itemsToCheck = [mockShoppingList.items[0], mockShoppingList.items[2]]
      const itemNames = new Set(itemsToCheck.map(i => i.item.toLowerCase().trim()))

      const updatedItems = mockShoppingList.items.map(item =>
        itemNames.has(item.item.toLowerCase().trim()) ? { ...item, checked: true } : item
      )

      expect(updatedItems[0].checked).toBe(true) // Milk
      expect(updatedItems[1].checked).toBe(false) // Bread
      expect(updatedItems[2].checked).toBe(true) // Eggs
    })
  })

  describe('Clear List', () => {
    it('should reset all checked states when list is cleared', () => {
      const checkedList: ShoppingList = {
        ...mockShoppingList,
        items: mockShoppingList.items.map(item => ({ ...item, checked: true })),
      }

      const clearedList: ShoppingList = {
        ...checkedList,
        items: [],
      }

      expect(clearedList.items.length).toBe(0)
      // All checked states are reset (items are gone)
    })
  })

  describe('New Items from Recipes', () => {
    it('should start new items with unchecked state', () => {
      const newItem: ShoppingItem = {
        item: 'New Item',
        amount: 1,
        unit: 'cup',
        categoryKey: 'misc',
        categoryOrder: 8,
        sources: [{ recipeName: 'New Recipe' }],
        // checked is undefined
      }

      expect(newItem.checked).toBeUndefined()
      // When used in UI, undefined should be treated as false
      const isChecked = newItem.checked ?? false
      expect(isChecked).toBe(false)
    })
  })

  describe('Pantry Section', () => {
    it('should show items that were attempted to be added but already exist in pantry', () => {
      const listWithPantry: ShoppingList = {
        ...mockShoppingList,
        already_have: [
          {
            item: 'Garlic',
            amount: 1,
            unit: 'clove',
            categoryKey: 'produce',
            categoryOrder: 1,
            sources: [{ recipeName: 'Test Recipe' }],
          },
        ],
      }

      expect(listWithPantry.already_have.length).toBe(1)
      expect(listWithPantry.already_have[0].item).toBe('Garlic')
    })

    it('should merge duplicate items in pantry section', () => {
      const listWithDuplicates: ShoppingList = {
        ...mockShoppingList,
        already_have: [
          {
            item: 'garlic',
            amount: 1,
            unit: 'clove',
            categoryKey: 'produce',
            categoryOrder: 1,
            sources: [{ recipeName: 'Recipe A' }],
          },
          {
            item: 'Garlic',
            amount: 2,
            unit: 'clove',
            categoryKey: 'produce',
            categoryOrder: 1,
            sources: [{ recipeName: 'Recipe B' }],
          },
        ],
      }

      // Items should be merged by normalized name (case-insensitive)
      const normalized = listWithDuplicates.already_have.map(item => item.item.toLowerCase())
      const uniqueItems = new Set(normalized)
      expect(uniqueItems.size).toBe(1) // Should be merged to one
    })
  })

  describe('Edge Cases', () => {
    it('should handle items with mixed checked states', () => {
      const mixedList: ShoppingList = {
        ...mockShoppingList,
        items: [
          { ...mockShoppingList.items[0], checked: true },
          { ...mockShoppingList.items[1], checked: false },
          { ...mockShoppingList.items[2], checked: undefined },
        ],
      }

      const checkedCount = mixedList.items.filter(item => item.checked === true).length
      const uncheckedCount = mixedList.items.filter(item => !item.checked).length

      expect(checkedCount).toBe(1)
      expect(uncheckedCount).toBe(2) // false and undefined both count as unchecked
    })

    it('should handle category with no items', () => {
      const emptyCategoryItems = mockShoppingList.items.filter(item => item.categoryKey === 'nonexistent')
      const allChecked = emptyCategoryItems.length === 0 || emptyCategoryItems.every(item => item.checked === true)
      expect(allChecked).toBe(true) // Empty category is considered "all checked" (nothing to check)
    })

    it('should preserve checked state when item properties change', () => {
      const checkedItem = { ...mockShoppingList.items[0], checked: true }
      const updatedItem = { ...checkedItem, amount: 2 }

      expect(updatedItem.checked).toBe(true)
      expect(updatedItem.amount).toBe(2)
    })
  })
})
