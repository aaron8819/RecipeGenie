import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

async function expectHealthyPage(page: Page) {
  await expect(
    page.locator('[data-nextjs-dialog], .vite-error-overlay')
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
  ).toBeLessThanOrEqual(1)
  expect(
    await page.locator('img').evaluateAll((images) =>
      images
        .filter((image) => image instanceof HTMLImageElement)
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute('src'))
    )
  ).toEqual([])
}

test.describe('Recipe Genie branding', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wires the install and browser icon assets', async ({ page }) => {
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.json'
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png'
    )

    const iconHrefs = await page
      .locator('link[rel="icon"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    expect(iconHrefs).toEqual(
      expect.arrayContaining(['/favicon-32x32.png', '/favicon.ico'])
    )

    const manifestResponse = await page.request.get('/manifest.json')
    expect(manifestResponse.ok()).toBe(true)
    await expect(manifestResponse.json()).resolves.toMatchObject({
      background_color: '#F7F3EA',
      theme_color: '#2F4B34',
      icons: [
        {
          src: '/pwa-icon-192.png',
          sizes: '192x192',
          purpose: 'any maskable',
        },
        {
          src: '/pwa-icon-512.png',
          sizes: '512x512',
          purpose: 'any maskable',
        },
      ],
    })

    for (const asset of [
      '/favicon-32x32.png',
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/pwa-icon-192.png',
      '/pwa-icon-512.png',
    ]) {
      expect((await page.request.get(asset)).ok()).toBe(true)
    }
  })
})

test.describe('responsive authenticated shell', () => {
  test('preserves shell ownership across desktop and mobile', async ({
    page,
    setupAuth,
  }, testInfo) => {
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))

    await page.setViewportSize({ width: 1440, height: 900 })
    await setupAuth()

    const sidebar = page.getByRole('complementary', {
      name: 'Recipe Genie desktop navigation',
    })
    const desktopWidths = [1600, 1440, 1280, 1024]

    for (const width of desktopWidths) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/recipes', { waitUntil: 'domcontentloaded' })
      await expect(sidebar).toBeVisible()
      await expect(sidebar).toHaveCSS('width', '256px')
      await expect(
        page.getByRole('navigation', { name: 'Bottom navigation' })
      ).toBeHidden()
      await expect(page.getByRole('banner')).toBeHidden()
      await expectHealthyPage(page)
      await page.screenshot({
        path: testInfo.outputPath(`desktop-${width}-recipes.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }

    const primaryNavigation = sidebar.getByRole('navigation', {
      name: 'Primary navigation',
    })
    const destinations = [
      ['Planner', '/planner'],
      ['Recipes', '/recipes'],
      ['Shopping', '/shopping'],
      ['Pantry', '/pantry'],
    ] as const

    for (const [label, href] of destinations) {
      await expect(
        primaryNavigation.getByRole('link', { name: label, exact: true })
      ).toHaveAttribute('href', href)
    }

    await expect(sidebar.getByText('Dashboard')).toHaveCount(0)
    await expect(sidebar.getByText('Settings')).toHaveCount(0)
    await expect(sidebar.getByText('Create Recipe')).toHaveCount(0)
    await expect(sidebar.getByText('Account')).toBeVisible()

    const brandLink = sidebar.getByRole('link', {
      name: 'Go to Planner',
    })
    await expect(brandLink).toHaveAttribute('href', '/planner')
    await expect(brandLink.locator('img')).toHaveAttribute('alt', '')
    expect((await page.request.get('/recipe-genie-mark.svg')).ok()).toBe(true)

    const routeCaptures = [
      { path: '/recipes', active: 'Recipes', name: 'recipes' },
      {
        path: '/recipes/10000000-0000-4000-8000-000000000006',
        active: 'Recipes',
        name: 'recipe-detail',
      },
      { path: '/planner', active: 'Planner', name: 'planner' },
      { path: '/shopping', active: 'Shopping', name: 'shopping' },
      { path: '/pantry', active: 'Pantry', name: 'pantry' },
    ] as const

    await page.setViewportSize({ width: 1440, height: 900 })
    for (const route of routeCaptures) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await expect(
        primaryNavigation.getByRole('link', {
          name: route.active,
          exact: true,
        })
      ).toHaveAttribute('aria-current', 'page')
      await expectHealthyPage(page)
      await page.screenshot({
        path: testInfo.outputPath(`desktop-1440-${route.name}.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }

    await page.goto('/recipes', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('desktop-1440-domain-settings.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Help' }).click()
    await expect(
      page.getByRole('heading', { name: 'Welcome to Recipe Genie' })
    ).toBeVisible()
    await expectHealthyPage(page)
    await page.screenshot({
      path: testInfo.outputPath('desktop-1440-help.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    for (const width of [360, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/recipes', { waitUntil: 'domcontentloaded' })
      await expect(sidebar).toBeHidden()
      await expect(page.getByRole('banner')).toBeVisible()
      await expect(
        page.getByRole('navigation', { name: 'Bottom navigation' })
      ).toBeVisible()
      await expectHealthyPage(page)
      await page.screenshot({
        path: testInfo.outputPath(`mobile-${width}-recipes.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' })
    await sidebar.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expectHealthyPage(page)
    await page.screenshot({
      path: testInfo.outputPath('desktop-1440-sign-out.png'),
      fullPage: true,
      animations: 'disabled',
    })

    expect(browserErrors).toEqual([])
  })

  test('preserves retained routes and account actions on representative mobile', async ({
    page,
    setupAuth,
  }, testInfo) => {
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))

    await page.setViewportSize({ width: 390, height: 844 })
    await setupAuth()

    const sidebar = page.getByRole('complementary', {
      name: 'Recipe Genie desktop navigation',
    })
    const bottomNavigation = page.getByRole('navigation', {
      name: 'Bottom navigation',
    })
    const routeCaptures = [
      { path: '/recipes', active: 'Recipes', name: 'recipes' },
      {
        path: '/recipes/10000000-0000-4000-8000-000000000006',
        active: 'Recipes',
        name: 'recipe-detail',
      },
      { path: '/planner', active: 'Planner', name: 'planner' },
      { path: '/shopping', active: 'Shopping', name: 'shopping' },
      { path: '/pantry', active: 'Pantry', name: 'pantry' },
    ] as const

    for (const route of routeCaptures) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' })
      await expect(sidebar).toBeHidden()
      await expect(page.getByRole('banner')).toBeVisible()
      await expect(bottomNavigation).toBeVisible()
      await expect(
        bottomNavigation.getByRole('link', {
          name: route.active,
          exact: true,
        })
      ).toHaveAttribute('aria-current', 'page')
      await expectHealthyPage(page)
      await page.screenshot({
        path: testInfo.outputPath(`mobile-390-${route.name}.png`),
        fullPage: true,
        animations: 'disabled',
      })
    }

    await page.goto('/recipes', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectHealthyPage(page)
    await page.screenshot({
      path: testInfo.outputPath('mobile-390-domain-settings.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Help' }).click()
    await expect(
      page.getByRole('heading', { name: 'Welcome to Recipe Genie' })
    ).toBeVisible()
    await expectHealthyPage(page)
    await page.screenshot({
      path: testInfo.outputPath('mobile-390-help.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByRole('button', { name: 'Open account menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    await expectHealthyPage(page)
    await page.screenshot({
      path: testInfo.outputPath('mobile-390-sign-out.png'),
      fullPage: true,
      animations: 'disabled',
    })

    expect(browserErrors).toEqual([])
  })
})
