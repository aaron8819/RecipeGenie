import { test, expect, VIEWPORTS } from './fixtures'

const routes = ['recipes', 'planner', 'shopping', 'pantry'] as const

async function dismissNextDevTools(page: import('@playwright/test').Page) {
  const closeButton = page.getByRole('button', { name: /close next\.js dev tools/i })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true })
  }
}

test.describe('Navigation', () => {
  test('shows normal pathname-aware links on desktop @extended', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    await expect(page).toHaveURL(/\/recipes$/)
    await expect(page.getByRole('link', { name: /go to planner/i })).toBeVisible()
    const headerNav = page.locator('header').getByRole('navigation')

    for (const route of routes) {
      const label = route[0].toUpperCase() + route.slice(1)
      const link = headerNav.getByRole('link', { name: label, exact: true })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', `/${route}`)
    }

    await expect(headerNav.getByRole('link', { name: 'Recipes', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByRole('button', { name: /help/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
    await expect(page.getByRole('navigation', { name: /bottom navigation/i })).toHaveCount(0)
  })

  test('navigates all mobile routes with one active link and one screen @extended', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await dismissNextDevTools(page)

    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })
    await expect(bottomNav).toBeVisible()

    for (const route of routes) {
      await navigateToRoute(route)
      await expect(bottomNav.locator('a[aria-current="page"]')).toHaveCount(1)
      await expect(page.locator('[data-app-screen]')).toHaveCount(1)
      await expect(page.locator('[data-app-screen]')).toHaveAttribute('data-app-screen', route)
    }
  })

  test('unmounts the previous domain screen after route navigation @core', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    await navigateToRoute('shopping')
    await expect(page.getByRole('heading', { name: 'Shopping List' }).first()).toBeVisible()
    await expect(page.getByRole('textbox', { name: /search recipes/i })).toHaveCount(0)

    await navigateToRoute('pantry')
    await expect(page.getByRole('heading', { name: 'Pantry', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shopping List' })).toHaveCount(0)

    await navigateToRoute('recipes')
    await expect(page.getByRole('textbox', { name: /search recipes/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pantry', exact: true })).toHaveCount(0)
  })

  test('uses browser Back and Forward to restore route-owned recipe state @extended', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    const searchInput = page.getByRole('textbox', { name: /search recipes by name or category/i })
    await searchInput.fill('chicken')
    await expect(page).toHaveURL(/\/recipes\?q=chicken$/)

    await navigateToRoute('planner')
    await page.goBack()
    await expect(page).toHaveURL(/\/recipes\?q=chicken$/)
    await expect(page.getByRole('textbox', { name: /search recipes/i })).toHaveValue('chicken')

    await page.goForward()
    await expect(page).toHaveURL(/\/planner$/)
    await expect(page.locator('[data-app-screen="planner"]')).toHaveCount(1)
  })

  test('reload stays on the current route and legacy tab storage is inert @core', async ({
    page,
    setupAuth,
    navigateToRoute,
  }) => {
    await setupAuth()
    await navigateToRoute('shopping')
    await page.evaluate(() => localStorage.setItem('recipe-genie-active-tab', 'planner'))

    await page.reload()

    await expect(page).toHaveURL(/\/shopping$/)
    await expect(page.locator('[data-app-screen="shopping"]')).toHaveCount(1)
    await expect(page.locator('[data-app-screen="planner"]')).toHaveCount(0)
  })

  for (const route of routes) {
    test(`opens /${route} directly @extended`, async ({ page, waitForAppLoad }) => {
      await page.goto(`/${route}`)
      await waitForAppLoad()
      await expect(page).toHaveURL(new RegExp(`/${route}$`))
      await expect(page.locator(`[data-app-screen="${route}"]`)).toHaveCount(1)
    })
  }
})
