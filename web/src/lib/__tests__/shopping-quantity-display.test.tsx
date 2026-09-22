import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures'
import type { Ingredient, ShoppingItem, ShoppingQuantity } from '@/types/database'
import { shoppingDocumentToList } from '@/hooks/shopping/use-shopping-document'
import { ShoppingItemRow, ShoppingRestoreChip } from '@/components/shopping/shopping-list-components'
import { createEmptyShoppingDocument, createShoppingRecipeEntry,
  applyShoppingDocumentMutation, validateShoppingDocumentV3 } from '../shopping-document'
import { parseQuantityV1 } from '../recipe-quantity'
import { normalizeIngredient } from '../recipe-data-validation'
import { formatShoppingItemAmount } from '../shopping-quantity-display'

afterEach(cleanup)
const scalar = (amount: number | null, unit = 'count'): ShoppingQuantity => ({ amount, unit })
const range: ShoppingQuantity = { amount: null, unit: 'count',
  exactQuantityV1: parseQuantityV1('1–2')!, exactAuthoredUnit: '' }
const item = (quantityParts: ShoppingQuantity[]): ShoppingItem => ({
  item: 'carrot', amount: quantityParts[0].amount, unit: quantityParts[0].unit,
  categoryKey: 'produce', categoryOrder: 1, quantityParts,
})
function documentFor(ingredients: Ingredient[], second?: Ingredient[]) {
  const document = createEmptyShoppingDocument()
  for (const [index, fixtureIngredients] of [ingredients, second].entries()) {
    if (!fixtureIngredients) continue
    for (const ingredient of fixtureIngredients) {
      expect(normalizeIngredient(ingredient, 'persist')).not.toBeNull()
    }
    const recipe = canonicalizeRecipeFixture({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      name: `Recipe ${index + 1}`, fixtureIngredients,
    })
    document.recipeEntries[recipe.id] = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' })
  }
  return document
}
function list(document: ReturnType<typeof documentFor>) {
  const reloaded = JSON.parse(JSON.stringify(document))
  expect(validateShoppingDocumentV3(reloaded).ok).toBe(true)
  return shoppingDocumentToList('owner', { document: reloaded, contentRevision: 0 })
}
const carrot: Ingredient = { item: 'carrot', amount: '1–2', unit: '', quantityV1: parseQuantityV1('1–2')! }

describe('lossless Shopping quantities from frozen evidence to rendered text', () => {
  it('renders two identical occurrences in one recipe, including repeated source details', () => {
    const document = documentFor([carrot, carrot])
    const before = JSON.stringify(document)
    const row = list(document).items[0]
    expect(formatShoppingItemAmount(row)).toBe('1–2 + 1–2')
    expect(row.sources).toHaveLength(2)
    render(<ShoppingItemRow item={row} isDesktop={false} sourceDisplay="summary"
      isCheckingOff={false} isRemoving={false} isAddingToPantry={false}
      recipeColorMap={new Map()} onCheckOff={vi.fn()} onAddToPantry={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
    fireEvent.click(screen.getByText('View sources'))
    const sourceParts = screen.getAllByText('1–2 carrot', { exact: true })
    expect(sourceParts).toHaveLength(2)
    sourceParts.forEach(part => expect(part).toBeVisible())
    expect(JSON.stringify(document)).toBe(before)
  })

  it('preserves ranges and recipe references across recipes without changing purchase grouping', () => {
    const rows = list(documentFor([carrot, carrot], [carrot])).items
    expect(rows.map(formatShoppingItemAmount)).toEqual(['1–2 + 1–2', '1–2'])
    expect(new Set(rows.flatMap(row => row.sources!.map(source => source.recipeId))).size).toBe(2)
  })

  it.each([
    [[range, scalar(2, 'g')], '1–2 + 2 g'],
    [[scalar(2, 'g'), range], '2 g + 1–2'],
    [[scalar(2), scalar(100, 'g'), scalar(1, 'cup')], '2 + 100 g + 1 cup'],
    [[scalar(0), scalar(null)], '0 + amount unspecified'],
    [[scalar(1, 'cup')], '1 cup'],
  ] as [ShoppingQuantity[], string][])('formats primary and all additional parts: %s', (parts, expected) => {
    const row = { ...item(parts), additionalAmounts: [{ amount: 99, unit: 'g' }], exactQuantityV1: range.exactQuantityV1 }
    expect(formatShoppingItemAmount(row)).toBe(expected)
  })

  it.each(['as needed', 'to taste', undefined])('keeps known plus missing amount (%s), in either order', modifier => {
    const known: Ingredient = { item: 'flour', amount: 2, unit: 'cup' }
    const unknown: Ingredient = { item: 'flour', amount: null, unit: '', modifier }
    for (const ingredients of [[known, unknown], [unknown, known]]) {
      const text = list(documentFor(ingredients)).items.map(formatShoppingItemAmount).join(' + ')
      expect(text).toContain('2 cup')
      expect(text).toContain(modifier ?? 'amount unspecified')
      if (!modifier) expect(text).not.toContain('as needed')
    }
  })

  it('retains persisted qualitative and unparsed wording', () => {
    for (const wording of ['as needed', 'a generous handful']) {
      expect(formatShoppingItemAmount(item([scalar(2, 'cup'), { amount: null, unit: '',
        exactQuantityV1: parseQuantityV1(wording),
      }]))).toBe(`2 cup + ${wording}`)
      const rows = list(documentFor([{ item: 'flour', amount: 2, unit: 'cup' },
        { item: 'flour', amount: null, unit: '', quantityV1: parseQuantityV1(wording) }])).items
      expect(rows.map(formatShoppingItemAmount)).toEqual([`2 cups + ${wording}`])
    }
  })

  it('preserves mixed structured/scalar persisted parts in either primary position', () => {
    for (const ingredients of [[carrot, { item: 'carrot', amount: 100, unit: 'g' }],
      [{ item: 'carrot', amount: 100, unit: 'g' }, carrot]]) {
      const document = documentFor(ingredients)
      // Existing frozen V3 keys are authoritative; do not regenerate them.
      const entries = Object.values(document.recipeEntries)[0].ingredients
      entries[1].aggregateKey = entries[0].aggregateKey
      const text = formatShoppingItemAmount(list(document).items[0])
      expect(text).toBe(ingredients[0] === carrot ? '1–2 + 100 g' : '100 g + 1–2')
    }
  })

  it('converts historical primary metadata once without the old early return', () => {
    const legacy = { ...item([range]), quantityParts: undefined,
      exactQuantityV1: range.exactQuantityV1, exactAuthoredUnit: '',
      additionalAmounts: [{ amount: 100, unit: 'g' }],
    }
    expect(formatShoppingItemAmount(legacy)).toBe('1–2 + 100 g')
  })

  it('retains repeated unspecified requirements in sources and copy without a main-row placeholder', () => {
    const unknown: Ingredient = { item: 'flour', amount: null, unit: '' }
    const row = list(documentFor([unknown, unknown])).items[0]
    render(<ShoppingItemRow item={row} isDesktop={true} sourceDisplay="tags"
      isCheckingOff={false} isRemoving={false} isAddingToPantry={false}
      recipeColorMap={new Map()} onCheckOff={vi.fn()} onAddToPantry={vi.fn()} onRemove={vi.fn()} />)
    expect(screen.queryByText('amount unspecified + amount unspecified', { exact: true })).not.toBeInTheDocument()
    expect(formatShoppingItemAmount(row)).toBe('amount unspecified + amount unspecified')
    fireEvent.click(screen.getByText('View sources'))
    const sourceParts = screen.getAllByText('amount unspecified flour', { exact: true })
    expect(sourceParts).toHaveLength(2)
    sourceParts.forEach(part => expect(part).toBeVisible())
  })

  it('keeps awkward exact range endpoints and package counts instead of rounding them again', () => {
    const quantity = parseQuantityV1('1/17–1/13')
    expect(formatShoppingItemAmount(item([{ amount: null, unit: 'cup',
      exactQuantityV1: quantity }]))).toBe('1/17–1/13 cup')
    const count = parseQuantityV1('1/17')
    expect(formatShoppingItemAmount(item([{ amount: 1 / 17, unit: 'can (14 oz)',
      exactQuantityV1: count, exactPackageV1: { version: 1, count, type: 'can', authoredType: 'can',
        size: { value: { numerator: '14', denominator: '1' }, lexeme: '14', unit: 'oz', authoredUnit: 'oz' } },
    }]))).toBe('1/17 × 14 oz can')
  })

  it('preserves repeated packages, differing sizes, and loose quantities', () => {
    const packageIngredient = (size: number): Ingredient => ({ item: 'beans', amount: 1, unit: `can (${size} oz)`,
      quantityV1: parseQuantityV1('1')!, authoredUnit: `can (${size} oz)`,
      packageV1: { version: 1, count: parseQuantityV1('1')!, type: 'can', authoredType: 'can',
        size: { value: { numerator: String(size), denominator: '1' }, lexeme: String(size), unit: 'oz', authoredUnit: 'oz' } },
    })
    const rows = list(documentFor([packageIngredient(14), packageIngredient(14), packageIngredient(28),
      { item: 'beans', amount: 100, unit: 'g' }])).items
    expect(rows.map(formatShoppingItemAmount).sort()).toEqual(['1 14 oz can + 1 14 oz can', '1 28 oz can', '100 g'].sort())
  })

  it('keeps exact fractional operands rather than inventing an exact aggregate', () => {
    const flour: Ingredient = { item: 'flour', amount: '1/3', unit: 'cup', quantityV1: parseQuantityV1('1/3')! }
    expect(list(documentFor([flour, flour])).items.map(formatShoppingItemAmount)).toEqual(['1/3 cup + 1/3 cup'])
    expect(formatShoppingItemAmount(item([{ amount: 1 / 17, unit: 'cup', exactQuantityV1: parseQuantityV1('1/17')! }]))).toBe('1/17 cup')
  })

  it('retains compatible unit conversion and rounds discrete scalars only after aggregation', () => {
    expect(list(documentFor([{ item: 'flour', amount: 1, unit: 'cup' },
      { item: 'flour', amount: 16, unit: 'tbsp' }])).items.map(formatShoppingItemAmount)).toEqual(['2 cup'])
    const onion: Ingredient = { item: 'onion', amount: 0.5, unit: 'count', quantityV1: parseQuantityV1('1/2')! }
    expect(list(documentFor([onion, onion, onion])).items.map(formatShoppingItemAmount)).toEqual(['2'])
    expect(list(documentFor([onion])).items.map(formatShoppingItemAmount)).toEqual(['1'])
    expect(list(documentFor([{ item: 'onion', amount: 2, unit: 'count' },
      { item: 'onion', amount: 100, unit: 'g' }])).items.map(formatShoppingItemAmount)).toEqual(['2 + 100 g'])
  })

  it('preserves zero versus missing across projection and incompatible units', () => {
    const rows = list(documentFor([{ item: 'flour', amount: 0, unit: 'cup' },
      { item: 'flour', amount: null, unit: '' }, { item: 'flour', amount: 100, unit: 'g' }])).items
    expect(rows.map(formatShoppingItemAmount)).toEqual(['0 cup + 100 g + amount unspecified'])
  })

  it('check/uncheck and reload retain requirements and frozen source JSON', () => {
    let state = { document: documentFor([carrot, carrot]), contentRevision: 0 }
    const snapshot = JSON.stringify(state.document.recipeEntries)
    const aggregateKey = Object.values(state.document.recipeEntries)[0].ingredients[0].aggregateKey
    for (const checked of [true, false]) {
      state = applyShoppingDocumentMutation(state, { type: 'setChecked', rowRef: `derived:${aggregateKey}`, checked })
      const row = list(state.document).items[0]
      expect(row.checked).toBe(checked)
      expect(formatShoppingItemAmount(row)).toBe('1–2 + 1–2')
      expect(JSON.stringify(state.document.recipeEntries)).toBe(snapshot)
    }
  })

  it.each(['already_have', 'excluded'] as const)('renders every requirement in %s', bucket => {
    const document = documentFor([carrot, carrot])
    const key = Object.values(document.recipeEntries)[0].ingredients[0].aggregateKey
    document.itemOverrides[key] = { bucket }
    const row = list(document)[bucket][0]
    render(<ShoppingRestoreChip item={row} reasonLabel={bucket} onRestore={vi.fn()}
      disabled={false} recipeColorMap={new Map()} />)
    expect(screen.getByText('1–2 + 1–2', { exact: true })).toBeVisible()
  })
})
