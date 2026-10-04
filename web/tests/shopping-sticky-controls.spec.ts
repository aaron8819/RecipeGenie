import { test, expect } from './fixtures'
import { randomUUID } from 'node:crypto'

test.describe('Shopping sticky controls', () => {
  test('keeps controls and jump targets reachable at 390px and 320px', async ({ page, setupAuth }) => {
    test.setTimeout(180000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await setupAuth()
    await page.goto('/shopping')
    const initialize = page.getByRole('button', { name: 'Update this shopping list', exact: true })
    if (await initialize.isVisible()) await initialize.click()
    const names = Array.from({ length: 36 }, (_, index) => `sticky ${randomUUID().slice(0, 8)} item ${index}`)
    try {
      const input = page.getByLabel('Item name', { exact: true })
      for (let index = 0; index < names.length; index += 6) {
        await input.fill(names.slice(index, index + 6).join(', '))
        await input.press('Enter')
        await expect(input).toHaveValue('', { timeout: 30000 })
      }
      await page.getByRole('button', { name: `Check off ${names[0]}`, exact: true }).click()
      await expect(page.locator('.shopping-active-sections').getByRole('button', { name: `Check off ${names[0]}`, exact: true })).toHaveCount(0)
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 })
        await page.reload()
        await input.waitFor()
        const controls = async () => {
          const geometry = await page.evaluate(() => {
            const add = document.querySelector('.shopping-sticky-add')!.getBoundingClientRect()
            const jump = document.querySelector('.shopping-mobile-sections')!.getBoundingClientRect()
            return { addTop: add.top, addBottom: add.bottom, jumpTop: jump.top,
              jumpBottom: jump.bottom, scrollY, scroller: document.scrollingElement?.tagName,
              bodyScrollTop: document.body.scrollTop, bodyOverflowY: getComputedStyle(document.body).overflowY,
              overflow: document.documentElement.scrollWidth > innerWidth }
          })
          expect(geometry.scrollY).toBeGreaterThan(500)
          expect(geometry.scroller).toBe('HTML')
          expect(geometry.bodyScrollTop).toBe(0)
          expect(geometry.bodyOverflowY).toBe('visible')
          expect(geometry.addTop).toBeCloseTo(0, 0)
          expect(geometry.jumpTop).toBeCloseTo(geometry.addBottom, 0)
          expect(geometry.jumpBottom).toBeLessThan(300)
          expect(geometry.overflow).toBe(false)
          return geometry
        }
        for (const expanded of [false, true]) {
          if (expanded) await page.getByRole('button', { name: 'Details', exact: true }).click()
          await page.evaluate(() => window.scrollTo(0, 1400))
          await expect.poll(async () => (await page.locator('.shopping-sticky-add').boundingBox())?.y).toBe(0)
          await controls()
          await page.locator('.shopping-mobile-sections').getByRole('button', { name: /^Done / }).click()
          const geometry = await controls()
          const target = await page.locator('.shopping-completed').boundingBox()
          expect(target!.y).toBeGreaterThanOrEqual(geometry.jumpBottom)
          expect(target!.y).toBeLessThan(700)
        }
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const finalRow = await page.locator('[data-shopping-row-id]').last().boundingBox()
        const nav = await page.getByRole('navigation', { name: 'Bottom navigation' }).boundingBox()
        expect(finalRow!.y + finalRow!.height).toBeLessThanOrEqual(nav!.y)
      }
      expect(errors).toEqual([])
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.reload()
      await page.locator('.shopping-completed').evaluate((el: HTMLDetailsElement) => { el.open = true })
      for (const name of names) {
        const action = page.getByRole('button', { name: `Actions for ${name}`, exact: true })
        if (await action.count()) {
          await action.click()
          await page.getByRole('menuitem', { name: 'Remove from list', exact: true }).click()
          await expect(action).toHaveCount(0)
        }
      }
    }
  })
})
