import { test, expect, TEST_USER } from './fixtures'

test.describe('Smoke Route Load', () => {
  test('should load app shell at root @smoke', async ({ page, setupAuth }) => {
    await setupAuth()
    await page.goto('/')
    await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible()
  })

  test.describe('Auth bootstrap', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('should bootstrap auth via login or session restore @smoke', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      const emailInput = page.locator('#email')
      if (await emailInput.isVisible().catch(() => false)) {
        await emailInput.fill(TEST_USER.email)
        await page.locator('#password').fill(TEST_USER.password)
        await page.getByRole('button', { name: /sign in/i }).click()
      }

      await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible({ timeout: 45000 })
    })
  })

  test('should load recipes tab @smoke', async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('recipes')
    await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('recipe-genie-active-tab')))
      .toBe('recipes')
  })

  test('should load planner tab @smoke', async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('planner')
    await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('recipe-genie-active-tab')))
      .toBe('planner')
  })

  test('should load shopping tab @smoke', async ({ page, setupAuth, navigateToTab }) => {
    await setupAuth()
    await navigateToTab('shopping')
    await expect(page.getByRole('button', { name: /sign out/i }).first()).toBeVisible()
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('recipe-genie-active-tab')))
      .toBe('shopping')
  })
})
