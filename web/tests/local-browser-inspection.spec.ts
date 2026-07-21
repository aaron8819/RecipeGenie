import { test, expect } from './fixtures'
import { E2E_CONFIG } from './e2e-env'

type Diagnostic = {
  kind: 'console' | 'page' | 'request' | 'response'
  detail: string
}

const viewports = [
  { name: 'mobile-360', width: 360, height: 780 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-430', width: 430, height: 900 },
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

test.describe('local authenticated browser inspection', () => {
  test('captures responsive authenticated surfaces and interaction health', async ({
    page,
    setupAuth,
    navigateToTab,
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
      diagnostics.push({
        kind: 'request',
        detail: `${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText || 'unknown'}`,
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
      await navigateToTab(tab)
      await expect(page.locator('main')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
        .toBeLessThanOrEqual(1)
      if (tab === 'recipes') {
        await expect(page.getByText('Long Sunday Lasagna', { exact: true })
          .filter({ visible: true }).first()).toBeVisible()
      } else if (tab === 'shopping') {
        await expect(page.getByText('lemons', { exact: true })
          .filter({ visible: true }).first()).toBeVisible()
      } else if (tab === 'planner') {
        await expect(page.getByText('Weeknight Lemon Chicken', { exact: true })
          .filter({ visible: true }).first()).toBeVisible()
      } else {
        await expect(page.getByText('garlic', { exact: true })
          .filter({ visible: true }).first()).toBeVisible()
      }
      await page.screenshot({
        path: testInfo.outputPath(`mobile-390-${tab}.png`),
        fullPage: true,
      })
    }

    await navigateToTab('recipes')
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
    await navigateToTab('shopping')
    await navigateToTab('recipes')
    const restoredScroll = await contentScrollMetrics(page)
    await testInfo.attach('tab-scroll-restoration', {
      body: Buffer.from(JSON.stringify({ requestedScrollTop, restoredScroll }, null, 2)),
      contentType: 'application/json',
    })

    await page.getByText('Long Sunday Lasagna', { exact: true }).first().click()
    const detailDialog = page.getByRole('dialog').last()
    await expect(detailDialog.getByRole('button', { name: /edit recipe/i })).toBeVisible()
    await expect(detailDialog.getByText('Rest for 20 minutes before slicing.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('recipe-detail-390.png') })
    await page.keyboard.press('Escape')

    const importedName = 'Local Inspection Tomato Toast'
    await page.getByRole('button', { name: /add recipe/i }).first().click()
    let dialog = page.getByRole('dialog').first()
    await dialog.getByRole('tab', { name: /^import$/i }).click()
    await dialog.getByLabel('Paste Recipe Text').fill(
      `${importedName}\nServes 2\n\nIngredients:\n2 slices sourdough bread\n1 cup cherry tomatoes\n\nInstructions:\n1. Toast the bread.\n2. Spoon tomatoes over top.`
    )
    await expect(dialog.getByText(importedName, { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: /apply to form/i }).click()
    await dialog.getByRole('button', { name: /^add recipe$/i }).click()
    const importedDetail = page.getByRole('dialog').last()
    await expect(importedDetail.locator('h1').filter({ hasText: importedName })).toBeVisible()
    await importedDetail.getByRole('button', { name: /edit recipe/i }).click()
    dialog = page.getByRole('dialog').first()
    await dialog.locator('#name-edit').fill(`${importedName} Edited`)
    await page.screenshot({ path: testInfo.outputPath('recipe-edit-390.png') })
    await dialog.getByRole('button', { name: /save changes/i }).click()
    await expect(dialog).toBeHidden({ timeout: 15000 })

    await page.setViewportSize({ width: 390, height: 420 })
    if (await page.getByRole('dialog').last().isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
    }
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
      !(entry.kind === 'request' && entry.detail.includes('ERR_ABORTED'))
    )).toEqual([])
    expect(diagnostics.filter((entry) => entry.kind === 'response' && Number(entry.detail.split(' ')[0]) >= 500)).toEqual([])
  })
})
