import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Page, type Locator } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import {
  E2E_AUTH_DIR,
  E2E_CONFIG,
  TEST_USER,
  assertRecipeGenieAppShell,
  assertStorageStateContainsNoCredentials,
  createStorageStatePaths,
  dismissOnboardingModal,
  ensureDirectory,
  isRecipeGenieAppShellVisible,
  removeRuntimeAuthFiles,
  signInToRecipeGenie,
  waitForRecipeGenieSurface,
  writeStorageMetadata,
} from './e2e-env'

export { TEST_USER }

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

function hasSupabaseEnvVar(key: string): boolean {
  if (process.env[key]) return true

  const candidateFiles = ['.env.local', '.env']
  for (const file of candidateFiles) {
    const filePath = path.resolve(process.cwd(), file)
    if (!fs.existsSync(filePath)) continue

    const contents = fs.readFileSync(filePath, 'utf8')
    const lineRegex = new RegExp(`^\\s*${key}\\s*=\\s*.+$`, 'm')
    if (lineRegex.test(contents)) return true
  }

  return false
}

function assertE2EEnv() {
  const missing: string[] = []

  if (!hasSupabaseEnvVar('NEXT_PUBLIC_SUPABASE_URL')) {
    missing.push('NEXT_PUBLIC_SUPABASE_URL')
  }

  if (!hasSupabaseEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
    missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  }

  if (missing.length > 0) {
    throw new Error(`E2E smoke preflight failed. Missing required configuration: ${missing.join(', ')}`)
  }
}

/**
 * Custom test fixture with helper methods
 */
export interface RecipeGenieFixtures {
  /** Set up authenticated session - navigates to app (already logged in via worker auth state) */
  setupAuth: () => Promise<void>
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
  storageState: async ({ browser }, use, testInfo) => {
    assertE2EEnv()
    ensureDirectory(E2E_AUTH_DIR)
    const { statePath, metadataPath } = createStorageStatePaths(testInfo.testId)
    const authContext = await browser.newContext({ baseURL: E2E_CONFIG.baseURL })
    const authPage = await authContext.newPage()

    try {
      await signInToRecipeGenie(authPage)
      await dismissOnboardingModal(authPage)
      await authContext.storageState({ path: statePath })
      assertStorageStateContainsNoCredentials(statePath, E2E_CONFIG)
      writeStorageMetadata(metadataPath, E2E_CONFIG)
      await authContext.close()
    } catch (error) {
      await authContext.close().catch(() => undefined)
      removeRuntimeAuthFiles(statePath, metadataPath)
      const safeReason = error instanceof Error && error.message.startsWith('Recipe Genie')
        ? error.message
        : 'Recipe Genie authentication failed at an unknown stage'
      throw new Error(`Failed to establish isolated runtime authentication state: ${safeReason}`)
    }

    try {
      await use(statePath)
    } finally {
      removeRuntimeAuthFiles(statePath, metadataPath)
    }
  },

  setupAuth: async ({ page }, use) => {
    const setup = async () => {
      await page.goto('/')
      const initialState = await waitForRecipeGenieSurface(page, 45000)

      if (initialState === 'app') {
        await assertRecipeGenieAppShell(page, 45000)
        await dismissOnboardingModal(page)
        return
      }

      if (initialState === 'auth') throw new Error('Runtime authentication state was not accepted')
    }

    await use(setup)
  },

  signOut: async ({ page }, use) => {
    const signOut = async () => {
      const signOutButton = page.getByRole('button', { name: /sign out|exit/i })
      if (await signOutButton.isVisible()) {
        await signOutButton.click()
        await page.waitForSelector('form', { state: 'visible' })
      }
    }

    await use(signOut)
  },

  navigateToTab: async ({ page }, use) => {
    const navigateToTab = async (tab: 'planner' | 'recipes' | 'shopping' | 'pantry') => {
      const viewport = page.viewportSize()
      const isMobile = viewport && viewport.width < 768

      const tabNames: Record<string, string> = {
        planner: 'Planner',
        recipes: 'Recipes',
        shopping: 'Shopping',
        pantry: 'Pantry',
      }
      const tabName = tabNames[tab] || tab

      if (isMobile) {
        let navButton = page.locator('nav.fixed.bottom-0').getByRole('button', { name: new RegExp(tabName, 'i') })

        if (!(await navButton.isVisible().catch(() => false))) {
          navButton = page.locator('nav').last().getByRole('button', { name: new RegExp(tabName, 'i') })
        }

        // The Next.js development portal can overlap the bottom-left Planner target.
        // Dispatch through the button itself so responsive navigation tests exercise
        // the app handler instead of the development-only overlay geometry.
        await navButton.evaluate((button: HTMLButtonElement) => button.click())
      } else {
        const navButton = page
          .getByRole('navigation')
          .getByRole('button', { name: new RegExp(`^${tabName}$`, 'i') })
          .first()
        await expect(navButton).toBeVisible()
        await navButton.click()
      }

      await page.waitForTimeout(300)
    }

    await use(navigateToTab)
  },

  addRecipe: async ({ page }, use) => {
    const addRecipe = async (recipe: typeof SAMPLE_RECIPE) => {
      const dialog = page.locator('[role="dialog"]')

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await dialog.waitFor({ state: 'visible', timeout: 5000 })
      await page.waitForTimeout(500)

      const uniqueName = `${recipe.name} ${Date.now()}`
      const nameInput = dialog.locator('#name-add, #name-edit').first()
      await nameInput.waitFor({ state: 'visible', timeout: 5000 })
      await nameInput.fill(uniqueName)

      const categoryTrigger = dialog.getByRole('combobox').first()
      await categoryTrigger.waitFor({ state: 'visible', timeout: 5000 })
      await categoryTrigger.click()
      await page.waitForTimeout(300)

      let categoryOption = page.getByRole('option', { name: new RegExp(`^${recipe.category}$`, 'i') })
      let optionVisible = await categoryOption.isVisible().catch(() => false)

      if (!optionVisible) {
        categoryOption = page.getByRole('option', { name: new RegExp(recipe.category, 'i') }).first()
        optionVisible = await categoryOption.isVisible().catch(() => false)
      }

      if (!optionVisible) {
        console.log(`Category "${recipe.category}" not found, selecting first available`)
        categoryOption = page.getByRole('option').first()
      }

      await categoryOption.waitFor({ state: 'visible', timeout: 5000 })
      await categoryOption.click()
      await page.waitForTimeout(200)

      const servingsInput = dialog.locator('input[type="number"]').first()
      if (await servingsInput.isVisible().catch(() => false)) {
        await servingsInput.clear()
        await servingsInput.fill(recipe.servings.toString())
      }

      for (let i = 0; i < recipe.ingredients.length; i++) {
        const ingredient = recipe.ingredients[i]

        if (i > 0) {
          const addBtn = dialog.locator('button').filter({ hasText: /add row|add ingredient/i }).first()
          if (await addBtn.isVisible().catch(() => false)) {
            await addBtn.click()
            await page.waitForTimeout(200)
          }
        }

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

      const instructionsTextarea = dialog.locator('textarea').first()
      if (await instructionsTextarea.isVisible().catch(() => false)) {
        await instructionsTextarea.scrollIntoViewIfNeeded()
        await instructionsTextarea.fill(recipe.instructions)
      }

      const saveButton = dialog.getByRole('button', { name: /save changes|add recipe/i }).first()
      await saveButton.scrollIntoViewIfNeeded()

      const isEnabled = await saveButton.isEnabled().catch(() => false)
      if (!isEnabled) {
        const nameValue = await nameInput.inputValue().catch(() => 'unknown')
        const ingredientCount = await dialog.locator('input[placeholder="Ingredient"]').count()
        console.log(`Save button disabled. Name: "${nameValue}", Ingredients: ${ingredientCount}`)

        const title = await saveButton.getAttribute('title')
        if (title) {
          console.log(`Button disabled reason: ${title}`)
        }
      }

      await expect(saveButton).toBeEnabled({ timeout: 5000 })
      await saveButton.click()

      for (let attempt = 0; attempt < 30; attempt++) {
        await page.waitForTimeout(500)
        const stillOpen = await dialog.isVisible().catch(() => false)
        if (!stillOpen) {
          return
        }

        const buttonText = await saveButton.textContent().catch(() => '')
        if (buttonText?.includes('Saving') || buttonText?.includes('Uploading')) {
          continue
        }

        if (await saveButton.isEnabled().catch(() => false)) {
          if (attempt === 10) {
            console.log('Dialog still open after save, trying again...')
            await saveButton.click()
          }
        }
      }

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
      const surface = await waitForRecipeGenieSurface(page, 45000)
      if (surface !== 'app' || !(await isRecipeGenieAppShellVisible(page))) {
        throw new Error(`Recipe Genie app shell was not ready. URL=${page.url()}`)
      }
    }

    await use(waitForAppLoad)
  },

  getActiveTab: async ({ page }, use) => {
    const getActiveTab = async () => {
      const viewport = page.viewportSize()
      const isMobile = viewport && viewport.width < 768

      if (isMobile) {
        const activeButton = page.locator('nav.fixed.bottom-0 button.text-primary')
        const text = await activeButton.textContent()
        return text?.toLowerCase() || null
      }

      const activeButton = page.locator('header.md\\:fixed button.text-primary.border-b-2')
      const text = await activeButton.textContent()
      return text?.toLowerCase() || null
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
  const builder = new AxeBuilder({ page }).withRules(['color-contrast'])

  for (const selector of options?.include || []) {
    builder.include(selector)
  }

  for (const selector of options?.exclude || []) {
    builder.exclude(selector)
  }

  return builder.analyze()
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
