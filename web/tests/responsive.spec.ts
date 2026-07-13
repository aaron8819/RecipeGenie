import { test, expect, VIEWPORTS, measureTouchTarget } from './fixtures'

async function dismissNextDevTools(page: import('@playwright/test').Page) {
  const closeButton = page.getByRole('button', { name: /close next\.js dev tools/i })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true })
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('Responsive contracts @extended', () => {
  test('keeps bottom navigation visible and actionable after mobile scrolling', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await dismissNextDevTools(page)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))

    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })
    await expect(bottomNav).toBeVisible()

    const bottomNavBox = await bottomNav.boundingBox()
    expect(bottomNavBox).not.toBeNull()
    expect(bottomNavBox!.y + bottomNavBox!.height).toBeLessThanOrEqual(VIEWPORTS.mobile.height)

    const shoppingButton = bottomNav.getByRole('button', { name: /shopping/i })
    await expect(shoppingButton).toBeVisible()
    await shoppingButton.click()
    await expect(page.getByRole('heading', { name: 'Shopping List' }).first()).toBeVisible()
  })

  test('keeps the recipes mobile primary actions in viewport on small screens', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobileSmall)
    await setupAuth()
    await navigateToTab('recipes')
    await dismissNextDevTools(page)

    const searchInput = page.getByRole('textbox', { name: /search recipes by name or category/i })
    const addRecipeFab = page.getByTestId('recipes-add-fab')
    const filterToggle = page.getByTestId('recipes-filter-toggle')
    const filterPanel = page.getByTestId('recipes-filter-panel')
    const utilitySection = page.locator('section[aria-label="Recipe mobile utilities"]')
    const gridButton = utilitySection.getByRole('button', { name: 'Grid view' })
    const listButton = utilitySection.getByRole('button', { name: 'List view' })
    const sharedButton = utilitySection.getByRole('button', { name: 'Shared' })
    const settingsButton = utilitySection.getByRole('button', { name: 'Settings' })
    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })

    await expect(searchInput).toBeVisible()
    await expect(addRecipeFab).toBeVisible()
    await expect(filterToggle).toBeVisible()
    await expect(filterPanel).toHaveCount(0)

    await filterToggle.click()
    await expect(filterPanel).toBeVisible()
    await expect(filterPanel.getByRole('button', { name: 'Favorites' })).toBeVisible()

    const searchBox = await searchInput.boundingBox()
    const addRecipeBox = await addRecipeFab.boundingBox()
    const bottomNavBox = await bottomNav.boundingBox()
    expect(searchBox).not.toBeNull()
    expect(addRecipeBox).not.toBeNull()
    expect(bottomNavBox).not.toBeNull()
    expect(searchBox!.x).toBeGreaterThanOrEqual(0)
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    expect(await searchInput.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16)
    expect(addRecipeBox!.x + addRecipeBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    expect(addRecipeBox!.y + addRecipeBox!.height).toBeLessThan(bottomNavBox!.y)

    for (const control of [filterToggle, gridButton, listButton, sharedButton, settingsButton]) {
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    }
  })

  test('keeps shopping list primary controls reachable above the mobile shell chrome', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await navigateToTab('shopping')
    await dismissNextDevTools(page)

    const heading = page.getByRole('heading', { name: 'Shopping List' }).first()
    const addItemInput = page.getByPlaceholder(/Add (tomatoes|milk)/).filter({ visible: true })
    const addItemButton = page.getByRole('button', { name: /^add item$/i }).first()
    const bottomNav = page.getByRole('navigation', { name: /bottom navigation/i })

    await expect(heading).toBeVisible()
    await expect(addItemInput).toBeVisible()
    await expect(addItemButton).toBeVisible()
    await expect(bottomNav).toBeVisible()

    const inputBox = await addItemInput.boundingBox()
    const buttonBox = await addItemButton.boundingBox()
    const bottomNavBox = await bottomNav.boundingBox()

    expect(inputBox).not.toBeNull()
    expect(buttonBox).not.toBeNull()
    expect(bottomNavBox).not.toBeNull()
    expect(inputBox!.y + inputBox!.height).toBeLessThan(bottomNavBox!.y)
    expect(buttonBox!.y + buttonBox!.height).toBeLessThan(bottomNavBox!.y)
  })

  test('keeps planner actions visible and touch targets usable at 320px', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobileSmall)
    await setupAuth()
    await navigateToTab('planner')
    await dismissNextDevTools(page)

    const controls = [
      page.getByRole('button', { name: 'Previous week', exact: true }),
      page.getByRole('button', { name: 'Next week', exact: true }),
      page.getByRole('button', { name: 'Open calendar to pick a week', exact: true }),
      page.getByRole('button', { name: 'Open planner settings', exact: true }),
      page.getByRole('button', { name: 'More planner actions', exact: true }),
    ]

    for (const control of controls) {
      await expect(control).toBeVisible()
      const size = await measureTouchTarget(control)
      expect(size.width).toBeGreaterThanOrEqual(44)
      expect(size.height).toBeGreaterThanOrEqual(44)
      const box = await control.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    }

    const decrement = page.getByRole('button', { name: /decrease .* count/i }).first()
    if (await decrement.isVisible().catch(() => false)) {
      const size = await measureTouchTarget(decrement)
      expect(size.width).toBeGreaterThanOrEqual(44)
      expect(size.height).toBeGreaterThanOrEqual(44)
    }

    await page.getByRole('button', { name: 'More planner actions', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Save template', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Load template', exact: true })).toBeVisible()
  })

  test('keeps shared header and pantry section controls mobile-sized', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobileSmall)
    await setupAuth()
    await navigateToTab('pantry')
    await dismissNextDevTools(page)

    const pantrySections = page.getByRole('navigation', { name: 'Pantry sections' })
    const controls = [
      page.getByRole('button', { name: 'Help' }),
      page.getByRole('button', { name: 'Open account menu' }),
      pantrySections.getByRole('button', { name: /Pantry \d+/ }),
      pantrySections.getByRole('button', { name: /Excluded \d+/ }),
    ]

    for (const control of controls) {
      await expect(control).toBeVisible()
      const size = await measureTouchTarget(control)
      expect(size.width).toBeGreaterThanOrEqual(44)
      expect(size.height).toBeGreaterThanOrEqual(44)
    }

    await pantrySections.getByRole('button', { name: /Excluded \d+/ }).click()
    await expect(page.getByRole('heading', { name: /Excluded Keywords/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Pantry Items/i })).toBeHidden()
  })

  test('uses a compact mobile shopping summary without horizontal overflow', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await navigateToTab('shopping')
    await dismissNextDevTools(page)

    const summary = page.getByTestId('shopping-progress-mobile')
    if (await summary.isVisible().catch(() => false)) {
      const box = await summary.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.height).toBeLessThanOrEqual(140)
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(VIEWPORTS.mobile.width)
      await expect(summary.getByRole('button', { name: 'Jump to shopping section' })).toBeVisible()
    }
  })
})
