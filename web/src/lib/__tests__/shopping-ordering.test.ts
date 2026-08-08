import { describe, expect, it } from 'vitest'
import {
  learnIngredientOrder,
  orderShoppingRows,
  resolveShoppingCategoryOrder,
  type ShoppingOrderingCategory,
  type ShoppingOrderingRow,
} from '../shopping-ordering'

const categories: ShoppingOrderingCategory[] = [
  { key: 'produce', defaultOrder: 1, isCustom: false },
  { key: 'dairy', defaultOrder: 5, isCustom: false },
  { key: 'custom_bulk', defaultOrder: 10, isCustom: true },
]

function row(
  orderingKey: string,
  displayName = orderingKey,
  categoryKey = 'produce',
  suffix = ''
): ShoppingOrderingRow {
  return {
    rowRef: `derived:${orderingKey}${suffix}`,
    orderingKey,
    displayName,
    categoryKey,
  }
}

describe('shopping category ordering', () => {
  it('uses valid preferences, then built-ins, then custom categories', () => {
    const resolved = resolveShoppingCategoryOrder(categories, [
      'custom_bulk',
      'missing',
      'custom_bulk',
    ])
    expect(resolved.map((category) => category.key)).toEqual([
      'custom_bulk',
      'produce',
      'dairy',
    ])
  })
})

describe('shopping row ordering', () => {
  it('orders entirely unseen contents by normalized display name and row reference', () => {
    const result = orderShoppingRows(
      [
        row('zucchini', 'Zucchini'),
        row('apple-b', 'apples', 'produce', '-b'),
        row('apple-a', 'Apples', 'produce', '-a'),
      ],
      categories,
      [],
      {}
    )
    expect(result.map((item) => item.rowRef)).toEqual([
      'derived:apple-a-a',
      'derived:apple-b-b',
      'derived:zucchini',
    ])
  })

  it('orders an entirely learned category by ingredient identity', () => {
    const result = orderShoppingRows(
      [row('apple'), row('banana')],
      categories,
      [],
      { produce: ['banana', 'apple'] }
    )
    expect(result.map((item) => item.orderingKey)).toEqual(['banana', 'apple'])
  })

  it('puts known keys first and unseen keys in deterministic display order', () => {
    const input = [
      row('zucchini', 'Zucchini'),
      row('apple', 'Apple'),
      row('carrot', 'carrots'),
    ]
    const first = orderShoppingRows(input, categories, [], { produce: ['carrot'] })
    const second = orderShoppingRows([...input].reverse(), categories, [], {
      produce: ['carrot'],
    })
    expect(first.map((item) => item.orderingKey)).toEqual([
      'carrot',
      'apple',
      'zucchini',
    ])
    expect(second).toEqual(first)
  })

  it('keeps multiple aggregate rows for one ingredient adjacent', () => {
    const result = orderShoppingRows([
      row('milk', 'Milk bottle', 'dairy', '-bottle'),
      row('apple'),
      row('milk', 'Milk carton', 'dairy', '-carton'),
    ], categories, ['dairy', 'produce'], { dairy: ['milk'] })
    expect(result.map((item) => item.orderingKey)).toEqual([
      'milk',
      'milk',
      'apple',
    ])
    expect(result.slice(0, 2).map((item) => item.rowRef)).toEqual([
      'derived:milk-bottle',
      'derived:milk-carton',
    ])
  })

  it('keeps unseen duplicate identities adjacent by identity fallback', () => {
    const result = orderShoppingRows([
      row('milk', 'A milk bottle', 'dairy', '-bottle'),
      row('cream', 'Cream', 'dairy'),
      row('milk', 'Z milk carton', 'dairy', '-carton'),
    ], categories, ['dairy'], {})
    expect(result.map((item) => item.orderingKey)).toEqual([
      'milk',
      'milk',
      'cream',
    ])
  })

  it('groups learned and unseen duplicate identities deterministically', () => {
    const result = orderShoppingRows([
      row('cream', 'Cream tub', 'dairy', '-tub'),
      row('milk', 'Z milk carton', 'dairy', '-carton'),
      row('cream', 'Cream carton', 'dairy', '-carton'),
      row('milk', 'A milk bottle', 'dairy', '-bottle'),
    ], categories, ['dairy'], { dairy: ['cream'] })
    expect(result.map((item) => item.orderingKey)).toEqual([
      'cream',
      'cream',
      'milk',
      'milk',
    ])
  })

  it('groups manual and derived rows that share one purchase identity', () => {
    const result = orderShoppingRows([
      row('milk', 'Z milk carton', 'dairy', '-derived'),
      row('cream', 'Cream', 'dairy'),
      {
        ...row('milk', 'A milk bottle', 'dairy'),
        rowRef: 'manual:milk',
      },
    ], categories, ['dairy'], {})
    expect(result.map((item) => item.rowRef)).toEqual([
      'manual:milk',
      'derived:milk-derived',
      'derived:cream',
    ])
  })

  it('supports custom categories through the same resolver', () => {
    const result = orderShoppingRows([
      row('flour', 'Flour', 'custom_bulk'),
      row('apple'),
    ], categories, ['custom_bulk'], { custom_bulk: ['flour'] })
    expect(result.map((item) => item.categoryKey)).toEqual([
      'custom_bulk',
      'produce',
    ])
  })
})

describe('shopping order learning', () => {
  it('seeds unseen keys in rendered order and changes only the drop relation', () => {
    const before = learnIngredientOrder({
      existing: { produce: ['hidden-a', 'banana', 'hidden-b'] },
      visibleOrderingKeysByCategory: { produce: ['apple', 'banana', 'carrot'] },
      draggedOrderingKey: 'carrot',
      targetOrderingKey: 'banana',
      targetCategoryKey: 'produce',
      placement: 'before',
    })
    expect(before.produce).toEqual([
      'hidden-a',
      'apple',
      'carrot',
      'banana',
      'hidden-b',
    ])

    const after = learnIngredientOrder({
      existing: before,
      visibleOrderingKeysByCategory: { produce: ['carrot', 'banana', 'apple'] },
      draggedOrderingKey: 'carrot',
      targetOrderingKey: 'apple',
      targetCategoryKey: 'produce',
      placement: 'after',
    })
    expect(after.produce).toEqual([
      'hidden-a',
      'banana',
      'apple',
      'carrot',
      'hidden-b',
    ])
  })

  it('merges unseen keys before, between, and after known anchors', () => {
    const result = learnIngredientOrder({
      existing: {
        produce: ['hidden-a', 'banana', 'hidden-b', 'date', 'hidden-c'],
      },
      visibleOrderingKeysByCategory: {
        produce: ['apple', 'banana', 'carrot', 'date', 'elderberry'],
      },
      draggedOrderingKey: 'apple',
      targetOrderingKey: 'elderberry',
      targetCategoryKey: 'produce',
      placement: 'after',
    })
    expect(result.produce).toEqual([
      'hidden-a',
      'banana',
      'carrot',
      'date',
      'elderberry',
      'apple',
      'hidden-b',
      'hidden-c',
    ])
  })

  it('moves first and last repeatedly without duplicating keys', () => {
    const moved = learnIngredientOrder({
      existing: { produce: ['apple', 'banana', 'carrot'] },
      visibleOrderingKeysByCategory: { produce: ['apple', 'banana', 'carrot'] },
      draggedOrderingKey: 'apple',
      targetOrderingKey: 'carrot',
      targetCategoryKey: 'produce',
      placement: 'after',
    })
    const repeated = learnIngredientOrder({
      existing: moved,
      visibleOrderingKeysByCategory: { produce: ['banana', 'carrot', 'apple'] },
      draggedOrderingKey: 'apple',
      targetOrderingKey: 'banana',
      targetCategoryKey: 'produce',
      placement: 'before',
    })
    expect(repeated.produce).toEqual(['apple', 'banana', 'carrot'])
    expect(new Set(repeated.produce).size).toBe(repeated.produce.length)
  })

  it('preserves hidden-key order during a cross-category move', () => {
    const result = learnIngredientOrder({
      existing: {
        produce: ['hidden-a', 'apple', 'hidden-b'],
        dairy: ['hidden-c', 'milk'],
      },
      visibleOrderingKeysByCategory: {
        produce: ['apple'],
        dairy: ['milk'],
      },
      draggedOrderingKey: 'apple',
      targetOrderingKey: 'milk',
      targetCategoryKey: 'dairy',
      placement: 'before',
    })
    expect(result).toEqual({
      produce: ['hidden-a', 'hidden-b'],
      dairy: ['hidden-c', 'apple', 'milk'],
    })
  })
})
