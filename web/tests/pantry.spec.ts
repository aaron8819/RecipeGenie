import { test, expect, VIEWPORTS, measureTouchTarget } from './fixtures'

test.describe.configure({ mode: 'serial' })

function uniqueSeed() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

async function addPantryEntry(page: import('@playwright/test').Page, value: string) {
  const input = page.getByPlaceholder(/add pantry item \(comma-separated\)/i)
  await input.fill(value)
  await page.keyboard.press('Enter')
}

async function addExcludedKeyword(page: import('@playwright/test').Page, value: string) {
  const input = page.getByPlaceholder(/add excluded keyword \(comma-separated\)/i)
  await input.fill(value)
  await page.keyboard.press('Enter')
}

function undoAlert(page: import('@playwright/test').Page) {
  return page.getByRole('alert').filter({ has: page.getByRole('button', { name: /^undo$/i }) }).first()
}

test.describe('Pantry Management', () => {
  test.beforeEach(async ({ setupAuth, navigateToRoute }) => {
    await setupAuth()
    await navigateToRoute('pantry')
  })

  test('shows Pantry header, counts, helper text, and current empty-state copy when visible @extended', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: /^pantry$/i })).toBeVisible()
    await expect(page.getByText(/\d+ pantry items?/i).first()).toBeVisible()
    await expect(page.getByText(/\d+ excluded keywords?/i).first()).toBeVisible()
    await expect(
      page.getByText(/duplicates are skipped and anything that fails stays in the field for retry/i)
    ).toBeVisible()
    await expect(
      page.getByText(/use exact keywords for ingredients that should stay out of shopping/i)
    ).toBeVisible()

    const pantryEmptyState = page.getByText(/no pantry items yet/i)
    if (await pantryEmptyState.isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: /add pantry items/i })).toBeVisible()
    }

    const excludedEmptyState = page.getByText(/no excluded keywords/i)
    if (await excludedEmptyState.isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: /add excluded keywords/i })).toBeVisible()
    }
  })

  test('adds pantry items with item-specific grouped feedback @core', async ({ page }) => {
    const seed = uniqueSeed()
    const pantryItem = `pantry oil ${seed}`
    const duplicateItem = `pantry duplicate ${seed}`

    await addPantryEntry(page, duplicateItem)
    await expect(page.getByText(duplicateItem, { exact: true })).toBeVisible()

    await addPantryEntry(page, `${pantryItem}, ${duplicateItem}`)

    await expect(page.getByText(pantryItem, { exact: true })).toBeVisible()
    await expect(
      page.getByText(new RegExp(`Pantry items: Added: ${pantryItem}\\. Already existed: ${duplicateItem}\\.`, 'i'))
    ).toBeVisible()
  })

  test('removes pantry items and queues undo toasts @extended', async ({ page }) => {
    const seed = uniqueSeed()
    const firstItem = `queued pantry ${seed}-a`
    const secondItem = `queued pantry ${seed}-b`

    await addPantryEntry(page, `${firstItem}, ${secondItem}`)
    await expect(page.getByText(firstItem, { exact: true })).toBeVisible()
    await expect(page.getByText(secondItem, { exact: true })).toBeVisible()

    const alert = undoAlert(page)
    await page.getByRole('button', { name: new RegExp(`remove ${firstItem}`, 'i') }).click()
    await expect(alert).toContainText(new RegExp(`${firstItem}.*removed from pantry`, 'i'))

    await page.getByRole('button', { name: new RegExp(`remove ${secondItem}`, 'i') }).click()
    await page.getByRole('button', { name: /^dismiss$/i }).click()
    await expect(alert).toContainText(new RegExp(`${secondItem}.*removed from pantry`, 'i'))
  })

  test('adds and removes excluded keywords with current helper and undo behavior @core', async ({ page }) => {
    const seed = uniqueSeed()
    const keyword = `excluded-${seed}`

    await addExcludedKeyword(page, keyword)
    await expect(page.getByText(keyword, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: new RegExp(`remove excluded keyword ${keyword}`, 'i') }).click()

    const alert = undoAlert(page)
    await expect(alert).toContainText(new RegExp(`${keyword}.*removed from excluded keywords`, 'i'))
    await expect(page.getByRole('button', { name: /^undo$/i })).toBeVisible()
  })

  test('persists Salt and Black pepper family exclusions independently @core', async ({ page, navigateToRoute }) => {
    const salt = page.getByRole('checkbox', { name: 'Salt variants' })
    const blackPepper = page.getByRole('checkbox', { name: 'Black pepper variants' })
    await expect(salt).toBeVisible()
    await expect(blackPepper).toBeVisible()

    const originalSalt = await salt.isChecked()
    const originalBlackPepper = await blackPepper.isChecked()
    const saveSalt = page.waitForResponse((response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/rest/v1/user_config')
    )
    await salt.setChecked(!originalSalt)
    expect((await saveSalt).ok()).toBe(true)
    await expect(salt).toBeChecked({ checked: !originalSalt })
    await expect(blackPepper).toBeChecked({ checked: originalBlackPepper })

    await page.reload()
    await navigateToRoute('pantry')
    await expect(
      page.getByRole('checkbox', { name: 'Salt variants' })
    ).toBeChecked({ checked: !originalSalt })
    await expect(
      page.getByRole('checkbox', { name: 'Black pepper variants' })
    ).toBeChecked({ checked: originalBlackPepper })

    const restoreSalt = page.waitForResponse((response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/rest/v1/user_config')
    )
    await page.getByRole('checkbox', { name: 'Salt variants' }).setChecked(originalSalt)
    expect((await restoreSalt).ok()).toBe(true)
  })

  test('uses mobile-sized remove touch targets @extended', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const viewport = page.viewportSize()
    const isMobile = viewport && viewport.width < 768
    if (isMobile) {
      await page.locator('nav.fixed.bottom-0').getByRole('link', { name: /pantry/i }).click()
    }

    const seed = uniqueSeed()
    const item = `mobile touch ${seed}`
    await addPantryEntry(page, item)

    const removeButton = page.getByRole('button', { name: new RegExp(`remove ${item}`, 'i') })
    await expect(removeButton).toBeVisible()

    const size = await measureTouchTarget(removeButton)
    expect(size.width).toBeGreaterThanOrEqual(32)
    expect(size.height).toBeGreaterThanOrEqual(32)
  })
})
