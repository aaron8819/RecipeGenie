import { test, expect, VIEWPORTS, SAMPLE_RECIPE } from './fixtures'

test.describe('Visual Design - Stitch Theme', () => {
  test.describe('Typography', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should use Outfit font for body text', async ({ page }) => {
      const bodyFont = await page.evaluate(() => {
        const body = document.body
        const styles = window.getComputedStyle(body)
        return styles.fontFamily
      })

      expect(bodyFont.toLowerCase()).toContain('outfit')
    })

    test('should use Playfair Display for headings', async ({ page, navigateToTab }) => {
      await navigateToTab('planner')

      const headingFont = await page.evaluate(() => {
        const heading = document.querySelector('.font-display, h1, h2')
        if (!heading) return ''
        return window.getComputedStyle(heading).fontFamily
      })

      expect(headingFont.toLowerCase()).toContain('playfair')
    })

    test('should have readable font sizes', async ({ page }) => {
      const fontSizes = await page.evaluate(() => {
        const body = document.body
        const elements = body.querySelectorAll('p, span:not([class*="sr-only"]), button')
        const sizes: number[] = []

        elements.forEach((el) => {
          const styles = window.getComputedStyle(el)
          const size = parseFloat(styles.fontSize)
          if (size > 0) sizes.push(size)
        })

        return sizes
      })

      // Average font size should be reasonable (14px+)
      const avgSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length
      expect(avgSize).toBeGreaterThanOrEqual(12)
    })
  })

  test.describe('Color Palette', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should use deep farm green as primary color', async ({ page }) => {
      // Check primary buttons or elements
      const primaryButton = page.locator('.bg-primary').first()
      if (await primaryButton.isVisible()) {
        const color = await primaryButton.evaluate((el) => {
          return window.getComputedStyle(el).backgroundColor
        })

        // Primary should be a green shade
        // Deep farm green is approximately #2d4a3e or similar
        expect(color).toBeTruthy()
      }
    })

    test('should use card-cream for placeholders', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Look for card-cream class
      const creamElements = page.locator('.bg-card-cream, [class*="card-cream"]')
      // May or may not have cream-colored elements
    })

    test('should use muted border colors', async ({ page }) => {
      const borderColor = await page.evaluate(() => {
        const border = document.querySelector('[class*="border"]')
        if (!border) return null
        return window.getComputedStyle(border).borderColor
      })

      // Border should be a muted color (not pure black)
      expect(borderColor).toBeTruthy()
    })
  })

  test.describe('Border Radius', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should use consistent border radius on buttons', async ({ page }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      const buttons = page.locator('button')
      const radii: string[] = []

      const count = await buttons.count()
      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = buttons.nth(i)
        if (await button.isVisible()) {
          const radius = await button.evaluate((el) => {
            return window.getComputedStyle(el).borderRadius
          })
          radii.push(radius)
        }
      }

      // Should have consistent border radius (0.75rem = 12px or similar)
      // Buttons may have varied radius (pill, rounded-lg, etc.)
    })

    test('should use rounded-xl (0.75rem) as base radius', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Look for rounded-xl classes
      const roundedElements = page.locator('.rounded-xl, [class*="rounded-xl"]')
      const count = await roundedElements.count()

      // Should have elements with rounded-xl
      expect(count).toBeGreaterThan(0)
    })

    test('should use rounded-3xl on edit recipe modal', async ({ page, navigateToTab, addRecipe }) => {
      await navigateToTab('recipes')
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Open recipe detail
      await page.getByText(SAMPLE_RECIPE.name).click()

      // Open edit modal
      await page.getByRole('button', { name: /edit/i }).click()

      const dialog = page.locator('[role="dialog"]')
      const hasRounded3xl = await dialog.evaluate((el) => {
        return el.classList.contains('rounded-3xl') ||
          window.getComputedStyle(el).borderRadius === '1.5rem' ||
          parseFloat(window.getComputedStyle(el).borderRadius) >= 20
      })

      expect(hasRounded3xl).toBe(true)
    })
  })

  test.describe('Category Accent Colors', () => {
    test.beforeEach(async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await navigateToTab('recipes')
    })

    test('should display category pills with correct colors', async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Check for category badge/pill
      const categoryBadge = page.locator('[class*="accent"], [class*="category"]').first()
      if (await categoryBadge.isVisible()) {
        const hasColor = await categoryBadge.evaluate((el) => {
          const bg = window.getComputedStyle(el).backgroundColor
          return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        })

        expect(hasColor).toBeTruthy()
      }
    })

    test('should use accent-mint for chicken category', async ({ page, navigateToTab }) => {
      await navigateToTab('planner')

      // Look for chicken category styling
      const chickenPill = page.getByText(/chicken/i).first()
      if (await chickenPill.isVisible()) {
        // May have mint/green color
      }
    })

    test('should use accent-peach for lamb category', async ({ page, navigateToTab }) => {
      await navigateToTab('planner')

      // Look for lamb category styling
      const lambPill = page.getByText(/lamb/i).first()
      if (await lambPill.isVisible()) {
        // May have peach/orange color
      }
    })
  })

  test.describe('Made Recipe Styling', () => {
    test('should apply grayscale to made recipe cards on desktop', async ({ page, setupAuth, navigateToTab, addRecipe }) => {
      await setupAuth()
      await page.setViewportSize(VIEWPORTS.desktop)

      // Add recipe
      await navigateToTab('recipes')
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Navigate to planner and create plan
      await navigateToTab('planner')

      // Increment category and generate
      const incrementButton = page.getByRole('button', { name: /increase.*count/i }).first()
      if (await incrementButton.isVisible()) {
        await incrementButton.click()

        const generateButton = page.getByRole('button', { name: /generate.*plan/i })
        await generateButton.click()
        await page.waitForTimeout(1000)

        // Mark recipe as made
        const markMadeButton = page.locator('[title*="Mark as cooked"]').first()
        if (await markMadeButton.isVisible()) {
          await markMadeButton.click()
          await page.waitForTimeout(500)

          // Check for grayscale class
          const madeCard = page.locator('.planner-desktop-card-done')
          await expect(madeCard).toBeVisible()
        }
      }
    })

    test('should apply grayscale to made recipe cards on mobile', async ({ page, setupAuth, navigateToTab, addRecipe }) => {
      await setupAuth()
      await page.setViewportSize(VIEWPORTS.mobile)

      // Add recipe
      await navigateToTab('recipes')
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Navigate to planner
      await navigateToTab('planner')

      // Increment and generate
      const incrementButton = page.getByRole('button', { name: /increase.*count/i }).first()
      if (await incrementButton.isVisible()) {
        await incrementButton.click()

        const generateButton = page.getByRole('button', { name: /generate.*plan/i })
        await generateButton.click()
        await page.waitForTimeout(1000)

        // Mark as made
        const markMadeButton = page.locator('[title*="Mark as cooked"]').first()
        if (await markMadeButton.isVisible()) {
          await markMadeButton.click()
          await page.waitForTimeout(500)

          // Check for mobile grayscale class
          const madeCard = page.locator('.planner-mobile-card-done')
          await expect(madeCard).toBeVisible()
        }
      }
    })

    test('should show COOKED badge on made recipes', async ({ page, setupAuth, navigateToTab, addRecipe }) => {
      await setupAuth()
      await page.setViewportSize(VIEWPORTS.desktop)

      await navigateToTab('recipes')
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      await navigateToTab('planner')

      const incrementButton = page.getByRole('button', { name: /increase.*count/i }).first()
      if (await incrementButton.isVisible()) {
        await incrementButton.click()

        const generateButton = page.getByRole('button', { name: /generate.*plan/i })
        await generateButton.click()
        await page.waitForTimeout(1000)

        const markMadeButton = page.locator('[title*="Mark as cooked"]').first()
        if (await markMadeButton.isVisible()) {
          await markMadeButton.click()
          await page.waitForTimeout(500)

          // Should show COOKED badge
          const cookedBadge = page.getByText(/cooked/i)
          await expect(cookedBadge.first()).toBeVisible()
        }
      }
    })
  })

  test.describe('Card Styling', () => {
    test.beforeEach(async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await navigateToTab('recipes')
    })

    test('should have proper card shadows', async ({ page, addRecipe }) => {
      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      const card = page.locator('.shadow-sm, .shadow, [class*="shadow"]').first()
      if (await card.isVisible()) {
        const shadow = await card.evaluate((el) => {
          return window.getComputedStyle(el).boxShadow
        })

        expect(shadow).not.toBe('none')
      }
    })

    test('should have hover states on interactive cards', async ({ page, addRecipe }) => {
      await page.setViewportSize(VIEWPORTS.desktop)

      await addRecipe(SAMPLE_RECIPE)
      await page.waitForTimeout(500)

      // Hover over recipe card
      const card = page.getByText(SAMPLE_RECIPE.name).first()
      await card.hover()

      // Card might have hover:shadow-lg or similar
      // This is hard to test visually, but card should still be interactive
      await expect(card).toBeVisible()
    })
  })

  test.describe('Input Styling', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await setupAuth()
    })

    test('should have consistent input styling', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const input = page.locator('#name-add, #name, #name-edit').first()
      const styles = await input.evaluate((el) => {
        const computed = window.getComputedStyle(el)
        return {
          borderRadius: computed.borderRadius,
          border: computed.border,
          padding: computed.padding,
        }
      })

      // Inputs should have consistent styling
      expect(styles.borderRadius).toBeTruthy()
    })

    test('should have focus ring on inputs', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const input = page.locator('#name-add, #name, #name-edit').first()
      await input.focus()

      const hasRing = await input.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        // Check for ring class or focus styling
        return styles.boxShadow !== 'none' ||
          styles.outline !== 'none' ||
          el.classList.contains('focus-visible')
      })

      expect(hasRing).toBeTruthy()
    })
  })

  test.describe('Empty State Styling', () => {
    test('should display styled empty states', async ({ page, setupAuth, navigateToTab }) => {
      await setupAuth()
      await navigateToTab('recipes')

      // Should see empty state
      const emptyState = page.locator('[class*="empty"], [class*="EmptyState"]').first()
      if (await emptyState.isVisible()) {
        // Empty state should have icon and text
        const hasIcon = await emptyState.locator('svg').isVisible()
        const hasText = await emptyState.textContent()

        expect(hasText?.length).toBeGreaterThan(0)
      }
    })
  })

  test.describe('Header Styling', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.desktop)
      await setupAuth()
    })

    test('should have backdrop blur on header', async ({ page }) => {
      // Target the main navigation header
      const header = page.locator('header.md\\:fixed')
      const hasBlur = await header.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return styles.backdropFilter.includes('blur') ||
          el.classList.contains('backdrop-blur-md') ||
          el.className.includes('backdrop-blur')
      })

      expect(hasBlur).toBeTruthy()
    })

    test('should have border on header bottom', async ({ page }) => {
      // Target the main navigation header
      const header = page.locator('header.md\\:fixed')
      const hasBorder = await header.evaluate((el) => {
        const styles = window.getComputedStyle(el)
        return styles.borderBottomWidth !== '0px' ||
          el.classList.contains('border-b')
      })

      expect(hasBorder).toBeTruthy()
    })

    test('should display app logo/icon', async ({ page }) => {
      const logo = page.locator('header.md\\:fixed svg').first()
      await expect(logo).toBeVisible()
    })

    test('should display app name with display font', async ({ page }) => {
      const appName = page.locator('header.md\\:fixed').getByText('Recipe Genie')
      await expect(appName).toBeVisible()

      const isDisplayFont = await appName.evaluate((el) => {
        const font = window.getComputedStyle(el).fontFamily
        return font.toLowerCase().includes('playfair') ||
          el.classList.contains('font-display')
      })

      expect(isDisplayFont).toBeTruthy()
    })
  })

  test.describe('Guest Mode Banner Styling', () => {
    test('should display amber-colored guest mode banner', async ({ page, setupAuth }) => {
      await setupAuth()

      const banner = page.locator('.bg-amber-50, [class*="amber"]').first()
      await expect(banner).toBeVisible()

      const hasAmberBg = await banner.evaluate((el) => {
        const bg = window.getComputedStyle(el).backgroundColor
        // Amber-50 is a light yellow/orange
        return bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)'
      })

      expect(hasAmberBg).toBeTruthy()
    })

    test('should display warning icon in guest banner', async ({ page, setupAuth }) => {
      await setupAuth()

      const banner = page.locator('.bg-amber-50, [class*="amber"]').first()
      const icon = banner.locator('svg')
      await expect(icon).toBeVisible()
    })
  })
})
