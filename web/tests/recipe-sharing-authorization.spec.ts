import { expect, test } from './fixtures'

test.describe('Recipe sharing authorization @extended', () => {
  test('rejects unauthenticated share creation', async ({ page }) => {
    const response = await page.request.post('/api/recipe-shares', {
      data: {
        recipeId: '00000000-0000-0000-0000-000000000001',
        recipientEmail: 'recipient@example.com',
      },
    })

    expect(response.status()).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  test('does not expose or mutate shares the authenticated user does not own', async ({ page, setupAuth }) => {
    await setupAuth()
    const unownedId = '00000000-0000-0000-0000-000000000001'

    const createResponse = await page.request.post('/api/recipe-shares', {
      data: {
        recipeId: unownedId,
        recipientEmail: 'recipient@example.com',
      },
    })
    expect(createResponse.status()).toBe(404)

    const declineResponse = await page.request.post(`/api/recipe-shares/${unownedId}/decline`)
    expect(declineResponse.status()).toBe(404)

    const acceptResponse = await page.request.post(`/api/recipe-shares/${unownedId}/accept`)
    expect(acceptResponse.status()).toBe(400)
  })
})
