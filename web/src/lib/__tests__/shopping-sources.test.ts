import { describe, expect, it } from 'vitest'
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures'
import { createEmptyShoppingDocument, createShoppingRecipeEntry, applyShoppingDocumentMutation,
  projectShoppingDocument } from '../shopping-document'
import { shoppingRecipeSelections, shoppingSourceControls } from '../shopping-sources'
import { shoppingDocumentToList } from '@/hooks/shopping/use-shopping-document'
import { buildCategoryViewModel, deriveOrderedCategories, groupItemsByCategory } from '@/components/shopping/shopping-list.selectors'
import { parseQuantityV1 } from '../recipe-quantity'

function fixture() {
  const document = createEmptyShoppingDocument()
  for (let index = 1; index <= 6; index++) {
    const recipe = canonicalizeRecipeFixture({ id: `10000000-0000-4000-8000-00000000000${index}`,
      name: index < 3 ? 'Soup' : index === 3 ? 'Manual' : `Hidden ${index}`,
      fixtureIngredients: index === 6 ? [] : [{ item: index < 3 ? 'carrot' : `ingredient ${index}`, amount: '1–2',
        unit: '', quantityV1: parseQuantityV1('1–2')! }] })
    const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' })
    if (index === 1) entry.ingredients.push(structuredClone(entry.ingredients[0]))
    document.recipeEntries[recipe.id] = entry
  }
  return document
}

describe('Shopping sources and category visibility', () => {
  it('keeps duplicate titles and Manual distinct, and retains all quantity occurrences', () => {
    const document = fixture()
    const list = shoppingDocumentToList('owner', { document, contentRevision: 1 })
    const selections = shoppingRecipeSelections(document.recipeEntries)
    expect(selections.filter(entry => entry.recipeName === 'Soup').map(entry => entry.label)).toEqual(['Soup (1)', 'Soup (2)'])
    expect(selections.find(entry => entry.recipeName === 'Manual')?.recipeId).toBe('10000000-0000-4000-8000-000000000003')
    const carrots = list.items.filter(item => item.item === 'carrot')
    expect(carrots.flatMap(item => item.sources ?? [])).toHaveLength(3)
    expect(carrots.flatMap(item => item.quantityParts ?? [])).toHaveLength(3)
    expect(shoppingSourceControls({ ...carrots[0], sources: carrots.flatMap(item => item.sources ?? []) })).toHaveLength(2)
    const missing = { ...carrots[0], sources: [{ recipeName: 'Soup' }, { recipeName: 'Soup' }] }
    expect(shoppingSourceControls(missing)).toHaveLength(2)
  })

  it('lists all-hidden, excluded, completed and empty selections; removal preserves unrelated evidence', () => {
    const document = fixture()
    const entries = Object.values(document.recipeEntries)
    document.preferences.excludedIngredientKeys = ['ingredient 4']
    document.preferences.categoryByIngredient = { carrot: 'unknown-category' }
    document.preferences.ingredientOrderByCategory = { produce: ['carrot'] }
    const rows = projectShoppingDocument(document).rows
    document.itemOverrides[rows.find(row => row.sources.some(source => source.recipeId === entries[2].recipeId))!.aggregateKey!] = { suppressed: true }
    document.itemOverrides[rows.find(row => row.sources.some(source => source.recipeId === entries[4].recipeId))!.aggregateKey!] = { checked: true }
    document.manualItems.push({ id: '20000000-0000-4000-8000-000000000001', displayName: 'bread',
      quantity: { amount: 2, unit: '' }, categoryKey: 'bakery', bucket: 'items', checked: false })
    const pantry = [{ id: 'pantry', user_id: 'owner', item: 'carrot', created_at: '' }]
    expect(shoppingRecipeSelections(document.recipeEntries)).toHaveLength(6)
    expect(projectShoppingDocument(document, pantry).alreadyHave.length).toBeGreaterThan(0)
    const before = structuredClone(document)
    const after = applyShoppingDocumentMutation({ document, contentRevision: 0 }, { type: 'removeRecipe', recipeId: entries[0].recipeId }).document
    expect(after.recipeEntries[entries[0].recipeId]).toBeUndefined()
    for (const entry of entries.slice(1)) expect(after.recipeEntries[entry.recipeId]).toEqual(entry)
    expect(after.manualItems).toEqual(before.manualItems)
    expect(after.preferences).toEqual(before.preferences)
    expect(document).toEqual(before)
  })

  it('renders unknown active/completed categories exactly once without modifying references', () => {
    const document = fixture()
    const list = shoppingDocumentToList('owner', { document, contentRevision: 0 })
    const items = list.items.map((item, index) => ({ ...item,
      categoryKey: index < 2 ? `missing-${index}` : 'produce', checked: index === 1 }))
    const before = structuredClone(items)
    const views = buildCategoryViewModel(groupItemsByCategory(items), deriveOrderedCategories({ customCategories: [], categoryOrder: null }))
    expect(views.map(view => view.name)).toContain('Other items — category unavailable')
    expect(views.flatMap(view => view.items)).toHaveLength(items.length)
    expect(new Set(views.flatMap(view => view.items.map(item => item.rowId))).size).toBe(items.length)
    expect(views.at(-1)?.checkedCount).toBe(1)
    expect(items).toEqual(before)
  })
  it('allows an explicit move out of an unknown category by the original row identity', () => {
    const document = fixture()
    document.manualItems = [{ id: '20000000-0000-4000-8000-000000000001', displayName: 'bread',
      quantity: { amount: 2, unit: '' }, categoryKey: 'unknown', bucket: 'items', checked: false }]
    const rows = projectShoppingDocument(document).items
    const dragged = rows.find(row => row.manualId)!
    const target = rows.find(row => !row.manualId)!
    const moved = applyShoppingDocumentMutation({ document, contentRevision: 0 }, {
      type: 'learnOrder', draggedRowRef: dragged.rowRef, draggedOrderingKey: dragged.orderingKey,
      sourceCategoryKey: dragged.categoryKey, targetRowRef: target.rowRef,
      targetOrderingKey: target.orderingKey, targetCategoryKey: target.categoryKey, placement: 'after',
    }).document
    expect(moved.manualItems[0].categoryKey).toBe(target.categoryKey)
    expect(moved.manualItems[0].id).toBe(dragged.manualId)
    expect(moved.manualItems[0].quantity).toEqual(document.manualItems[0].quantity)
    expect(moved.recipeEntries).toEqual(document.recipeEntries)
    expect(document.manualItems[0].categoryKey).toBe('unknown')
  })

})
