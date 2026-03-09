import { test, expect, VIEWPORTS } from './fixtures'

async function expectRecipesView(page: import('@playwright/test').Page) {
  await expect(page.getByRole('textbox', { name: /search recipes by name or category/i })).toBeVisible()
}

async function expectPlannerView(page: import('@playwright/test').Page) {
  const desktopPlannerMarker = page.getByText(/quick meal mix/i)
  if (await desktopPlannerMarker.isVisible().catch(() => false)) {
    await expect(desktopPlannerMarker).toBeVisible()
    return
  }

  await expect(page.getByRole('button', { name: /today/i })).toBeVisible()
}

async function expectShoppingView(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Shopping List' }).first()).toBeVisible()
}

async function expectPantryView(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Pantry', exact: true })).toBeVisible()
}

async function dismissNextDevTools(page: import('@playwright/test').Page) {
  const closeButton = page.getByRole('button', { name: /close next\.js dev tools/i })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true })
  }
}

async function activateBottomNavTab(
  page: import('@playwright/test').Page,
  tabName: RegExp
) {
  const button = page.getByRole('navigation', { name: /bottom navigation/i }).getByRole('button', { name: tabName })
  await button.dispatchEvent('click')
}

test.describe('Navigation', () => {
  test('shows stable shell navigation on desktop @extended', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    await expect(page.getByRole('button', { name: /go to planner/i })).toBeVisible()
    const headerNav = page.locator('header').getByRole('navigation')
    await expect(headerNav.getByRole('button', { name: 'Planner', exact: true })).toBeVisible()
    await expect(headerNav.getByRole('button', { name: 'Recipes', exact: true })).toBeVisible()
    await expect(headerNav.getByRole('button', { name: 'Shopping', exact: true })).toBeVisible()
    await expect(headerNav.getByRole('button', { name: 'Pantry', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /help/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
    await expect(page.getByRole('navigation', { name: /bottom navigation/i })).toHaveCount(0)
  })

  test('shows usable bottom navigation on mobile @extended', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()

    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })
    await expect(bottomNav).toBeVisible()
    await dismissNextDevTools(page)

    await activateBottomNavTab(page, /planner/i)
    await expectPlannerView(page)

    await activateBottomNavTab(page, /shopping/i)
    await expectShoppingView(page)

    await activateBottomNavTab(page, /pantry/i)
    await expectPantryView(page)

    await activateBottomNavTab(page, /recipes/i)
    await expectRecipesView(page)
  })

  test('keeps visited tabs mounted after first visit @core', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    await expect(page.getByPlaceholder('Add tomatoes, milk...')).toHaveCount(0)
    await expect(page.getByPlaceholder(/add pantry item \(comma-separated\)/i)).toHaveCount(0)

    await navigateToTab('shopping')
    await expectShoppingView(page)

    await navigateToTab('pantry')
    await expectPantryView(page)

    await navigateToTab('recipes')
    await expectRecipesView(page)

    await expect(page.getByPlaceholder('Add tomatoes, milk...')).toHaveCount(1)
    await expect(page.getByPlaceholder(/add pantry item \(comma-separated\)/i)).toHaveCount(1)
  })

  test('preserves recipes search context across tab switches @extended', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    const searchInput = page.getByRole('textbox', { name: /search recipes by name or category/i })
    await searchInput.fill('chicken')
    await expect(searchInput).toHaveValue('chicken')

    await navigateToTab('planner')
    await expectPlannerView(page)

    await navigateToTab('recipes')
    await expectRecipesView(page)
    await expect(searchInput).toHaveValue('chicken')
  })

  test('restores the user-selected tab after reload @core', async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('shopping')
    await expectShoppingView(page)

    await page.reload()
    await expectShoppingView(page)
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('recipe-genie-active-tab')))
      .toBe('shopping')
  })
})
