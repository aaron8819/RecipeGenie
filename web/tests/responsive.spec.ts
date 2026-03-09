import { test, expect, VIEWPORTS } from './fixtures'

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
    const addRecipeFab = page.getByRole('button', { name: /^add recipe$/i })

    await expect(searchInput).toBeVisible()
    await expect(addRecipeFab).toBeVisible()

    const searchBox = await searchInput.boundingBox()
    const addRecipeBox = await addRecipeFab.boundingBox()
    expect(searchBox).not.toBeNull()
    expect(addRecipeBox).not.toBeNull()
    expect(searchBox!.x).toBeGreaterThanOrEqual(0)
    expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    expect(addRecipeBox!.x + addRecipeBox!.width).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.width)
    expect(addRecipeBox!.y + addRecipeBox!.height).toBeLessThanOrEqual(VIEWPORTS.mobileSmall.height)
  })

  test('keeps shopping list primary controls reachable above the mobile shell chrome', async ({ page, setupAuth, navigateToTab }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await navigateToTab('shopping')
    await dismissNextDevTools(page)

    const heading = page.getByRole('heading', { name: 'Shopping List' }).first()
    const addItemInput = page.getByRole('textbox', { name: /add item/i })
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
})
