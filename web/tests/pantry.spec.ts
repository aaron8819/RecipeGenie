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
  test.beforeEach(async ({ setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('pantry')
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

    await page.getByRole('button', { name: new RegExp(`remove ${firstItem}`, 'i') }).click()
    await page.getByRole('button', { name: new RegExp(`remove ${secondItem}`, 'i') }).click()

    const alert = undoAlert(page)
    await expect(alert).toContainText(new RegExp(`${firstItem}.*removed from pantry`, 'i'))

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

  test('opens What Can I Make with accessible description and current CTA copy @core', async ({ page }) => {
    await page.getByRole('button', { name: /what can i make/i }).click()

    const dialog = page.getByRole('dialog', { name: /what can i make/i })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText(/see recipes that match your pantry items and add their ingredients to your shopping list/i)
    ).toBeVisible()

    const addIngredientsButton = dialog.getByRole('button', { name: /add ingredients to shopping list/i }).first()
    if (await addIngredientsButton.isVisible().catch(() => false)) {
      await expect(addIngredientsButton).toBeVisible()
    } else {
      await expect(
        dialog.getByText(/no matching recipes found|no recipes can be made with pantry items alone/i)
      ).toBeVisible()
    }
  })

  test('keeps What Can I Make open-scoped until the user opens it @extended', async ({ page }) => {
    await expect(page.getByRole('dialog', { name: /what can i make/i })).toHaveCount(0)

    await page.getByRole('button', { name: /what can i make/i }).click()

    await expect(page.getByRole('dialog', { name: /what can i make/i })).toBeVisible()
  })

  test('uses mobile-sized remove touch targets @extended', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const viewport = page.viewportSize()
    const isMobile = viewport && viewport.width < 768
    if (isMobile) {
      await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /pantry/i }).click()
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
