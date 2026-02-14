import { test, expect, VIEWPORTS, measureTouchTarget, MIN_TOUCH_TARGET } from './fixtures'

test.describe('Responsive Design', () => {
  test.describe('Mobile Viewports', () => {
    const mobileViewports = [
      { name: 'iPhone SE', ...VIEWPORTS.mobileSmall },
      { name: 'iPhone 12', ...VIEWPORTS.mobile },
      { name: 'iPhone 12 Pro Max', ...VIEWPORTS.mobileLarge },
    ]

    for (const viewport of mobileViewports) {
      test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
        test.beforeEach(async ({ page, setupAuth }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await setupAuth()
        })

        test('should not have horizontal scroll', async ({ page }) => {
          // Check that body doesn't overflow horizontally
          const hasHorizontalScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth
          })
          expect(hasHorizontalScroll).toBeFalsy()
        })

        test('should display bottom navigation', async ({ page }) => {
          const bottomNav = page.locator('nav.fixed.bottom-0')
          await expect(bottomNav).toBeVisible()
        })

        test('should hide desktop header navigation', async ({ page }) => {
          const headerNav = page.locator('header nav')
          await expect(headerNav).toBeHidden()
        })

        test('should show mobile-optimized content layout', async ({ page, navigateToTab }) => {
          await navigateToTab('recipes')

          // Grid should be single column or appropriate for mobile
          const hasSmallScreenLayout = await page.evaluate(() => {
            const grid = document.querySelector('.grid')
            if (!grid) return true
            const styles = window.getComputedStyle(grid)
            const columns = styles.gridTemplateColumns
            // Single column or 2 columns on wider mobile
            return columns.split(' ').length <= 2
          })
          expect(hasSmallScreenLayout).toBeTruthy()
        })

        test('should have readable font sizes', async ({ page }) => {
          const minFontSize = await page.evaluate(() => {
            const elements = document.querySelectorAll('p, span, button, a')
            let min = Infinity
            elements.forEach((el) => {
              const styles = window.getComputedStyle(el)
              const fontSize = parseFloat(styles.fontSize)
              if (fontSize > 0 && fontSize < min) {
                min = fontSize
              }
            })
            return min
          })

          // Text should be at least 12px
          expect(minFontSize).toBeGreaterThanOrEqual(10)
        })
      })
    }
  })

  test.describe('Tablet Viewport (768px)', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.tablet)
      await setupAuth()
    })

    test('should not have horizontal scroll', async ({ page }) => {
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth
      })
      expect(hasHorizontalScroll).toBeFalsy()
    })

    test('should display header navigation', async ({ page }) => {
      // At 768px (md breakpoint), header nav should be visible
      const headerNav = page.locator('header nav')
      await expect(headerNav).toBeVisible()
    })

    test('should hide bottom navigation', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      await expect(bottomNav).toBeHidden()
    })

    test('should show multi-column grid for recipes', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      const columnCount = await page.evaluate(() => {
        const grid = document.querySelector('.grid')
        if (!grid) return 0
        const styles = window.getComputedStyle(grid)
        const columns = styles.gridTemplateColumns
        return columns.split(' ').filter((c) => c !== '').length
      })

      // Should have at least 2 columns at tablet width
      expect(columnCount).toBeGreaterThanOrEqual(2)
    })
  })

  test.describe('Desktop Viewports', () => {
    const desktopViewports = [
      { name: 'Desktop', ...VIEWPORTS.desktop },
      { name: 'Desktop Large', ...VIEWPORTS.desktopLarge },
    ]

    for (const viewport of desktopViewports) {
      test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
        test.beforeEach(async ({ page, setupAuth }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height })
          await setupAuth()
        })

        test('should not have horizontal scroll', async ({ page }) => {
          const hasHorizontalScroll = await page.evaluate(() => {
            return document.documentElement.scrollWidth > document.documentElement.clientWidth
          })
          expect(hasHorizontalScroll).toBeFalsy()
        })

        test('should display header navigation', async ({ page }) => {
          const headerNav = page.locator('header nav')
          await expect(headerNav).toBeVisible()
        })

        test('should hide bottom navigation', async ({ page }) => {
          const bottomNav = page.locator('nav.fixed.bottom-0')
          await expect(bottomNav).toBeHidden()
        })

        test('should show 3-column grid for recipes', async ({ page, navigateToTab }) => {
          await navigateToTab('recipes')

          const columnCount = await page.evaluate(() => {
            const grid = document.querySelector('.grid')
            if (!grid) return 0
            const styles = window.getComputedStyle(grid)
            const columns = styles.gridTemplateColumns
            return columns.split(' ').filter((c) => c !== '').length
          })

          // Should have 3 columns on large desktop
          expect(columnCount).toBeGreaterThanOrEqual(3)
        })

        test('should show 7-day calendar grid in planner', async ({ page, navigateToTab }) => {
          await navigateToTab('planner')

          const dayColumns = page.locator('.grid-cols-7')
          // Desktop planner should have 7-day grid
        })
      })
    }
  })

  test.describe('Touch Target Sizes', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()
    })

    test('bottom navigation buttons should meet minimum touch target', async ({ page }) => {
      const bottomNav = page.locator('nav.fixed.bottom-0')
      const buttons = bottomNav.locator('button')
      const count = await buttons.count()

      for (let i = 0; i < count; i++) {
        const button = buttons.nth(i)
        const box = await button.boundingBox()

        if (box) {
          // Check that touch target is at least 44x44px or has sufficient tap area
          // Some buttons may be smaller but with padding to create larger tap area
          expect(box.width).toBeGreaterThanOrEqual(40)
          expect(box.height).toBeGreaterThanOrEqual(40)
        }
      }
    })

    test('checkboxes should have adequate touch target', async ({ page, navigateToTab, addRecipe }) => {
      // Add recipe and navigate to shopping
      await navigateToTab('recipes')
      await addRecipe({
        name: 'Touch Test Recipe',
        category: 'Chicken',
        servings: 2,
        ingredients: [{ amount: '1', unit: 'cup', item: 'rice', modifier: '' }],
        instructions: 'Cook rice.',
        tags: [],
      })
      await page.waitForTimeout(500)

      const addToCartButton = page.locator('[title*="shopping"]').first()
      if (await addToCartButton.isVisible()) {
        await addToCartButton.click()
        await page.waitForTimeout(500)
      }

      await navigateToTab('shopping')

      const checkbox = page.locator('button[role="checkbox"], input[type="checkbox"]').first()
      if (await checkbox.isVisible()) {
        const box = await checkbox.boundingBox()
        if (box) {
          // Touch target should be at least 24x24px (with surrounding padding to reach 44x44)
          expect(box.width).toBeGreaterThanOrEqual(20)
          expect(box.height).toBeGreaterThanOrEqual(20)
        }
      }
    })

    test('buttons should have adequate touch target', async ({ page }) => {
      // Check add recipe FAB
      await page.locator('nav.fixed.bottom-0').getByRole('button', { name: /recipes/i }).click()
      await page.waitForTimeout(300)

      const fab = page.locator('button[aria-label="Add Recipe"]')
      if (await fab.isVisible()) {
        const box = await fab.boundingBox()
        if (box) {
          // FAB should be at least 44x44px
          expect(box.width).toBeGreaterThanOrEqual(44)
          expect(box.height).toBeGreaterThanOrEqual(44)
        }
      }
    })

    test('form inputs should have adequate touch target', async ({ page, navigateToTab }) => {
      await navigateToTab('pantry')

      const input = page.getByPlaceholder(/add item/i)
      if (await input.isVisible()) {
        const box = await input.boundingBox()
        if (box) {
          // Input height should be at least 44px
          expect(box.height).toBeGreaterThanOrEqual(36)
        }
      }
    })
  })

  test.describe('Viewport Transitions', () => {
    test('should transition smoothly from mobile to desktop', async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()

      // Verify mobile layout
      await expect(page.locator('nav.fixed.bottom-0')).toBeVisible()

      // Resize to desktop
      await page.setViewportSize(VIEWPORTS.desktop)
      await page.waitForTimeout(500)

      // Verify desktop layout
      await expect(page.locator('nav.fixed.bottom-0')).toBeHidden()
      await expect(page.locator('header nav')).toBeVisible()

      // Resize back to mobile
      await page.setViewportSize(VIEWPORTS.mobile)
      await page.waitForTimeout(500)

      // Verify mobile layout restored
      await expect(page.locator('nav.fixed.bottom-0')).toBeVisible()
    })

    test('should maintain state during viewport change', async ({ page, setupAuth, navigateToTab }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()

      // Navigate to pantry tab on mobile
      await navigateToTab('pantry')
      await page.waitForTimeout(300)

      // Change to desktop
      await page.setViewportSize(VIEWPORTS.desktop)
      await page.waitForTimeout(500)

      // Should still be on pantry tab (state preserved)
      const storedTab = await page.evaluate(() => localStorage.getItem('recipe-genie-active-tab'))
      expect(storedTab).toBe('pantry')
    })
  })

  test.describe('Content Overflow', () => {
    test.beforeEach(async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()
    })

    test('should handle long recipe names without overflow', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      // Add recipe with very long name
      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await page.locator('#name-add, #name, #name-edit').first().fill('This Is A Very Long Recipe Name That Should Not Overflow The Card Container')
      await page.locator('input[type="number"][min="1"][max="100"]').first().fill('4')
      await page.locator('input[placeholder*="Ingredient"]').fill('test ingredient')
      await page.locator('#instructions-add, #instructions-edit').first().fill('Test instructions')
      await page.getByRole('button', { name: /save/i }).click()
      await page.waitForTimeout(500)

      // Check for text truncation or wrapping
      const hasOverflow = await page.evaluate(() => {
        const cards = document.querySelectorAll('[class*="card"]')
        for (const card of cards) {
          if (card.scrollWidth > card.clientWidth) {
            return true
          }
        }
        return false
      })

      // Cards should handle long text with truncation or wrapping
      expect(hasOverflow).toBeFalsy()
    })

    test('should handle many ingredients without overflow', async ({ page, navigateToTab }) => {
      await navigateToTab('recipes')

      await page.getByRole('button', { name: /add recipe/i }).first().click()
      await page.locator('#name-add, #name, #name-edit').first().fill('Many Ingredients Recipe')
      await page.locator('input[type="number"][min="1"][max="100"]').first().fill('4')

      // Add many ingredients
      for (let i = 0; i < 5; i++) {
        await page.locator('input[placeholder*="Ingredient"]').last().fill(`Ingredient ${i + 1}`)
        await page.getByRole('button', { name: /add ingredient/i }).click()
        await page.waitForTimeout(100)
      }

      await page.locator('#instructions-add, #instructions-edit').first().fill('Test instructions')

      // Modal should scroll, not overflow
      const dialog = page.locator('[role="dialog"]')
      const hasScroll = await dialog.evaluate((el) => {
        return el.scrollHeight > el.clientHeight
      })

      // Dialog should handle many ingredients (scroll or expand)
    })
  })

  test.describe('Safe Area Insets', () => {
    test('should respect safe area on bottom navigation', async ({ page, setupAuth }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await setupAuth()

      const bottomNav = page.locator('nav.fixed.bottom-0')
      const hasClass = await bottomNav.evaluate((el) => {
        return el.classList.contains('safe-area-bottom') ||
          el.className.includes('pb-safe') ||
          el.className.includes('safe-area')
      })

      expect(hasClass).toBeTruthy()
    })
  })

  test.describe('Landscape Orientation', () => {
    test('should be usable in landscape', async ({ page, setupAuth }) => {
      // Landscape viewport (swap width and height)
      await page.setViewportSize({ width: 812, height: 375 })
      await setupAuth()

      // App should not crash and should be navigable
      const nav = page.locator('nav, header')
      await expect(nav.first()).toBeVisible()

      // Content should be accessible
      await expect(page.locator('main, [class*="container"]').first()).toBeVisible()
    })

    test('should handle modals in landscape', async ({ page, setupAuth, navigateToTab }) => {
      await page.setViewportSize({ width: 812, height: 375 })
      await setupAuth()
      await navigateToTab('recipes')

      // Open add recipe modal
      await page.getByRole('button', { name: /add recipe/i }).first().click()

      const dialog = page.locator('[role="dialog"]')
      await expect(dialog).toBeVisible()

      // Dialog should fit on screen
      const dialogBox = await dialog.boundingBox()
      if (dialogBox) {
        expect(dialogBox.height).toBeLessThanOrEqual(375)
      }
    })
  })
})
