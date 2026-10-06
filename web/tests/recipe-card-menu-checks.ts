import { expect, type Page } from '@playwright/test'

// Shared by the authenticated regression and the retained before/after harness.
export async function checkCardMenu(page: Page, recipeName: string, exerciseWheel = true) {
  const trigger = page.getByRole('button', { name: `Actions for ${recipeName}`, exact: true })
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await page.waitForFunction(() => document.querySelector('[role="menu"]')
    ?.getAnimations().every(animation => animation.playState === 'finished'))
  const geometry = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      overflowY: getComputedStyle(element).overflowY,
    }
  })
  expect(geometry.left).toBeGreaterThanOrEqual(7)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 7)
  expect(geometry.top).toBeGreaterThanOrEqual(7)
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight - 7)
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth)
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight)
  expect(geometry.overflowY).toBe('auto')
  const items = menu.getByRole('menuitem')
  await expect(items).toHaveCount(23)
  await expect(items.last()).toHaveText(`Filter by ${'W'.repeat(50)}`)
  const wrappedLines = await items.last().locator('span').evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return range.getClientRects().length
  })
  expect(wrappedLines).toBeGreaterThan(1)
  // Allow subpixel scroll/border rounding (less than 1px for a 44px item).
  const visibleRatio = 0.98
  // Playwright does not support wheel input in mobile WebKit.
  if (exerciseWheel) {
    await page.mouse.move((geometry.left + geometry.right) / 2, (geometry.top + geometry.bottom) / 2)
    await page.mouse.wheel(0, 10000)
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBe(0)
  }
  // A stationary pointer over a scrolling item can change Radix's focused item.
  await page.mouse.move(0, 0)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await menu.focus()

  // Radix must scroll focused items into view, including the wrapped last tag.
  await page.keyboard.press('Home')
  await expect(items.first()).toBeFocused()
  for (let index = 1; index < 23; index++) {
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(index)).toBeFocused()
    await expect(items.nth(index)).toBeInViewport({ ratio: visibleRatio })
  }
  await page.keyboard.press('Home')
  await expect(items.first()).toBeFocused()
  await expect(items.first()).toBeInViewport({ ratio: visibleRatio })
  await page.keyboard.press('End')
  await expect(items.last()).toBeFocused()
  await expect(items.last()).toBeInViewport({ ratio: visibleRatio })

  // Scroll both ways independently of keyboard focus; every touch target fits.
  for (let index = 22; index >= 0; index--) {
    await items.nth(index).scrollIntoViewIfNeeded()
    await expect(items.nth(index)).toBeInViewport({ ratio: visibleRatio })
    const box = await items.nth(index).boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(trigger).toBeFocused()
  return geometry
}
