import { test, expect } from './fixtures'
import { assertRecipeGenieAppShell, signInToRecipeGenie } from './e2e-env'

test.describe('Authentication', () => {
  test.describe('Unauthenticated entry', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('shows the real sign-in screen at the app root @extended', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByRole('heading', { name: 'Recipe Genie' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()
      await expect(page.getByRole('button', { name: /^sign up$/i })).toHaveCount(0)
    })

    test('shows a meaningful error for invalid credentials @extended', async ({ page }) => {
      await page.goto('/')

      await page.getByLabel('Email').fill('nonexistent@example.com')
      await page.getByLabel('Password').fill('wrongpassword')
      await page.getByRole('button', { name: /^sign in$/i }).click()

      await expect(page.getByText(/invalid login credentials/i)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Recipe Genie' })).toBeVisible()
      await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0)
    })

    test('signs in successfully with valid credentials @extended', async ({ page }) => {
      await page.goto('/')
      await signInToRecipeGenie(page)

      await assertRecipeGenieAppShell(page)
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
      await expect(page.getByLabel('Email')).toHaveCount(0)
    })
  })

  test.describe('Authenticated session', () => {
    test('boots directly into the authenticated Recipe Genie shell @extended', async ({ page }) => {
      await page.goto('/')

      await assertRecipeGenieAppShell(page)
      await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
      await expect(page.getByRole('textbox', { name: /search recipes by name or category/i })).toBeVisible()
    })

    test('signs out back to the sign-in screen @core', async ({ page, setupAuth }) => {
      await setupAuth()

      await page.getByRole('button', { name: /sign out/i }).click()

      await expect(page.getByRole('heading', { name: 'Recipe Genie' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0)
    })
  })
})
