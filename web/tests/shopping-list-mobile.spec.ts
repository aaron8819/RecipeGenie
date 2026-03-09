import { test, expect, VIEWPORTS } from './fixtures'
import type { Page } from '@playwright/test'
import {
  acquireShoppingSpecLock,
  buildShoppingItem,
  seedShoppingState,
} from './shopping-test-utils'

function rowById(page: Page, rowId: string) {
  return page.getByTestId(`shopping-row-${rowId}`)
}

async function openShoppingFromBottomNav(page: Page) {
  await page.locator('nav').last().getByRole('button', { name: /^shopping$/i }).click()
}

test.describe.configure({ mode: 'serial' })

test.describe('Shopping List Mobile @extended', () => {
  let releaseLock: (() => void) | null = null
  let cleanupState: (() => Promise<void>) | null = null

  test.use({ viewport: VIEWPORTS.mobile, hasTouch: true })

  test.beforeEach(async ({ page, setupAuth }) => {
    releaseLock = await acquireShoppingSpecLock()
    cleanupState = null
    await setupAuth()
    await openShoppingFromBottomNav(page)
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

  test('reaches Shopping from bottom nav reliably and shows seeded rows', async ({ page, navigateToTab }) => {
    const seed = `${Date.now()}-nav`
    const rowId = `row-mobile-nav-${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId,
          item: `mobile nav item ${seed}`,
          amount: 1,
          unit: 'bag',
        }),
      ],
    })
    await page.reload()

    await navigateToTab('recipes')
    await openShoppingFromBottomNav(page)

    await expect(page.getByRole('heading', { name: /shopping list/i })).toBeVisible()
    await expect(rowById(page, rowId)).toBeVisible()
    await expect(rowById(page, rowId)).toContainText(`mobile nav item ${seed}`)
  })

  test('expands mobile In Pantry and restores only the targeted row', async ({ page }) => {
    const seed = `${Date.now()}-pantry`
    const firstRowId = `row-mobile-pantry-a-${seed}`
    const secondRowId = `row-mobile-pantry-b-${seed}`

    cleanupState = await seedShoppingState({
      alreadyHave: [
        buildShoppingItem({
          rowId: firstRowId,
          item: `mobile pantry restore ${seed}`,
          amount: 1,
          unit: 'tsp',
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Mobile Pantry Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: secondRowId,
          item: `mobile pantry restore ${seed}`,
          amount: 2,
          unit: 'tsp',
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Mobile Pantry Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()
    await openShoppingFromBottomNav(page)

    const expandPantry = page.getByRole('button', { name: /^expand pantry items$/i })
    await expect(expandPantry).toBeVisible()
    await expandPantry.click()

    const firstRestore = page.getByRole('button', {
      name: new RegExp(`restore mobile pantry restore ${seed} 1 tsp in pantry`, 'i'),
    })
    const secondRestore = page.getByRole('button', {
      name: new RegExp(`restore mobile pantry restore ${seed} 2 tsp in pantry`, 'i'),
    })

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(rowById(page, firstRowId)).toBeVisible()
    await expect(rowById(page, secondRowId)).toHaveCount(0)
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })

  test('expands mobile Excluded and restores only the targeted row', async ({ page }) => {
    const seed = `${Date.now()}-excluded`
    const firstRowId = `row-mobile-excluded-a-${seed}`
    const secondRowId = `row-mobile-excluded-b-${seed}`
    const keyword = `mobile excluded keyword ${seed}`

    cleanupState = await seedShoppingState({
      excludedKeywords: [keyword],
      excluded: [
        buildShoppingItem({
          rowId: firstRowId,
          item: `mobile excluded restore ${seed}`,
          amount: 1,
          unit: 'jar',
          excludedBy: keyword,
          sources: [{ recipeId: `recipe-a-${seed}`, recipeName: `Mobile Excluded Recipe A ${seed}` }],
        }),
        buildShoppingItem({
          rowId: secondRowId,
          item: `mobile excluded restore ${seed}`,
          amount: 2,
          unit: 'jar',
          excludedBy: keyword,
          sources: [{ recipeId: `recipe-b-${seed}`, recipeName: `Mobile Excluded Recipe B ${seed}` }],
        }),
      ],
    })
    await page.reload()
    await openShoppingFromBottomNav(page)

    const expandExcluded = page.getByRole('button', { name: /^expand excluded items$/i })
    await expect(expandExcluded).toBeVisible()
    await expandExcluded.click()

    await expect(page.getByText(new RegExp(`Excluded: ${keyword}`, 'i')).first()).toBeVisible()

    const firstRestore = page.getByRole('button', {
      name: new RegExp(`restore mobile excluded restore ${seed} 1 jar excluded: ${keyword}`, 'i'),
    })
    const secondRestore = page.getByRole('button', {
      name: new RegExp(`restore mobile excluded restore ${seed} 2 jar excluded: ${keyword}`, 'i'),
    })

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(rowById(page, firstRowId)).toBeVisible()
    await expect(rowById(page, secondRowId)).toHaveCount(0)
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })
})
