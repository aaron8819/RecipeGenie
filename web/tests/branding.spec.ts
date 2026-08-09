import { test, expect } from './fixtures'

test.describe('Recipe Genie branding', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wires the install and browser icon assets', async ({ page }) => {
    await page.goto('/recipes', { waitUntil: 'domcontentloaded' })

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.json'
    )
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/apple-touch-icon.png'
    )

    const iconHrefs = await page
      .locator('link[rel="icon"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    expect(iconHrefs).toEqual(
      expect.arrayContaining(['/favicon-32x32.png', '/favicon.ico'])
    )

    const manifestResponse = await page.request.get('/manifest.json')
    expect(manifestResponse.ok()).toBe(true)
    await expect(manifestResponse.json()).resolves.toMatchObject({
      background_color: '#F7F3EA',
      theme_color: '#2F4B34',
      icons: [
        {
          src: '/pwa-icon-192.png',
          sizes: '192x192',
          purpose: 'any maskable',
        },
        {
          src: '/pwa-icon-512.png',
          sizes: '512x512',
          purpose: 'any maskable',
        },
      ],
    })

    for (const asset of [
      '/favicon-32x32.png',
      '/favicon.ico',
      '/apple-touch-icon.png',
      '/pwa-icon-192.png',
      '/pwa-icon-512.png',
    ]) {
      expect((await page.request.get(asset)).ok()).toBe(true)
    }
  })
})
