import { test, expect } from './fixtures'
import { E2E_CONFIG } from './e2e-env'
import {
  formatRequestFailure,
  isExpectedInspectionNavigationAbort,
  type RequestFailureSnapshot,
} from './request-failure-diagnostics'

type Diagnostic = {
  kind: 'console' | 'page' | 'request' | 'response'
  detail: string
  requestFailure?: RequestFailureSnapshot
}

const viewports = [
  { name: 'mobile-360', width: 360, height: 800 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-reduced-height', width: 390, height: 420 },
  { name: 'desktop-1200', width: 1200, height: 800 },
]

async function contentScrollMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const scrollContainer = document.scrollingElement ?? document.documentElement
    return {
      viewportHeight: window.innerHeight,
      contentHeight: scrollContainer.scrollHeight,
      scrollTop: window.scrollY,
      scrollScreens: Number(
        (scrollContainer.scrollHeight / window.innerHeight).toFixed(2)
      ),
    }
  })
}

async function navigateToInspectionRoute(
  page: import('@playwright/test').Page,
  route: 'recipes' | 'shopping' | 'planner' | 'pantry'
) {
  const control = route === 'planner'
    ? page.getByRole('link', { name: 'Go to Planner', exact: true })
    : page
      .getByRole('navigation', { name: 'Bottom navigation' })
      .getByRole('link', {
        name: new RegExp(`^${route}$`, 'i'),
      })

  await expect(control).toBeVisible()
  await control.click()

  const activeScreen = page.locator(`[data-app-screen="${route}"]`)
  await expect(activeScreen).toBeVisible()
  await expect(page.locator('[data-app-screen]')).toHaveCount(1)
  return activeScreen
}

test.describe('local authenticated browser inspection', () => {
  test('captures responsive authenticated surfaces and interaction health', async ({
    page,
    setupAuth,
  }, testInfo) => {
    expect(E2E_CONFIG.target).toBe('local')
    const diagnostics: Diagnostic[] = []

    page.on('console', (message) => {
      if (message.type() === 'error') {
        diagnostics.push({ kind: 'console', detail: message.text() })
      }
    })
    page.on('pageerror', (error) => {
      diagnostics.push({ kind: 'page', detail: error.message })
    })
    page.on('requestfailed', (request) => {
      const requestFailure = {
        failureText: request.failure()?.errorText || 'unknown',
        isNavigationRequest: request.isNavigationRequest(),
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      }
      diagnostics.push({
        kind: 'request',
        detail: formatRequestFailure(requestFailure),
        requestFailure,
      })
    })
    page.on('response', (response) => {
      if (response.status() >= 400) {
        diagnostics.push({ kind: 'response', detail: `${response.status()} ${new URL(response.url()).pathname}` })
      }
    })

    await page.setViewportSize({ width: 1200, height: 800 })
    await setupAuth()

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('main')).toBeVisible()
      await expect(page.getByRole('link', { name: /^planner$/i }).first())
        .toBeVisible({ timeout: 45000 })
      await page.waitForLoadState('networkidle')

      const measurements = await page.evaluate(() => ({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        visiblePrimaryActions: Array.from(document.querySelectorAll('button'))
          .filter((button) => {
            const style = window.getComputedStyle(button)
            const rect = button.getBoundingClientRect()
            return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
          })
          .map((button) => button.getAttribute('aria-label') || button.textContent?.trim())
          .filter(Boolean)
          .slice(0, 12),
      }))
      const contentScroll = await contentScrollMetrics(page)

      expect(measurements.viewport.width).toBe(viewport.width)
      expect(measurements.horizontalOverflow).toBeLessThanOrEqual(1)
      expect(measurements.visiblePrimaryActions.length).toBeGreaterThan(0)
      await testInfo.attach(`${viewport.name}-metrics`, {
        body: Buffer.from(JSON.stringify({ ...measurements, contentScroll }, null, 2)),
        contentType: 'application/json',
      })
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}.png`),
        fullPage: true,
      })
    }

    await page.setViewportSize({ width: 390, height: 844 })
    for (const route of ['recipes', 'shopping', 'planner', 'pantry'] as const) {
      const activeScreen = await navigateToInspectionRoute(page, route)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1)
      if (route === 'recipes') {
        const lasagnaCard = activeScreen
          .getByRole('button')
          .filter({
            has: page.getByRole('heading', {
              name: 'Long Sunday Lasagna',
              exact: true,
            }),
          })
        await expect(lasagnaCard).toHaveCount(1)
        await expect(lasagnaCard).toBeVisible()
      } else if (route === 'shopping') {
        const lemonsRow = activeScreen
          .getByTestId('shopping-item-row')
          .filter({ has: page.getByText('lemons', { exact: true }) })
        await expect(lemonsRow).toHaveCount(1)
        await expect(lemonsRow).toBeVisible()
      } else if (route === 'planner') {
        const mondaySection = activeScreen.locator(
          'section[data-day-index="0"][data-day-date]'
        )
        await expect(
          mondaySection.getByRole('heading', { name: /^Monday \d+$/ })
        ).toBeVisible()
        await expect(
          mondaySection.getByText('Weeknight Lemon Chicken', { exact: true })
        ).toBeVisible()
      } else {
        const garlicItem = activeScreen
          .locator('[data-pantry-item]')
          .filter({ has: page.getByText('garlic', { exact: true }) })
        await expect(garlicItem).toHaveCount(1)
        await expect(garlicItem).toBeVisible()
      }
      await page.screenshot({
        path: testInfo.outputPath(`mobile-390-${route}.png`),
        fullPage: true,
      })
    }

    await navigateToInspectionRoute(page, 'recipes')
    const requestedScrollTop = await page.evaluate(() => {
      window.scrollTo(0, Math.min(500, document.documentElement.scrollHeight - window.innerHeight))
      return window.scrollY
    })
    await navigateToInspectionRoute(page, 'shopping')
    await page.goBack()
    await expect(page).toHaveURL(/\/recipes/)
    const restoredScroll = await contentScrollMetrics(page)
    await testInfo.attach('route-scroll-restoration', {
      body: Buffer.from(JSON.stringify({ requestedScrollTop, restoredScroll }, null, 2)),
      contentType: 'application/json',
    })

    await page.getByRole('heading', {
      name: 'Long Sunday Lasagna',
      exact: true,
    }).click()
    await expect(page).toHaveURL(
      /\/recipes\/10000000-0000-4000-8000-000000000006(?:\?|$)/
    )
    const detailPage = page.getByTestId('recipe-detail-page')
    await expect(detailPage.getByRole('button', { name: /edit recipe/i })).toBeVisible()
    await expect(detailPage.getByText('Rest for 20 minutes before slicing.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('recipe-detail-390.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('recipe-detail-1440.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: /back to recipes/i }).click()

    const importedName = 'Local Inspection Tomato Toast'
    await page.getByRole('button', { name: /add recipe/i }).first().click()
    let dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: /^import$/i }).click()
    await dialog.getByLabel('Paste Recipe Text').fill(
      `${importedName}\nServes 2\n\nIngredients:\n2 slices sourdough bread\n1 cup cherry tomatoes\n\nInstructions:\n1. Toast the bread.\n2. Spoon tomatoes over top.`
    )
    await expect(dialog.getByText(importedName, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /review imported recipe/i }).click()
    await expect(dialog.getByRole('tab', { name: /^details$/i })).toHaveAttribute('data-state', 'active')
    await dialog.getByRole('button', { name: /^save recipe$/i }).click()
    const importedDetail = page.getByTestId('recipe-detail-page')
    await expect(importedDetail.getByRole('heading', { name: importedName, level: 1 })).toBeVisible()
    await importedDetail.getByRole('button', { name: /edit recipe/i }).click()
    dialog = page.getByRole('dialog').first()
    await dialog.locator('#name-edit').fill(`${importedName} Edited`)
    await page.screenshot({ path: testInfo.outputPath('recipe-edit-390.png') })
    await dialog.getByRole('button', { name: /save changes/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })

    await page.setViewportSize({ width: 390, height: 420 })
    await page.getByRole('button', { name: /back to recipes/i }).click()
    await page.getByRole('button', { name: /add recipe/i }).first().click()
    dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: /^import$/i }).click()
    const pasteArea = dialog.getByLabel('Paste Recipe Text')
    await pasteArea.focus()
    const keyboardMetrics = await pasteArea.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        focused: document.activeElement === element,
        focusVisible: element.matches(':focus-visible'),
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        fieldVisible: rect.top < window.innerHeight && rect.bottom > 0,
      }
    })
    expect(keyboardMetrics).toMatchObject({ focused: true, fieldVisible: true })
    expect(keyboardMetrics.horizontalOverflow).toBeLessThanOrEqual(1)
    await testInfo.attach('reduced-height-focused-input', {
      body: Buffer.from(JSON.stringify(keyboardMetrics, null, 2)),
      contentType: 'application/json',
    })
    await page.screenshot({ path: testInfo.outputPath('reduced-height-focused-input.png') })

    await testInfo.attach('browser-diagnostics', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: 'application/json',
    })
    expect(diagnostics.filter((entry) =>
      entry.kind !== 'response' &&
      !(
        entry.kind === 'request' &&
        entry.requestFailure &&
        isExpectedInspectionNavigationAbort(entry.requestFailure)
      )
    )).toEqual([])
    expect(diagnostics.filter((entry) => entry.kind === 'response' && Number(entry.detail.split(' ')[0]) >= 500)).toEqual([])
  })

  test('returns direct recipe detail URLs to Recipes', async ({
    page,
    setupAuth,
  }) => {
    expect(E2E_CONFIG.target).toBe('local')
    await page.setViewportSize({ width: 1200, height: 800 })
    await setupAuth()

    await page.goto(
      `${E2E_CONFIG.baseURL}/recipes/10000000-0000-4000-8000-000000000006`
    )
    await expect(page.getByTestId('recipe-detail-page')).toBeVisible()

    await page.getByRole('button', { name: /back to recipes/i }).click()

    await expect(page).toHaveURL(`${E2E_CONFIG.baseURL}/recipes`)
    await expect(page.locator('[data-app-screen="recipes"]')).toBeVisible()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(`${E2E_CONFIG.baseURL}/recipes`)
  })
})
