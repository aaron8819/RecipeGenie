import { test, expect } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import {
  acquireShoppingSpecLock,
  buildShoppingItem,
  seedShoppingState,
} from './shopping-test-utils'

function rowById(page: Page, rowId: string): Locator {
  const rowRef = rowId.startsWith('manual:') ? rowId : `manual:${rowId}`
  return page.getByTestId(`shopping-row-${rowRef}`)
}

function requireRowId(rowId: string | undefined): string {
  if (!rowId) {
    throw new Error('Expected seeded shopping row to include a rowId')
  }
  return rowId
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

  test.beforeEach(async ({ setupAuth, navigateToRoute }) => {
    releaseLock = await acquireShoppingSpecLock()
    cleanupState = null
    await setupAuth()
    await navigateToRoute('shopping')
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
    const seededRow = buildShoppingItem({
      rowId: `row-mode-${seed}`,
      item: `mode protein ${seed}`,
      amount: 1,
      unit: 'lb',
      categoryKey: 'protein',
      categoryOrder: 4,
    })

    cleanupState = await seedShoppingState({ items: [seededRow] })
    await page.reload()
    const seededRowId = requireRowId(seededRow.rowId)

    const addInput = page.getByPlaceholder('Add tomatoes, milk...')
    const manualItemA = `manual apples ${seed}`
    const manualItemB = `manual pears ${seed}`

    await addInput.fill(`${manualItemA}, ${manualItemB}`)
    await page.keyboard.press('Enter')

    await expect(page.getByText(manualItemA, { exact: true })).toBeVisible()
    await expect(page.getByText(manualItemB, { exact: true })).toBeVisible()
    await expect(rowById(page, seededRowId)).toContainText(/added manually/i)
    await expect(page.getByText('Manage Mode', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /drag to reorder/i })).toHaveCount(0)

    await page.getByRole('button', { name: /organize/i }).click()
    const enterManageMode = page.getByRole('menuitem', { name: /enter manage mode/i })
    await expect(enterManageMode).toBeVisible()
    await enterManageMode.click({ force: true })

    await expect(page.getByText('Manage Mode', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /drag to reorder/i }).first()).toBeVisible()
    await expect(rowById(page, seededRowId)).toBeVisible()

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

    await firstRow.getByRole('button', { name: /item actions/i }).click()
    await page.getByRole('menuitem', { name: /remove from list/i }).click()

    await expect(firstRow).toHaveCount(0)
    await expect(secondRow).toBeVisible()
    await expect(secondRow).toContainText(/1 tbsp/i)
  })

  test('edits a manual shopping row inline without removing it first @core', async ({ page }) => {
    const seed = `${Date.now()}-edit`
    const rowId = `row-manual-edit-${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId,
          item: `manual garlic ${seed}`,
          amount: 1,
          unit: '',
          sources: [{ recipeName: 'Manual' }],
        }),
      ],
    })
    await page.reload()

    const row = rowById(page, rowId)
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: /item actions/i }).click()
    await page.getByRole('menuitem', { name: /edit item/i }).click()
    await expect(page.getByText(/edit manual item/i)).toBeVisible()

    await page.getByLabel('Manual item name').fill('eggs')
    await page.getByLabel('Manual item amount').fill('0.5')
    await page.getByLabel('Manual item unit').fill('lb')
    await page.getByRole('button', { name: /save changes/i }).click()

    await expect(page.getByText('eggs', { exact: true })).toBeVisible()
    await expect(row).toContainText(/lb/i)
    await expect(page.getByText(/edit manual item/i)).toHaveCount(0)

    await page.reload()
    await expect(page.getByText('eggs', { exact: true })).toBeVisible()
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

  test('restores only the targeted row from Excluded and keeps exact reasons visible @core', async ({ page }) => {
    const seed = `${Date.now()}-excluded`
    const firstItem = `excluded teaspoon ${seed}`
    const secondItem = `excluded tablespoon ${seed}`

    cleanupState = await seedShoppingState({
      excludedKeywords: [firstItem, secondItem],
      derivedItems: [
        buildShoppingItem({
          rowId: `row-excluded-tsp-${seed}`,
          item: firstItem,
          amount: 1,
          unit: 'tsp',
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Excluded Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: `row-excluded-tbsp-${seed}`,
          item: secondItem,
          amount: 1,
          unit: 'tbsp',
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Excluded Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()

    await expect(page.getByRole('heading', { name: /^excluded$/i })).toBeVisible()
    await expect(page.getByText(`Excluded: ${firstItem}`, { exact: true })).toBeVisible()
    await expect(page.getByText(`Excluded: ${secondItem}`, { exact: true })).toBeVisible()

    const firstRestore = restoreButton(page, firstItem, '1 tsp', `Excluded: ${firstItem}`)
    const secondRestore = restoreButton(page, secondItem, '1 tbsp', `Excluded: ${secondItem}`)

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(page.locator('[data-testid^="shopping-row-"]').filter({
      hasText: firstItem,
    })).toBeVisible()
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })
})
