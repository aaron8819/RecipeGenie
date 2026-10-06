import { test, expect } from './fixtures'
import { checkCardMenu } from './recipe-card-menu-checks'

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
  test(`@extended card menu stays reachable with 20 tags at ${viewport.width}px`, async ({ page, setupAuth, browserName, isMobile }) => {
    await page.setViewportSize(viewport)
    await setupAuth()
    // Replace only recipe reads in this test context. No account data is changed.
    await page.route('**/rest/v1/recipes?**', async route => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      const rows = await response.json()
      expect(rows.length).toBeGreaterThan(0)
      const tags = ['Menu regression', ...Array.from({ length: 18 }, (_, i) => `Tag ${i + 1}`), 'W'.repeat(50)]
      await route.fulfill({ response, json: Array.from({ length: 12 }, (_, index) => ({
        ...rows[0], id: index + 1,
        recipe_uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        name: `Menu regression ${index + 1}`, tags,
      })) })
    })
    await page.goto('/recipes?view=list')
    await expect(page.locator('.recipe-collection-card')).toHaveCount(12)
    for (const mode of ['list', 'grid']) {
      await page.getByRole('button', { name: mode === 'list' ? 'List view' : 'Grid view', exact: true }).click()
      for (const index of [0, 11]) {
        await page.locator('.recipe-collection-card').nth(index).scrollIntoViewIfNeeded()
        await checkCardMenu(page, await page.locator('.recipe-collection-card').nth(index).getAttribute('data-recipe-name') as string, browserName !== 'webkit' || !isMobile)
      }
    }
  })
}
