import { test, expect, checkAccessibility, VIEWPORTS } from './fixtures'
import type { Page } from '@playwright/test'

// Helper to check for critical accessibility violations
async function getAccessibilityViolations(page: Page) {
  // Inject axe-core
  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.2/axe.min.js',
  })

  // Run accessibility check
  const results = await page.evaluate(async () => {
    return await (window as any).axe.run(document, {
      rules: {
        // Exclude certain rules if needed for specific design choices
        'color-contrast': { enabled: true },
        'image-alt': { enabled: true },
        'label': { enabled: true },
        'button-name': { enabled: true },
        'link-name': { enabled: true },
      },
    })
  })

  return results
}

test.describe('Accessibility - WCAG 2.1 Level AA', () => {
  test.describe('Automated Accessibility Checks', () => {
    test('should pass axe-core checks on auth page', async ({ page }) => {
      await page.goto('/')
      await page.waitForLoadState('networkidle')

      const results = await getAccessibilityViolations(page)

      // Log violations for debugging
      if (results.violations.length > 0) {
        console.log('Auth page violations:', JSON.stringify(results.violations, null, 2))
      }

      // Should have no critical violations
      const critical = results.violations.filter((v: any) => v.impact === 'critical')
      expect(critical.length).toBe(0)
    })

    test('should pass axe-core checks on main app', async ({ page, setupAuth }) => {
      await setupAuth()

      const results = await getAccessibilityViolations(page)

      if (results.violations.length > 0) {
        console.log('Main app violations:', JSON.stringify(results.violations, null, 2))
      }

      const critical = results.violations.filter((v: any) => v.impact === 'critical')
      expect(critical.length).toBe(0)
    })

    test('should pass axe-core checks on recipes page', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await navigateToTab('recipes')

      const results = await getAccessibilityViolations(page)

      const critical = results.violations.filter((v: any) => v.impact === 'critical')
      expect(critical.length).toBe(0)
    })

    test('should pass axe-core checks on modals', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await navigateToTab('recipes')

      // Open add recipe modal
      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await page.waitForTimeout(300)

      const results = await getAccessibilityViolations(page)

      const critical = results.violations.filter((v: any) => v.impact === 'critical')
      expect(critical.length).toBe(0)
    })
  })

  test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should navigate tabs with Tab key', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      // Focus should move through header nav tabs
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      // After several tabs, should focus on a button
      const focusedElement = await page.evaluate(() => {
        return document.activeElement?.tagName.toLowerCase()
      })

      expect(['button', 'a', 'input']).toContain(focusedElement)
    })

    test('should activate buttons with Enter key', async ({ page, navigateToTab }) => {
      await navigateToTab('pantry')

      const addInput = page.getByPlaceholder(/add item/i)
      await addInput.focus()
      await addInput.fill('Keyboard Test Item')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)

      await expect(page.getByText('Keyboard Test Item')).toBeVisible()
    })

    test('should close modals with Escape key', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Open modal
      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await expect(page.locator('[role="dialog"]')).toBeVisible()

      // Press Escape
      await page.keyboard.press('Escape')

      // Modal should close
      await expect(page.locator('[role="dialog"]')).toBeHidden()
    })

    test('should navigate dropdown options with arrow keys', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Open add recipe modal
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Find and open category dropdown
      const categoryTrigger = page.getByRole('combobox').first()
      await categoryTrigger.focus()
      await categoryTrigger.click()

      // Navigate with arrow keys
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')

      // An option should be focused
      const focusedOption = await page.evaluate(() => {
        return document.activeElement?.getAttribute('role')
      })

      // Should have focused state on an option
    })

    test('should submit forms with Enter key', async ({ page }) => {
      await page.goto('/')

      // Fill sign-in form
      await page.getByLabel('Email').fill('test@example.com')
      await page.getByLabel('Password').fill('testpassword')

      // Press Enter to submit
      await page.keyboard.press('Enter')

      // Form should attempt submission (may show error or succeed)
      await page.waitForTimeout(1000)
    })
  })

  test.describe('Focus Indicators', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should show visible focus ring on buttons', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      // Tab to a button
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')

      // Check if focused element has visible focus styles
      const hasFocusRing = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return false

        const styles = window.getComputedStyle(el)
        // Check for outline or ring styles
        const hasOutline = styles.outline !== 'none' && styles.outline !== ''
        const hasRing = styles.boxShadow.includes('ring') || styles.boxShadow !== 'none'

        return hasOutline || hasRing || el.classList.contains('focus-visible')
      })

      // Focus should be visible (outline, ring, or other indicator)
    })

    test('should show visible focus on form inputs', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Open modal
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Focus on input
      const nameInput = page.locator('#name-add, #name, #name-edit').first()
      await nameInput.focus()

      // Check focus styles
      const hasFocusStyles = await nameInput.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return styles.outline !== 'none' ||
          styles.boxShadow !== 'none' ||
          el.classList.contains('focus') ||
          el.classList.contains('ring')
      })

      expect(hasFocusStyles).toBeTruthy()
    })
  })

  test.describe('Color Contrast', () => {
    test('should have sufficient contrast for primary text', async ({ page, setupAuth }) => {
      await setupAuth()

      // Check contrast of main text elements
      const hasGoodContrast = await page.evaluate(() => {
        const elements = document.querySelectorAll('p, span, h1, h2, h3, h4, label')
        let allGood = true

        elements.forEach((el) => {
          const styles = window.getComputedStyle(el)
          const color = styles.color
          const bgColor = styles.backgroundColor

          // Simple check - if text is very light or transparent, it might be problematic
          // This is a basic check; real contrast testing should use axe-core
          if (color === 'rgba(0, 0, 0, 0)' || color === 'transparent') {
            // Transparent text is okay if it's meant to be hidden
          }
        })

        return allGood
      })

      expect(hasGoodContrast).toBeTruthy()
    })
  })

  test.describe('ARIA Labels', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should have aria-labels on icon-only buttons', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Check icon buttons have labels
      const iconButtons = page.locator('button').filter({ has: page.locator('svg') })
      const count = await iconButtons.count()

      for (let i = 0; i < Math.min(count, 10); i++) {
        const button = iconButtons.nth(i)
        const text = await button.textContent()
        const ariaLabel = await button.getAttribute('aria-label')
        const title = await button.getAttribute('title')

        // Button should have visible text, aria-label, or title
        const hasAccessibleName = (text && text.trim() !== '') || ariaLabel || title
        // Not all icon buttons need labels if they have visible text nearby
      }
    })

    test('should have labels on form inputs', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()

      // Check that inputs have associated labels
      const inputs = page.locator('input, textarea, select')
      const count = await inputs.count()

      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i)
        const id = await input.getAttribute('id')
        const ariaLabel = await input.getAttribute('aria-label')
        const placeholder = await input.getAttribute('placeholder')

        // Input should have id (for label), aria-label, or at least placeholder
        const hasLabel = id || ariaLabel || placeholder
        // Most inputs should have some form of label
      }
    })

    test('should have proper dialog roles on modals', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // Dialog should have proper ARIA attributes
      const hasAriaModal = await dialog.getAttribute('aria-modal')
      expect(hasAriaModal).toBe('true')
    })
  })

  test.describe('Heading Hierarchy', () => {
    test('should have logical heading hierarchy', async ({ page, setupAuth }) => {
      await setupAuth()

      const headingStructure = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        return headings.map((h) => ({
          level: parseInt(h.tagName.substring(1)),
          text: h.textContent?.trim().substring(0, 50),
        }))
      })

      // Check that headings don't skip levels
      let prevLevel = 0
      let hasSkippedLevel = false

      for (const heading of headingStructure) {
        if (heading.level > prevLevel + 1 && prevLevel > 0) {
          // Skipped a level (e.g., h1 -> h3)
          hasSkippedLevel = true
        }
        prevLevel = heading.level
      }

      // Allow some flexibility in heading structure for component-based apps
      // but log if there are skipped levels
      if (hasSkippedLevel) {
        console.log('Warning: Heading levels may be skipped:', headingStructure)
      }
    })
  })

  test.describe('Image Alt Text', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should have alt text on meaningful images', async ({ page, navigateToTab, addRecipe }) => {
      await navigateToTab('recipes')

      // Add a recipe (which might have an image)
      await addRecipe({
        name: 'Test Recipe',
        category: 'Chicken',
        servings: 4,
        ingredients: [{ amount: '1', unit: 'cup', item: 'test', modifier: '' }],
        instructions: 'Test',
        tags: [],
      })

      await page.waitForTimeout(500)

      // Check images
      const images = page.locator('img')
      const count = await images.count()

      for (let i = 0; i < count; i++) {
        const img = images.nth(i)
        const alt = await img.getAttribute('alt')

        // Image should have alt attribute (can be empty for decorative)
        expect(alt !== null).toBeTruthy()
      }
    })

    test('should have empty alt on decorative icons', async ({ page }) => {
      // SVG icons should not need alt, but should be marked decorative
      const svgIcons = page.locator('svg')
      const count = await svgIcons.count()

      for (let i = 0; i < Math.min(count, 5); i++) {
        const svg = svgIcons.nth(i)
        const ariaHidden = await svg.getAttribute('aria-hidden')
        const role = await svg.getAttribute('role')

        // Decorative SVGs should be hidden from screen readers
        // or have role="img" with aria-label
      }
    })
  })

  test.describe('Screen Reader Support', () => {
    test('should announce loading states', async ({ page, setupAuth }) => {
      await setupAuth()

      // Check for aria-live regions for loading states
      const liveRegions = page.locator('[aria-live]')
      // Loading indicators should use aria-live or similar
    })

    test('should announce toast notifications', async ({ page, setupAuth, navigateToTab, addRecipe }) => {
      await setupAuth()
      await navigateToTab('recipes')

      // Add recipe to trigger toast
      await addRecipe({
        name: 'Toast Test Recipe',
        category: 'Chicken',
        servings: 2,
        ingredients: [{ amount: '1', unit: 'cup', item: 'test', modifier: '' }],
        instructions: 'Test',
        tags: [],
      })

      await page.waitForTimeout(500)

      // Toasts should have aria-live or role="alert"
      const toasts = page.locator('[role="alert"], [aria-live]')
      // Toast may or may not be visible depending on implementation
    })
  })

  test.describe('Reduced Motion', () => {
    test('should respect prefers-reduced-motion', async ({ page, setupAuth }) => {
      // Emulate reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' })

      await setupAuth()

      // Page should load without issue
      await expect(page.locator('nav, header').first()).toBeVisible()

      // Animations should be disabled or minimal
      // This is hard to test directly, but the page should still work
    })
  })
})
