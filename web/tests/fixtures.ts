import { test as base, expect, type Page, type Locator } from '@playwright/test'

/**
 * Test user credentials for authenticated tests
 */
export const TEST_USER = {
  email: 'aabloch@microsoft.com',
  password: 'recipegenie123',
}

/**
 * Sample recipe data for tests
 */
export const SAMPLE_RECIPE = {
  name: 'Test Chicken Stir Fry',
  category: 'Chicken',
  servings: 4,
  ingredients: [
    { amount: '1', unit: 'lb', item: 'chicken breast', modifier: 'cubed' },
    { amount: '2', unit: 'cups', item: 'broccoli', modifier: 'chopped' },
    { amount: '3', unit: 'tbsp', item: 'soy sauce', modifier: '' },
  ],
  instructions: 'Heat oil in a wok. Add chicken and cook until browned. Add vegetables and stir-fry for 5 minutes. Add soy sauce and serve.',
  tags: ['quick', 'healthy'],
}

/**
 * Sample imported recipe text for parser testing
 */
export const SAMPLE_RECIPE_TEXT = `
Honey Garlic Salmon (Serves 4)

Ingredients:
4 salmon fillets
3 tbsp honey
2 cloves garlic, minced
1/4 cup soy sauce
1 tbsp olive oil

Instructions:
1. Preheat oven to 400°F
2. Mix honey, garlic, and soy sauce
3. Place salmon in baking dish
4. Pour sauce over salmon
5. Bake for 15-20 minutes
`

/**
 * Viewport sizes for responsive testing
 */
export const VIEWPORTS = {
  mobile: { width: 375, height: 812 },
  mobileSmall: { width: 320, height: 568 },
  mobileLarge: { width: 414, height: 896 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1024, height: 768 },
  desktopLarge: { width: 1440, height: 900 },
}

/**
 * Helper to dismiss the first-run onboarding modal if it appears
 */
async function dismissOnboardingModal(page: import('@playwright/test').Page) {
  const onboardingModal = page.getByText('Welcome to Recipe Genie').first()
  if (await onboardingModal.isVisible().catch(() => false)) {
    console.log('📋 Onboarding modal detected, completing it...')

    // Click Continue on first step
    const continueButton = page.getByRole('button', { name: /continue/i })
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click()
      await page.waitForTimeout(500)
    }

    // Click Get Started on second step
    const getStartedButton = page.getByRole('button', { name: /get started/i })
    if (await getStartedButton.isVisible().catch(() => false)) {
      await getStartedButton.click()
      await page.waitForTimeout(500)
    }

    // Set localStorage to prevent it from showing again
    await page.evaluate(() => {
      localStorage.setItem('recipe-genie-onboarding-seen', 'true')
    })

    console.log('✅ Onboarding modal completed')
  }
}

/**
 * Custom test fixture with helper methods
 */
export interface RecipeGenieFixtures {
  /** Set up authenticated session - navigates to app (already logged in via global setup) */
  setupAuth: () => Promise<void>
  /** Sign in with test credentials */
  signIn: (email?: string, password?: string) => Promise<void>
  /** Sign out of the current session */
  signOut: () => Promise<void>
  /** Navigate to a specific tab */
  navigateToTab: (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => Promise<void>
  /** Add a recipe via the UI */
  addRecipe: (recipe: typeof SAMPLE_RECIPE) => Promise<void>
  /** Wait for the app to be fully loaded */
  waitForAppLoad: () => Promise<void>
  /** Get the active tab name */
  getActiveTab: () => Promise<string | null>
  /** Check if on mobile viewport */
  isMobileViewport: () => Promise<boolean>
}

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<RecipeGenieFixtures>({
  setupAuth: async ({ page }, use) => {
    const setup = async () => {
      // Navigate to the app - should be authenticated via global setup storage state
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')

      // Give time for auth state to be checked
      await page.waitForTimeout(1000)

      // Check if we're already authenticated (main app visible) or on auth page
      const isAuthenticated = await page.locator('header.md\\:fixed, nav.fixed.bottom-0').first().isVisible().catch(() => false)
      const isAuthPage = await page.locator('form').first().isVisible().catch(() => false)

      if (isAuthenticated) {
        // Already authenticated, but check for onboarding modal
        console.log('✅ Already authenticated')
        await dismissOnboardingModal(page)
        return
      }

      if (isAuthPage) {
        // Need to sign in - storage state didn't work
        console.log('⚠️ Storage state not working, signing in manually...')

        // Use ID selectors for reliability
        const emailInput = page.locator('#email')
        const passwordInput = page.locator('#password')

        await emailInput.waitFor({ state: 'visible', timeout: 10000 })
        await emailInput.fill(TEST_USER.email)
        await passwordInput.fill(TEST_USER.password)
        await page.getByRole('button', { name: /sign in/i }).click()

        // Wait for main app to load
        await page.waitForSelector('header.md\\:fixed, nav.fixed.bottom-0', { state: 'visible', timeout: 30000 })
        console.log('✅ Signed in successfully')

        // Handle onboarding modal if it appears after sign-in
        await dismissOnboardingModal(page)
        return
      }

      // Wait a bit more for either state
      await page.waitForSelector('header.md\\:fixed, nav.fixed.bottom-0, form', { state: 'visible', timeout: 10000 })

      // Check again
      const appNowVisible = await page.locator('header.md\\:fixed, nav.fixed.bottom-0').first().isVisible().catch(() => false)
      if (!appNowVisible) {
        throw new Error('Could not authenticate - neither app nor auth form visible')
      }

      // Handle onboarding modal if it appears
      await dismissOnboardingModal(page)
    }
    await use(setup)
  },

  signIn: async ({ page }, use) => {
    const signIn = async (email = TEST_USER.email, password = TEST_USER.password) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      // Fill in the sign in form
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: /sign in/i }).click()

      // Wait for navigation to complete
      await page.waitForURL('/', { timeout: 10000 })
      await page.waitForSelector('nav, header', { state: 'visible' })
    }
    await use(signIn)
  },

  signOut: async ({ page }, use) => {
    const signOut = async () => {
      // Look for sign out button in header
      const signOutButton = page.getByRole('button', { name: /sign out|exit/i })
      if (await signOutButton.isVisible()) {
        await signOutButton.click()
        // Wait for auth form to appear
        await page.waitForSelector('form', { state: 'visible' })
      }
    }
    await use(signOut)
  },

  navigateToTab: async ({ page }, use) => {
    const navigateToTab = async (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => {
      const viewport = page.viewportSize()
      const isMobile = viewport && viewport.width < 768

      // Tab name mapping for display text
      const tabNames: Record<string, string> = {
        planner: 'Planner',
        recipes: 'Recipes',
        shopping: 'Shopping',
        pantry: 'Pantry',
      }
      const tabName = tabNames[tab] || tab

      if (isMobile) {
        // Use bottom navigation on mobile - try multiple selectors
        let navButton = page.locator('nav.fixed.bottom-0').getByRole('button', { name: new RegExp(tabName, 'i') })

        // Fallback: look for any nav at the bottom
        if (!(await navButton.isVisible().catch(() => false))) {
          navButton = page.locator('nav').last().getByRole('button', { name: new RegExp(tabName, 'i') })
        }

        await navButton.click()
      } else {
        // Use header navigation on desktop - try multiple selectors
        let navButton = page.locator('header.md\\:fixed').getByRole('button', { name: new RegExp(tabName, 'i') })

        // Fallback: look for header button
        if (!(await navButton.isVisible().catch(() => false))) {
          navButton = page.locator('header').first().getByRole('button', { name: new RegExp(tabName, 'i') })
        }

        // Fallback: look for any button with tab name
        if (!(await navButton.isVisible().catch(() => false))) {
          navButton = page.getByRole('button', { name: new RegExp(tabName, 'i') }).first()
        }

        await navButton.click()
      }

      // Wait for content to load
      await page.waitForTimeout(300)
    }
    await use(navigateToTab)
  },

  addRecipe: async ({ page }, use) => {
    const addRecipe = async (recipe: typeof SAMPLE_RECIPE) => {
      const dialog = page.locator('[role="dialog"]')

      // Click add recipe button
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Wait for dialog to open
      await dialog.waitFor({ state: 'visible', timeout: 5000 })
      await page.waitForTimeout(500) // Give dialog time to fully render

      // Add unique suffix to recipe name to avoid duplicates across test runs
      const uniqueName = `${recipe.name} ${Date.now()}`

      // Fill in recipe name - use ID selector (name-add for add mode, name-edit for edit mode)
      const nameInput = dialog.locator('#name-add, #name-edit').first()
      await nameInput.waitFor({ state: 'visible', timeout: 5000 })
      await nameInput.fill(uniqueName)

      // Select category - click trigger then select option
      const categoryTrigger = dialog.getByRole('combobox').first()
      await categoryTrigger.waitFor({ state: 'visible', timeout: 5000 })
      await categoryTrigger.click()
      await page.waitForTimeout(300)

      // Find and click the category option - try exact match first, then partial match
      let categoryOption = page.getByRole('option', { name: new RegExp(`^${recipe.category}$`, 'i') })
      let optionVisible = await categoryOption.isVisible().catch(() => false)

      if (!optionVisible) {
        // Try partial match
        categoryOption = page.getByRole('option', { name: new RegExp(recipe.category, 'i') }).first()
        optionVisible = await categoryOption.isVisible().catch(() => false)
      }

      if (!optionVisible) {
        // Just pick the first available option
        console.log(`Category "${recipe.category}" not found, selecting first available`)
        categoryOption = page.getByRole('option').first()
      }

      await categoryOption.waitFor({ state: 'visible', timeout: 5000 })
      await categoryOption.click()
      await page.waitForTimeout(200)

      // Fill in servings
      const servingsInput = dialog.locator('input[type="number"]').first()
      if (await servingsInput.isVisible().catch(() => false)) {
        await servingsInput.clear()
        await servingsInput.fill(recipe.servings.toString())
      }

      // Add ingredients - the dialog starts with one empty ingredient row
      for (let i = 0; i < recipe.ingredients.length; i++) {
        const ingredient = recipe.ingredients[i]

        // If not the first ingredient, add a new row first
        if (i > 0) {
          const addBtn = dialog.locator('button').filter({ hasText: /add row|add ingredient/i }).first()
          if (await addBtn.isVisible().catch(() => false)) {
            await addBtn.click()
            await page.waitForTimeout(200)
          }
        }

        // Fill the last ingredient row (the one we just added or the initial one)
        const amountInputs = dialog.locator('input[placeholder="Amt"]')
        const itemInputs = dialog.locator('input[placeholder="Ingredient"]')

        const amountInput = amountInputs.last()
        const itemInput = itemInputs.last()

        if (await amountInput.isVisible().catch(() => false)) {
          await amountInput.scrollIntoViewIfNeeded()
          await amountInput.fill(ingredient.amount)
        }
        if (await itemInput.isVisible().catch(() => false)) {
          await itemInput.fill(ingredient.item)
        }
      }

      // Scroll to instructions and fill
      const instructionsTextarea = dialog.locator('textarea').first()
      if (await instructionsTextarea.isVisible().catch(() => false)) {
        await instructionsTextarea.scrollIntoViewIfNeeded()
        await instructionsTextarea.fill(recipe.instructions)
      }

      // Save recipe - wait for button to be enabled then click
      const saveButton = dialog.getByRole('button', { name: /save changes|add recipe/i }).first()
      await saveButton.scrollIntoViewIfNeeded()

      // Check if button is enabled - if not, log form state for debugging
      const isEnabled = await saveButton.isEnabled().catch(() => false)
      if (!isEnabled) {
        const nameValue = await nameInput.inputValue().catch(() => 'unknown')
        const ingredientCount = await dialog.locator('input[placeholder="Ingredient"]').count()
        console.log(`Save button disabled. Name: "${nameValue}", Ingredients: ${ingredientCount}`)

        // Try to get the button's title attribute which may have the reason
        const title = await saveButton.getAttribute('title')
        if (title) {
          console.log(`Button disabled reason: ${title}`)
        }
      }

      // Wait for button to not be disabled (form validation passed)
      await expect(saveButton).toBeEnabled({ timeout: 5000 })
      await saveButton.click()

      // Wait for dialog to close - poll with shorter intervals
      for (let attempt = 0; attempt < 30; attempt++) {
        await page.waitForTimeout(500)
        const stillOpen = await dialog.isVisible().catch(() => false)
        if (!stillOpen) {
          return // Success!
        }

        // Check for loading state on button
        const buttonText = await saveButton.textContent().catch(() => '')
        if (buttonText?.includes('Saving') || buttonText?.includes('Uploading')) {
          continue // Still saving, wait more
        }

        // Check if button is enabled again (save completed but dialog didn't close)
        if (await saveButton.isEnabled().catch(() => false)) {
          if (attempt === 10) {
            console.log('Dialog still open after save, trying again...')
            await saveButton.click()
          }
        }
      }

      // Final check - if dialog is still open, throw error with details
      if (await dialog.isVisible().catch(() => false)) {
        const buttonText = await saveButton.textContent().catch(() => 'unknown')
        const errorText = await dialog.locator('.text-destructive, .text-red-500').textContent().catch(() => null)
        throw new Error(`Recipe dialog did not close. Button: "${buttonText}", Error: ${errorText || 'none visible'}`)
      }
    }
    await use(addRecipe)
  },

  waitForAppLoad: async ({ page }, use) => {
    const waitForAppLoad = async () => {
      await page.waitForLoadState('networkidle')
      // Wait for either auth form or main app to be visible
      await page.waitForSelector('form, nav, header', { state: 'visible' })
    }
    await use(waitForAppLoad)
  },

  getActiveTab: async ({ page }, use) => {
    const getActiveTab = async () => {
      const viewport = page.viewportSize()
      const isMobile = viewport && viewport.width < 768

      if (isMobile) {
        // Check bottom nav for active state
        const activeButton = page.locator('nav.fixed.bottom-0 button.text-primary')
        const text = await activeButton.textContent()
        return text?.toLowerCase() || null
      } else {
        // Check header nav for active state
        const activeButton = page.locator('header.md\\:fixed button.text-primary.border-b-2')
        const text = await activeButton.textContent()
        return text?.toLowerCase() || null
      }
    }
    await use(getActiveTab)
  },

  isMobileViewport: async ({ page }, use) => {
    const isMobileViewport = async () => {
      const viewport = page.viewportSize()
      return viewport ? viewport.width < 768 : false
    }
    await use(isMobileViewport)
  },
})

export { expect }

/**
 * Helper to check for accessibility violations using axe-core
 */
export async function checkAccessibility(page: Page, options?: {
  exclude?: string[]
  include?: string[]
}) {
  // Inject axe-core if not already loaded
  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.2/axe.min.js',
  })

  // Run axe analysis
  const results = await page.evaluate((opts) => {
    return (window as any).axe.run(opts?.include || document, {
      rules: {
        // Disable rules that might conflict with the design system
        'color-contrast': { enabled: true },
      },
      exclude: opts?.exclude || [],
    })
  }, options)

  return results
}

/**
 * Helper to measure touch target sizes
 */
export async function measureTouchTarget(locator: Locator): Promise<{ width: number; height: number }> {
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error('Element not visible')
  }
  return { width: box.width, height: box.height }
}

/**
 * Minimum touch target size (44x44px per WCAG)
 */
export const MIN_TOUCH_TARGET = 44
