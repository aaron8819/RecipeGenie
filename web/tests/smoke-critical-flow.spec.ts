import { test, expect, VIEWPORTS } from './fixtures'
import { assertRecipeGenieAppShell } from './e2e-env'

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

async function activateBottomNavRoute(
  page: import('@playwright/test').Page,
  routeName: RegExp
) {
  const link = page.getByRole('navigation', { name: /bottom navigation/i }).getByRole('link', { name: routeName })
  await link.dispatchEvent('click')
}

test.describe('Smoke Baseline', () => {
  test.describe('Unauthenticated entry', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('shows the Recipe Genie sign-in screen when unauthenticated @core @smoke', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByRole('heading', { name: 'Recipe Genie' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
    })
  })

  test.describe('Authenticated shell', () => {
    test('loads isolated auth state and reaches the Recipe Genie shell deterministically @core @smoke', async ({ page, setupAuth }) => {
      await setupAuth()
      await assertRecipeGenieAppShell(page)
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
      await expectRecipesView(page)
    })
  })

  test('redirects the authenticated app root to Recipes @extended @smoke', async ({ page, setupAuth }) => {
    await setupAuth()
    await page.goto('/')

    await assertRecipeGenieAppShell(page)
    await expect(page.getByRole('button', { name: /help/i })).toBeVisible()
    await expectRecipesView(page)
    await expect(page).toHaveURL(/\/recipes$/)
  })

  test('switches routes through the mobile bottom navigation @extended @smoke', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()

    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })
    await expect(bottomNav).toBeVisible()
    await dismissNextDevTools(page)

    await activateBottomNavRoute(page, /planner/i)
    await expectPlannerView(page)

    await activateBottomNavRoute(page, /shopping/i)
    await expectShoppingView(page)

    await activateBottomNavRoute(page, /pantry/i)
    await expectPantryView(page)
  })

  test('keeps the active route across reloads @extended @smoke', async ({ page, setupAuth, navigateToRoute }) => {
    await setupAuth()
    await navigateToRoute('shopping')
    await expectShoppingView(page)

    await page.reload()
    await expectShoppingView(page)
    await expect(page).toHaveURL(/\/shopping$/)
    await expect(page.locator('[data-app-screen="shopping"]')).toHaveCount(1)
  })
})
