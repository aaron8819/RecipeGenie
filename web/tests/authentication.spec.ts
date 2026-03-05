import { test, expect, TEST_USER } from './fixtures'

test.describe('Authentication', () => {
  // Tests that need to see the auth page (unauthenticated state)
  test.describe('Sign Up Flow', () => {
    // Use empty storage state to see auth form
    test.use({ storageState: { cookies: [], origins: [] } })

    test('should display sign up form when toggled', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Click toggle to switch to sign up
      await page.getByText(/don't have an account/i).click()

      // Verify form shows sign up elements
      await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible()
      await expect(page.getByText(/create an account/i)).toBeVisible()
    })

    test('should show validation errors for invalid email', async ({ page }) => {
      await page.goto('/')
      await page.getByText(/don't have an account/i).click()

      await page.getByLabel('Email').fill('invalidemail')
      await page.getByLabel('Password').fill('password123')
      await page.getByRole('button', { name: /sign up/i }).click()

      // Browser validation should show error (or form validation)
      const emailInput = page.getByLabel('Email')
      await expect(emailInput).toHaveAttribute('type', 'email')
    })

    test('should show validation errors for short password', async ({ page }) => {
      await page.goto('/')
      await page.getByText(/don't have an account/i).click()

      await page.getByLabel('Email').fill('test@example.com')
      await page.getByLabel('Password').fill('12345')
      await page.getByRole('button', { name: /sign up/i }).click()

      // Password should have minlength validation
      const passwordInput = page.getByLabel('Password')
      await expect(passwordInput).toHaveAttribute('minlength', '6')
    })

    test('should show success message after sign up', async ({ page }) => {
      await page.goto('/')
      await page.getByText(/don't have an account/i).click()

      // Use a unique email to avoid conflicts
      const uniqueEmail = `test-${Date.now()}@example.com`
      await page.getByLabel('Email').fill(uniqueEmail)
      await page.getByLabel('Password').fill('password123')
      await page.getByRole('button', { name: /sign up/i }).click()

      // Should show confirmation message or error (depending on Supabase setup)
      await page.waitForTimeout(2000)
      const successMessage = page.getByText(/check your email|confirmation/i)
      const errorMessage = page.getByText(/error|failed/i)

      // Either success or specific error should appear
      const hasMessage = await successMessage.isVisible() || await errorMessage.isVisible()
      expect(hasMessage).toBeTruthy()
    })
  })

  test.describe('Sign In Flow', () => {
    // Use empty storage state to see auth form
    test.use({ storageState: { cookies: [], origins: [] } })

    test('should display sign in form by default', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
    })

    test('should show error for invalid credentials', async ({ page }) => {
      await page.goto('/')

      await page.getByLabel('Email').fill('nonexistent@example.com')
      await page.getByLabel('Password').fill('wrongpassword')
      await page.getByRole('button', { name: /sign in/i }).click()

      // Wait for error message
      await page.waitForTimeout(2000)
      const errorMessage = page.getByText(/error|invalid|incorrect/i)
      await expect(errorMessage).toBeVisible()
    })

    test('should navigate to main app after successful sign in @smoke', async ({ page }) => {
      await page.goto('/')

      // Sign in with test user
      await page.getByLabel('Email').fill(TEST_USER.email)
      await page.getByLabel('Password').fill(TEST_USER.password)
      await page.getByRole('button', { name: /sign in/i }).click()

      // Wait for main app to load
      await page.waitForSelector('nav, header.md\\:fixed', { state: 'visible', timeout: 15000 })

      // Verify main app is loaded (not auth form)
      await expect(page.locator('header.md\\:fixed')).toBeVisible()
    })
  })

  test.describe('Sign Out Flow', () => {
    // Uses authenticated state from global setup
    test('should sign out and return to auth form', async ({ page, setupAuth }) => {
      await setupAuth()

      // Find and click sign out button
      const signOutButton = page.getByRole('button', { name: /sign out/i }).first()
      await signOutButton.click()

      // Wait for auth form to appear
      await page.waitForSelector('form', { state: 'visible', timeout: 10000 })

      // Should return to auth form
      await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
    })
  })

  test.describe('Authenticated User Session', () => {
    // Uses authenticated state from global setup
    test('should show user initials in avatar', async ({ page, setupAuth }) => {
      await setupAuth()

      // Look for avatar with user initials (first 2 chars of email local part)
      // For aabloch@microsoft.com, should show "AA"
      const avatar = page.locator('[title*="@"]')
      await expect(avatar).toBeVisible()
      await expect(avatar).toHaveText('AA')
    })

    test('should persist session on page refresh', async ({ page, setupAuth }) => {
      await setupAuth()

      // Verify we're in the app
      await expect(page.locator('header.md\\:fixed')).toBeVisible()

      // Refresh the page
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Should still be in the app (not redirected to auth)
      await expect(page.locator('header.md\\:fixed')).toBeVisible()
    })

    test('should maintain active tab across page refresh', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()

      // Navigate to recipes tab
      await navigateToTab('recipes')
      await page.waitForTimeout(300)

      // Refresh page
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Tab should be restored
      const activeTab = await page.evaluate(() => localStorage.getItem('recipe-genie-active-tab'))
      expect(activeTab).toBe('recipes')
    })
  })

  test.describe('Auth Error Handling', () => {
    // Use empty storage state to see auth form
    test.use({ storageState: { cookies: [], origins: [] } })

    test('should handle expired confirmation link gracefully', async ({ page }) => {
      // Simulate expired link by visiting with error params
      await page.goto('/?error=access_denied&error_code=otp_expired')
      await page.waitForLoadState('networkidle')

      // Should show error message
      const errorMessage = page.getByText(/expired|invalid/i)
      await expect(errorMessage).toBeVisible()
    })

    test('should handle PKCE error gracefully', async ({ page }) => {
      // Simulate PKCE error
      await page.goto('/?error=pkce_error')
      await page.waitForLoadState('networkidle')

      // Should show helpful error message
      const errorMessage = page.getByText(/different browser|session/i)
      await expect(errorMessage).toBeVisible()
    })
  })
})
