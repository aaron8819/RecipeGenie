import { test, expect, VIEWPORTS } from './fixtures'
import type { Page } from '@playwright/test'
import { E2E_CONFIG } from './e2e-env'
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
    .getByRole('link', { name: /^shopping$/i })
    .evaluate((link: HTMLAnchorElement) => link.click())
}

async function activateBottomNavRoute(page: Page, routeName: RegExp) {
  await page
    .getByRole('navigation', { name: /bottom navigation/i })
    .getByRole('link', { name: routeName })
    .evaluate((link: HTMLAnchorElement) => link.click())
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

    await activateBottomNavRoute(page, /^shopping$/i)

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

async function readDocumentScrollState(page: Page) {
  return page.evaluate(() => {
    const scrollElement = document.scrollingElement ?? document.documentElement
    const before = window.scrollY
    window.scrollTo(0, Math.min(before + 120, scrollElement.scrollHeight - window.innerHeight))

    return {
      before,
      after: window.scrollY,
      clientHeight: window.innerHeight,
      scrollHeight: scrollElement.scrollHeight,
    }
  })
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

  test('reaches Shopping from bottom nav reliably and shows seeded rows', async ({ page, navigateToRoute }) => {
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

    await navigateToRoute('recipes')
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

  test('keeps active categories visible and reopens them for newly relevant content', async ({ page }) => {
    expect(E2E_CONFIG.target, 'Category-state writes require an explicitly non-production target').not.toBe('production')

    const seed = `${Date.now()}-category-state`
    const activeCategories = [
      { key: 'produce', order: 1, item: `apples ${seed}` },
      { key: 'deli', order: 2, item: `ham ${seed}` },
      { key: 'bakery', order: 3, item: `bread ${seed}` },
      { key: 'protein', order: 4, item: `chicken ${seed}` },
      { key: 'pantry', order: 6, item: `rice ${seed}` },
    ]

    cleanupState = await seedShoppingState({
      items: [
        ...activeCategories.map(({ key, order, item }, index) => buildShoppingItem({
          rowId: `row-category-state-${index}-${seed}`,
          item,
          categoryKey: key,
          categoryOrder: order,
        })),
        buildShoppingItem({
          rowId: `row-category-state-bakery-2-${seed}`,
          item: `rolls ${seed}`,
          categoryKey: 'bakery',
          categoryOrder: 3,
        }),
      ],
    })
    await page.reload()
    await ensureShoppingView(page)

    const categorySection = (key: string) => page.getByTestId(`shopping-category-${key}`)
    const categoryHeader = (key: string) => categorySection(key).locator('[role="button"][aria-expanded]').first()

    for (const { key } of activeCategories) {
      await expect(categoryHeader(key)).toHaveAttribute('aria-expanded', 'true')
    }

    await categorySection('pantry').getByRole('button', { name: 'Collapse category' }).click()
    await expect(categoryHeader('pantry')).toHaveAttribute('aria-expanded', 'false')

    const addedItemName = `black beans ${seed}`
    const addInput = page.locator('input[placeholder="Add milk, apples, basil..."]:visible')
    await addInput.fill(addedItemName)
    await addInput.locator('xpath=..').getByRole('button', { name: 'Add item' }).click()

    await expect(categoryHeader('pantry')).toHaveAttribute('aria-expanded', 'true')
    await expect(categorySection('pantry').getByText(addedItemName, { exact: false })).toBeVisible()

    await categorySection('bakery').getByRole('button', { name: /check all items in bakery/i }).click()
    await expect(categoryHeader('bakery')).toHaveAttribute('aria-expanded', 'false')

    await page.setViewportSize(VIEWPORTS.desktop)
    await page.reload()
    await ensureShoppingView(page)

    for (const key of ['produce', 'deli', 'protein', 'pantry']) {
      await expect(categoryHeader(key)).toHaveAttribute('aria-expanded', 'true')
    }
    await expect(categoryHeader('bakery')).toHaveAttribute('aria-expanded', 'false')
  })

  test('keeps document scrolling usable after section jumps and route switches', async ({ page }) => {
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

    const documentBefore = await readDocumentScrollState(page)
    expect(documentBefore).not.toBeNull()
    expect(documentBefore?.after).toBeGreaterThan(documentBefore?.before ?? 0)

    await page.getByRole('button', { name: /^jump to protein$/i }).click()
    await expect(rowById(page, proteinRowId)).toBeVisible()

    await page.getByRole('button', { name: /^jump to pantry$/i }).click()
    await expect(rowById(page, pantryRowId)).toBeVisible()

    const documentAfterJumps = await readDocumentScrollState(page)
    expect(documentAfterJumps).not.toBeNull()
    expect(documentAfterJumps?.after).toBeGreaterThan(documentAfterJumps?.before ?? 0)

    await activateBottomNavRoute(page, /^recipes$/i)
    await page.waitForTimeout(250)

    await activateBottomNavRoute(page, /^shopping$/i)
    await expect(rowById(page, pantryRowId)).toBeVisible()

    const documentAfterReturn = await readDocumentScrollState(page)
    expect(documentAfterReturn).not.toBeNull()
    expect(documentAfterReturn?.after).toBeGreaterThan(documentAfterReturn?.before ?? 0)
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
    await page.goto('/shopping')
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
    await activateBottomNavRoute(page, /^planner$/i)
    await expect(page.getByRole('button', { name: /today/i })).toBeVisible()

    await expect
      .poll(async () => readShellLockState(page))
      .toMatchObject({
        bodyPointerEvents: '',
        bodyScrollLocked: false,
        visibleMenuCount: 0,
      })

    const documentState = await readDocumentScrollState(page)
    expect(documentState).not.toBeNull()
    expect(documentState?.scrollHeight).toBeGreaterThanOrEqual(documentState?.clientHeight ?? 0)

    if (documentState && documentState.scrollHeight > documentState.clientHeight) {
      expect(documentState.after).toBeGreaterThan(documentState.before)
    } else {
      await expect(page.getByRole('link', { name: /^shopping$/i })).toBeVisible()
    }
  })
})
