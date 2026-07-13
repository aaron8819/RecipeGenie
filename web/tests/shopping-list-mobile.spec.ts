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
  await page
    .getByRole('navigation', { name: /bottom navigation/i })
    .getByRole('button', { name: /^shopping$/i })
    .evaluate((button: HTMLButtonElement) => button.click())
}

async function activateBottomNavTab(page: Page, tabName: RegExp) {
  await page
    .getByRole('navigation', { name: /bottom navigation/i })
    .getByRole('button', { name: tabName })
    .evaluate((button: HTMLButtonElement) => button.click())
}

async function dismissNextDevTools(page: Page) {
  const closeButton = page.getByRole('button', { name: /close next\.js dev tools/i })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true })
  }
}

async function ensureShoppingView(page: Page) {
  const heading = page.getByRole('heading', { name: /shopping list/i })
  await page.getByRole('navigation', { name: /bottom navigation/i }).waitFor()
  await dismissNextDevTools(page)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await heading.isVisible().catch(() => false)) {
      return
    }

    await activateBottomNavTab(page, /^shopping$/i)

    await page.waitForTimeout(250)
  }

  await expect(heading).toBeVisible()
}

async function readShellLockState(page: Page) {
  return page.evaluate(() => ({
    bodyPointerEvents: document.body.style.pointerEvents,
    bodyScrollLocked: document.body.hasAttribute('data-scroll-locked'),
    bodyOverflow: document.body.style.overflow,
    documentOverflow: document.documentElement.style.overflow,
    visibleMenuCount: document.querySelectorAll('[role="menu"]').length,
  }))
}

async function readActivePaneState(page: Page) {
  return page.evaluate(() => {
    const activePane = Array.from(document.querySelectorAll('main .container > div[aria-hidden="false"]'))
      .find((element) => getComputedStyle(element).overflowY === 'auto') as HTMLDivElement | undefined

    if (!activePane) {
      return null
    }

    const before = activePane.scrollTop
    activePane.scrollTop = before + 120

    return {
      before,
      after: activePane.scrollTop,
      clientHeight: activePane.clientHeight,
      scrollHeight: activePane.scrollHeight,
      overflowY: getComputedStyle(activePane).overflowY,
    }
  })
}

async function persistHomeTab(page: Page, tab: 'planner' | 'recipes' | 'shopping' | 'pantry') {
  await page.context().addCookies([
    {
      name: 'recipe-genie-active-tab',
      value: tab,
      url: page.url(),
    },
  ])

  await page.addInitScript((nextTab) => {
    window.localStorage.setItem('recipe-genie-active-tab', nextTab)
  }, tab)

  await page.evaluate((nextTab) => {
    window.localStorage.setItem('recipe-genie-active-tab', nextTab)
    document.cookie = `recipe-genie-active-tab=${encodeURIComponent(nextTab)}; Path=/; Max-Age=31536000; SameSite=Lax`
  }, tab)
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
      name: new RegExp(`restore mobile excluded restore ${seed} 2 jars? excluded: ${keyword}`, 'i'),
    })

    await expect(firstRestore).toBeVisible()
    await expect(secondRestore).toBeVisible()

    await firstRestore.click()

    await expect(rowById(page, firstRowId)).toBeVisible()
    await expect(rowById(page, secondRowId)).toHaveCount(0)
    await expect(firstRestore).toHaveCount(0)
    await expect(secondRestore).toBeVisible()
  })

  test('keeps long mobile lists focused with progress controls and active-section jumps', async ({ page }) => {
    const seed = `${Date.now()}-long-list`
    const produceRowId = `row-mobile-produce-${seed}`
    const produceDoneRowId = `row-mobile-produce-done-${seed}`
    const dairyDoneRowId = `row-mobile-dairy-done-${seed}`
    const pantryRowId = `row-mobile-pantry-${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId: produceRowId,
          item: `mobile apples ${seed}`,
          checked: false,
          categoryKey: 'produce',
          categoryOrder: 1,
        }),
        buildShoppingItem({
          rowId: produceDoneRowId,
          item: `mobile bananas ${seed}`,
          checked: true,
          categoryKey: 'produce',
          categoryOrder: 1,
        }),
        buildShoppingItem({
          rowId: dairyDoneRowId,
          item: `mobile milk ${seed}`,
          checked: true,
          categoryKey: 'dairy',
          categoryOrder: 5,
        }),
        buildShoppingItem({
          rowId: pantryRowId,
          item: `mobile rice ${seed}`,
          checked: false,
          categoryKey: 'pantry',
          categoryOrder: 6,
        }),
      ],
    })
    await page.reload()
    await openShoppingFromBottomNav(page)

    await expect(page.getByTestId('shopping-progress-summary')).toBeVisible()
    await expect(page.getByText(/^Progress$/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^jump to pantry$/i })).toBeVisible()

    await page.getByRole('button', { name: /^hide \d+ done$/i }).click()

    await expect(rowById(page, produceDoneRowId)).toHaveCount(0)
    await expect(rowById(page, dairyDoneRowId)).toHaveCount(0)

    await page.getByRole('button', { name: /^jump to pantry$/i }).click()

    await expect(rowById(page, pantryRowId)).toBeVisible()
    await expect(rowById(page, produceRowId)).toBeVisible()
  })

  test('keeps the active Shopping pane scrollable after repeated section jumps and tab switches', async ({ page }) => {
    const seed = `${Date.now()}-jump-stability`
    const produceRowId = `row-mobile-produce-${seed}`
    const proteinRowId = `row-mobile-protein-${seed}`
    const pantryRowId = `row-mobile-pantry-${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId: produceRowId,
          item: `mobile apples ${seed}`,
          checked: false,
          categoryKey: 'produce',
          categoryOrder: 1,
        }),
        buildShoppingItem({
          rowId: proteinRowId,
          item: `mobile chicken ${seed}`,
          checked: false,
          categoryKey: 'protein',
          categoryOrder: 4,
        }),
        buildShoppingItem({
          rowId: pantryRowId,
          item: `mobile rice ${seed}`,
          checked: false,
          categoryKey: 'pantry',
          categoryOrder: 6,
        }),
      ],
    })
    await page.reload()
    await openShoppingFromBottomNav(page)

    await expect(page.getByRole('button', { name: /^jump to protein$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^jump to pantry$/i })).toBeVisible()

    const paneBefore = await readActivePaneState(page)
    expect(paneBefore).not.toBeNull()
    expect(paneBefore?.after).toBeGreaterThan(paneBefore?.before ?? 0)

    await page.getByRole('button', { name: /^jump to protein$/i }).click()
    await expect(rowById(page, proteinRowId)).toBeVisible()

    await page.getByRole('button', { name: /^jump to pantry$/i }).click()
    await expect(rowById(page, pantryRowId)).toBeVisible()

    const paneAfterJumps = await readActivePaneState(page)
    expect(paneAfterJumps).not.toBeNull()
    expect(paneAfterJumps?.after).toBeGreaterThan(paneAfterJumps?.before ?? 0)

    await activateBottomNavTab(page, /^recipes$/i)
    await page.waitForTimeout(250)

    await activateBottomNavTab(page, /^shopping$/i)
    await expect(rowById(page, pantryRowId)).toBeVisible()

    const paneAfterReturn = await readActivePaneState(page)
    expect(paneAfterReturn).not.toBeNull()
    expect(paneAfterReturn?.after).toBeGreaterThan(paneAfterReturn?.before ?? 0)
  })

  test('releases Shopping action-menu locks before switching to Planner on mobile @extended', async ({ page }) => {
    const seed = `${Date.now()}-menu-lock`
    const rowId = `row-mobile-menu-lock-${seed}`
    const itemName = `mobile menu lock item ${seed}`

    cleanupState = await seedShoppingState({
      items: [
        buildShoppingItem({
          rowId,
          item: itemName,
          amount: 1,
          unit: 'bottle',
          categoryKey: 'pantry',
          categoryOrder: 6,
        }),
      ],
    })
    await persistHomeTab(page, 'shopping')
    await page.goto('/')
    await ensureShoppingView(page)

    const row = rowById(page, rowId)
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: /item actions/i }).click()
    await expect(page.getByRole('menuitem', { name: /remove from list/i })).toBeVisible()
    await page.getByRole('menuitem', { name: /remove from list/i }).click()

    await expect(row).toHaveCount(0)

    await expect
      .poll(async () => readShellLockState(page))
      .toMatchObject({
        bodyPointerEvents: '',
        bodyScrollLocked: false,
        visibleMenuCount: 0,
      })

    await dismissNextDevTools(page)
    await activateBottomNavTab(page, /^planner$/i)
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible()

    await expect
      .poll(async () => readShellLockState(page))
      .toMatchObject({
        bodyPointerEvents: '',
        bodyScrollLocked: false,
        visibleMenuCount: 0,
      })

    const paneState = await readActivePaneState(page)
    expect(paneState).not.toBeNull()
    expect(paneState?.overflowY).toBe('auto')
    expect(paneState?.scrollHeight).toBeGreaterThanOrEqual(paneState?.clientHeight ?? 0)

    if (paneState && paneState.scrollHeight > paneState.clientHeight) {
      expect(paneState.after).toBeGreaterThan(paneState.before)
    } else {
      await expect(page.getByRole('button', { name: /^shopping$/i })).toBeVisible()
    }
  })
})
