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
    const scrollContainer = Array.from(document.querySelectorAll<HTMLElement>('*'))
      .find((element) => {
        const { overflowY } = window.getComputedStyle(element)
        return (
          ['auto', 'scroll'].includes(overflowY) &&
          element.scrollHeight > element.clientHeight + 1
        )
      })

    if (!scrollContainer) return null
    return {
      viewportHeight: scrollContainer.clientHeight,
      contentHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
      scrollScreens: Number(
        (scrollContainer.scrollHeight / scrollContainer.clientHeight).toFixed(2)
      ),
    }
  })
}

async function navigateToInspectionTab(
  page: import('@playwright/test').Page,
  tab: 'recipes' | 'shopping' | 'planner' | 'pantry'
) {
  const control = tab === 'planner'
    ? page.getByRole('button', { name: 'Go to Planner', exact: true })
    : page
      .getByRole('navigation', { name: 'Bottom navigation' })
      .getByRole('button', {
        name: new RegExp(`^${tab}$`, 'i'),
      })

  await expect(control).toBeVisible()
  await control.click()

  const activePanel = page.locator(
    `[data-home-tab-panel="${tab}"][aria-hidden="false"]`
  )
  await expect(activePanel).toBeVisible()
  return activePanel
}

function waitForPlannerHistoryPrefetch(
  page: import('@playwright/test').Page
) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      response.request().method() === 'GET' &&
      url.origin === 'http://127.0.0.1:54321' &&
      url.pathname === '/rest/v1/recipe_history'
    )
  })
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
    const initialPlannerHistoryPrefetch = waitForPlannerHistoryPrefetch(page)
    await setupAuth()
    await initialPlannerHistoryPrefetch

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      const plannerHistoryPrefetch = waitForPlannerHistoryPrefetch(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await plannerHistoryPrefetch
      await expect(page.locator('main')).toBeVisible()
      await expect(page.getByRole('button', { name: /^planner$/i }).first())
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
    for (const tab of ['recipes', 'shopping', 'planner', 'pantry'] as const) {
      const activePanel = await navigateToInspectionTab(page, tab)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1)
      if (tab === 'recipes') {
        const lasagnaCard = activePanel
          .getByRole('button')
          .filter({
            has: page.getByRole('heading', {
              name: 'Long Sunday Lasagna',
              exact: true,
            }),
          })
        await expect(lasagnaCard).toHaveCount(1)
        await expect(lasagnaCard).toBeVisible()
      } else if (tab === 'shopping') {
        const lemonsRow = activePanel
          .getByTestId('shopping-item-row')
          .filter({ has: page.getByText('lemons', { exact: true }) })
        await expect(lemonsRow).toHaveCount(1)
        await expect(lemonsRow).toBeVisible()
      } else if (tab === 'planner') {
        const mondaySection = activePanel.locator(
          'section[data-day-index="0"][data-day-date]'
        )
        await expect(
          mondaySection.getByRole('heading', { name: /^Monday \d+$/ })
        ).toBeVisible()
        await expect(
          mondaySection.getByText('Weeknight Lemon Chicken', { exact: true })
        ).toBeVisible()
      } else {
        const garlicItem = activePanel
          .locator('[data-pantry-item]')
          .filter({ has: page.getByText('garlic', { exact: true }) })
        await expect(garlicItem).toHaveCount(1)
        await expect(garlicItem).toBeVisible()
      }
      await page.screenshot({
        path: testInfo.outputPath(`mobile-390-${tab}.png`),
        fullPage: true,
      })
    }

    await navigateToInspectionTab(page, 'recipes')
    const requestedScrollTop = await page.evaluate(() => {
      const scrollContainer = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .find((element) => {
          const { overflowY } = window.getComputedStyle(element)
          return (
            ['auto', 'scroll'].includes(overflowY) &&
            element.scrollHeight > element.clientHeight + 1
          )
        })
      if (!scrollContainer) return 0
      scrollContainer.scrollTop = Math.min(500, scrollContainer.scrollHeight - scrollContainer.clientHeight)
      return scrollContainer.scrollTop
    })
    await navigateToInspectionTab(page, 'shopping')
    await navigateToInspectionTab(page, 'recipes')
    const restoredScroll = await contentScrollMetrics(page)
    await testInfo.attach('tab-scroll-restoration', {
      body: Buffer.from(JSON.stringify({ requestedScrollTop, restoredScroll }, null, 2)),
      contentType: 'application/json',
    })

    const lasagnaCard = page
      .getByRole('button')
      .filter({
        has: page.getByRole('heading', {
          name: 'Long Sunday Lasagna',
          exact: true,
        }),
      })
    await lasagnaCard.click()
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

  test('keeps the direct recipe fallback on Recipes when local storage writes fail', async ({
    page,
    setupAuth,
  }) => {
    expect(E2E_CONFIG.target).toBe('local')
    await page.setViewportSize({ width: 1200, height: 800 })
    await setupAuth()

    await page.evaluate(() => {
      window.localStorage.setItem('recipe-genie-active-tab', 'planner')
      document.cookie =
        'recipe-genie-active-tab=planner; Path=/; Max-Age=31536000; SameSite=Lax'
    })
    await page.goto(
      `${E2E_CONFIG.baseURL}/recipes/10000000-0000-4000-8000-000000000006`
    )
    await expect(page.getByTestId('recipe-detail-page')).toBeVisible()
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (
          this === window.localStorage &&
          key === 'recipe-genie-active-tab'
        ) {
          throw new Error('simulated local storage write failure')
        }
        return originalSetItem.call(this, key, value)
      }
    })

    await page.getByRole('button', { name: /back to recipes/i }).click()

    await expect(page).toHaveURL(`${E2E_CONFIG.baseURL}/`)
    await expect(
      page.locator(
        '[data-home-tab-panel="recipes"][aria-hidden="false"]'
      )
    ).toBeVisible()
    const persistedState = await page.evaluate(() => ({
      activeTab: window.localStorage.getItem('recipe-genie-active-tab'),
      cookie: document.cookie
        .split('; ')
        .find((entry) => entry.startsWith('recipe-genie-active-tab='))
        ?.split('=')[1],
    }))

    expect(persistedState).toEqual({
      activeTab: 'planner',
      cookie: 'recipes',
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
  })
})
