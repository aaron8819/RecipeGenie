import { test, expect } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import {
  acquireShoppingSpecLock,
  buildShoppingItem,
  seedShoppingState,
} from './shopping-test-utils'

function rowById(page: Page, rowId: string): Locator {
  return page.getByTestId(`shopping-row-${rowId}`)
}

function restoreButton(page: Page, itemName: string, amountLabel: string, reasonLabel: string): Locator {
  return page.getByRole('button', {
    name: new RegExp(`restore ${itemName} ${amountLabel} ${reasonLabel}`, 'i'),
  })
}

test.describe.configure({ mode: 'serial' })

test.describe('Shopping List', () => {
  let releaseLock: (() => void) | null = null
  let cleanupState: (() => Promise<void>) | null = null

  test.beforeEach(async ({ setupAuth, navigateToTab }) => {
    releaseLock = await acquireShoppingSpecLock()
    cleanupState = null
    await setupAuth()
    await navigateToTab('shopping')
  })

  test.afterEach(async () => {
    if (cleanupState) {
      await cleanupState()
      cleanupState = null
    }

    if (releaseLock) {
      releaseLock()
      releaseLock = null
    }
  })

  test('adds deterministic items and switches between Shopping Mode and Manage Mode with visible behavior changes @extended', async ({ page }) => {
    const seed = `${Date.now()}-mode`
    const recipeName = `Mode Recipe ${seed}`
    const seededRow = buildShoppingItem({
      rowId: `row-mode-${seed}`,
      item: `mode protein ${seed}`,
      amount: 1,
      unit: 'lb',
      categoryKey: 'protein',
      categoryOrder: 4,
      sources: [{ recipeId: `recipe-${seed}`, recipeName }],
    })

    cleanupState = await seedShoppingState({ items: [seededRow] })
    await page.reload()

    const addInput = page.getByPlaceholder('Add tomatoes, milk...')
    const manualItemA = `manual apples ${seed}`
    const manualItemB = `manual pears ${seed}`

    await addInput.fill(`${manualItemA}, ${manualItemB}`)
    await page.keyboard.press('Enter')

    await expect(page.getByText(manualItemA, { exact: true })).toBeVisible()
    await expect(page.getByText(manualItemB, { exact: true })).toBeVisible()
    await expect(rowById(page, seededRow.rowId)).toContainText(recipeName)
    await expect(page.getByText('Manage Mode', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)

    await page.getByRole('button', { name: /organize/i }).click()
    await page.getByRole('menuitem', { name: /enter manage mode/i }).click()

    await expect(page.getByText('Manage Mode', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i }).first()).toBeVisible()
    await expect(rowById(page, seededRow.rowId)).toBeVisible()

    await page.getByRole('button', { name: /^done$/i }).click()
    await expect(page.getByText('Manage Mode', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)
  })

  test('keeps duplicate-name active rows independently actionable by row identity @core', async ({ page }) => {
    const seed = `${Date.now()}-duplicate`
    const firstRowId = `row-duplicate-tsp-${seed}`
    const secondRowId = `row-duplicate-tbsp-${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId: firstRowId,
          item: `duplicate salt ${seed}`,
          amount: 1,
          unit: 'tsp',
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Duplicate Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: secondRowId,
          item: `duplicate salt ${seed}`,
          amount: 1,
          unit: 'tbsp',
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Duplicate Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()

    const firstRow = rowById(page, firstRowId)
    const secondRow = rowById(page, secondRowId)

    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()
    await expect(firstRow).toContainText(/1 tsp/i)
    await expect(secondRow).toContainText(/1 tbsp/i)

    await firstRow.hover()
    await firstRow.getByRole('button', { name: /remove from list/i }).click()

    await expect(firstRow).toHaveCount(0)
    await expect(secondRow).toBeVisible()
    await expect(secondRow).toContainText(/1 tbsp/i)
  })

  test('restores only the targeted duplicate row from In Pantry and keeps trust context visible @core', async ({ page }) => {
    const seed = `${Date.now()}-pantry`
    const firstRowId = `row-pantry-tsp-${seed}`
    const secondRowId = `row-pantry-tbsp-${seed}`

    cleanupState = await seedShoppingState({
      alreadyHave: [
        buildShoppingItem({
          rowId: firstRowId,
          item: `pantry salt ${seed}`,
          amount: 1,
          unit: 'tsp',
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Pantry Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: secondRowId,
          item: `pantry salt ${seed}`,
          amount: 1,
          unit: 'tbsp',
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Pantry Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()

    await expect(page.getByRole('heading', { name: /^in pantry$/i })).toBeVisible()

    const firstRestore = restoreButton(page, `pantry salt ${seed}`, '1 tsp', 'In pantry')
    const secondRestore = restoreButton(page, `pantry salt ${seed}`, '1 tbsp', 'In pantry')

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(rowById(page, firstRowId)).toBeVisible()
    await expect(rowById(page, secondRowId)).toHaveCount(0)
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })

  test('restores only the targeted duplicate row from Excluded and keeps exclusion reason visible @core', async ({ page }) => {
    const seed = `${Date.now()}-excluded`
    const firstRowId = `row-excluded-tsp-${seed}`
    const secondRowId = `row-excluded-tbsp-${seed}`
    const keyword = `exclude keyword ${seed}`

    cleanupState = await seedShoppingState({
      excludedKeywords: [keyword],
      excluded: [
        buildShoppingItem({
          rowId: firstRowId,
          item: `excluded salt ${seed}`,
          amount: 1,
          unit: 'tsp',
          excludedBy: keyword,
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Excluded Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: secondRowId,
          item: `excluded salt ${seed}`,
          amount: 1,
          unit: 'tbsp',
          excludedBy: keyword,
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Excluded Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()

    await expect(page.getByRole('heading', { name: /^excluded$/i })).toBeVisible()
    await expect(page.getByText(new RegExp(`Excluded: ${keyword}`, 'i')).first()).toBeVisible()

    const firstRestore = restoreButton(page, `excluded salt ${seed}`, '1 tsp', `Excluded: ${keyword}`)
    const secondRestore = restoreButton(page, `excluded salt ${seed}`, '1 tbsp', `Excluded: ${keyword}`)

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(rowById(page, firstRowId)).toBeVisible()
    await expect(rowById(page, secondRowId)).toHaveCount(0)
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })
})
