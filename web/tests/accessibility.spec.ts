import { test, expect, checkAccessibility, VIEWPORTS } from './fixtures'

function summarizeViolations(
  violations: Array<{ id: string; impact?: string | null; nodes: Array<unknown> }>
) {
  return violations.map((violation) => `${violation.id} (${violation.impact ?? 'unknown'}, ${violation.nodes.length} nodes)`)
}

test.describe.configure({ mode: 'serial' })

test.describe('Accessibility @extended', () => {
  test.describe('Unauthenticated', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test('keeps the sign-in screen free of serious axe violations', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByRole('heading', { name: 'Recipe Genie' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
      await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible()

      const results = await checkAccessibility(page)
      const blocking = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))

      expect(
        summarizeViolations(blocking),
        `Found blocking violations on the unauthenticated sign-in screen`
      ).toEqual([])
    })
  })

  test('keeps the authenticated shell and recipes entry surface free of serious axe violations', async ({ page, setupAuth }) => {
    await page.setViewportSize(VIEWPORTS.desktop)
    await setupAuth()

    await expect(page.getByRole('link', { name: /go to planner/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /search recipes by name or category/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^add recipe$/i }).first()).toBeVisible()

    const results = await checkAccessibility(page, { exclude: ['[data-next-badge-root]'] })
    const blocking = results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))

    expect(
      summarizeViolations(blocking),
      `Found blocking violations on the authenticated recipes shell`
    ).toEqual([])
  })

  test('opens and dismisses the add-recipe dialog through keyboard-accessible dialog semantics', async ({ page, setupAuth, navigateToRoute }) => {
    await page.setViewportSize(VIEWPORTS.mobile)
    await setupAuth()
    await navigateToRoute('recipes')

    await page.getByTestId('recipes-add-fab').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog.getByRole('button', { name: /close/i })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /add recipe/i })).toBeVisible()

    await expect.poll(async () => {
      const active = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null
        return element?.closest('[role="dialog"]') !== null
      })
      return active
    }).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('recipes-add-fab')).toBeVisible()
  })
})
