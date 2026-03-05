import { test, expect, SAMPLE_RECIPE, VIEWPORTS } from './fixtures'

test.describe('Smoke Critical Flow', () => {
  test('should complete happy path across planner and shopping @smoke', async ({
    page,
    setupAuth,
    navigateToTab,
    addRecipe,
  }) => {
    await setupAuth()

    await navigateToTab('recipes')
    await addRecipe(SAMPLE_RECIPE)
    await expect(page.getByText(SAMPLE_RECIPE.name)).toBeVisible()

    await navigateToTab('planner')
    await page.setViewportSize(VIEWPORTS.desktopLarge)

    const chickenIncrement = page.getByRole('button', { name: /Increase Chicken count/i })
    if (await chickenIncrement.isVisible().catch(() => false)) {
      await chickenIncrement.click()
    } else {
      await page.getByRole('button', { name: /Increase \w+ count/i }).first().click()
    }

    const generateButton = page.getByRole('button', { name: /Generate Plan/i }).first()
    await generateButton.click()
    await page.waitForTimeout(1200)

    const replacePlanDialog = page.getByText(/Replace existing plan/i)
    if (await replacePlanDialog.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: /Generate New Plan/i }).click()
      await page.waitForTimeout(1200)
    }

    const addToCartButton = page.locator('button').filter({ hasText: 'Add to Cart' }).first()
    await expect(addToCartButton).toBeVisible()
    await addToCartButton.click()
    await page.waitForTimeout(1000)

    await navigateToTab('shopping')
    const checkbox = page.locator('[data-checkbox="true"]').first()
    await checkbox.waitFor({ state: 'visible', timeout: 8000 })

    if ((await checkbox.getAttribute('aria-label')) !== 'Check off item') {
      await checkbox.click()
      await expect(checkbox).toHaveAttribute('aria-label', 'Check off item', { timeout: 4000 })
    }

    await checkbox.click()
    await expect(checkbox).toHaveAttribute('aria-label', 'Uncheck item', { timeout: 5000 })

    const firstRow = checkbox.locator('..')
    await firstRow.hover()
    await page.waitForTimeout(200)

    const addToPantryButton = firstRow
      .locator('[title="Add to pantry"]')
      .or(firstRow.locator('[aria-label="Add to pantry"]'))
      .first()

    if (await addToPantryButton.isVisible().catch(() => false)) {
      await addToPantryButton.click()
      await expect(page.getByText('In Pantry').first()).toBeVisible({ timeout: 5000 })
    }
  })
})
