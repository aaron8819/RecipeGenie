const { chromium, webkit, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

async function verify(browserType, viewport, name) {
  const browser = await browserType.launch();
  const context = await browser.newContext({
    viewport,
    hasTouch: name === 'iphone',
  });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:3115'))
      external.push(request.url());
  });
  await page.goto('http://127.0.0.1:3115');
  await expect(
    page.getByRole('heading', { name: 'Today', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark as cooked', exact: true }),
  ).toHaveCount(2);
  await expect(page.locator('.shopping-items .shopping-row')).toHaveCount(5);
  const screenshotDir = path.join(__dirname, 'verification');
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (name === 'iphone') {
    const positions = await page
      .locator('.today-section, .shopping-section, .week-section')
      .evaluateAll((elements) =>
        elements.map((e) => e.getBoundingClientRect().top),
      );
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
  }
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to another day' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Thursday, Oct 1' })
    .click();
  await expect(page.locator('.today-section .meal-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset scenario' }).click();
  const mealMenu = page
    .locator('.today-section')
    .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' });
  await mealMenu.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(mealMenu).toBeFocused();
  await mealMenu.click();
  await page
    .getByRole('menuitem', { name: 'Add to shopping', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add selected ingredients' }).click();
  await expect(
    page.locator('.shopping-section').getByText('8 items remaining'),
  ).toBeVisible();
  await page.locator('.shopping-items input').first().click();
  await expect(
    page.locator('.shopping-section').getByText('7 items remaining'),
  ).toBeVisible();
  await page
    .getByLabel('Quick add shopping items')
    .fill('Bread, bread, apples');
  await page.getByRole('button', { name: 'Add shopping items' }).click();
  await expect(page.getByRole('status')).toContainText(
    'already on the shopping list',
  );
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Mark as cooked' })
    .first()
    .click();
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' })
    .click();
  await expect(
    page.getByRole('menuitem', { name: 'Swap meal' }),
  ).toHaveAttribute('data-disabled', '');
  await expect(
    page.getByRole('menuitem', { name: 'Add to shopping' }),
  ).toHaveAttribute('data-disabled', '');
  await page.getByRole('menuitem', { name: 'Remove from plan' }).click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Recipes', exact: true })
    .click();
  await expect(
    page
      .locator('.recipe-library')
      .getByRole('button', { name: /Honey Berry Oatmeal/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset scenario' }).click();
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' })
    .click();
  await page.getByRole('menuitem', { name: 'Swap meal' }).click();
  // Free one fixture recipe first to make it available to swap.
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page
    .locator('.week-section')
    .getByRole('button', { name: 'Meal actions for Creamy Tomato Soup' })
    .click();
  await page.getByRole('menuitem', { name: 'Remove from plan' }).click();
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' })
    .click();
  await page.getByRole('menuitem', { name: 'Swap meal' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Creamy Tomato Soup/ })
    .click();
  await expect(
    page
      .locator('.today-section')
      .getByRole('button', { name: 'Creamy Tomato Soup', exact: true }),
  ).toBeVisible();
  await page
    .locator('.today-section')
    .getByRole('button', { name: 'Creamy Tomato Soup', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Ingredients' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add week to shopping' }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Cooked meals are included',
  );
  await page.getByRole('button', { name: 'Add selected ingredients' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const scenario of [
    'Completely empty',
    'Partially planned week',
    'All today’s meals cooked',
    'All shopping checked off',
    'Loading',
    'Load failure',
  ]) {
    await page.getByLabel('Development scenario').selectOption(scenario);
    if (scenario === 'Completely empty') {
      await expect(
        page.getByText('No meals planned today', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('No meals planned this week', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Your shopping list is empty', { exact: true }),
      ).toBeVisible();
      await page
        .locator('.today-section')
        .getByRole('button', { name: 'Plan a meal' })
        .first()
        .click();
      await expect(page.getByLabel('Scheduled day')).toHaveValue('2');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Honey Berry Oatmeal/ })
        .click();
      await expect(page.locator('.today-section .meal-card')).toHaveCount(1);
    }
    if (scenario === 'Partially planned week')
      await expect(page.locator('.today-section .meal-card')).toHaveCount(2);
    if (scenario === 'All today’s meals cooked')
      await expect(page.locator('.today-section .cooked-label')).toHaveCount(2);
    if (scenario === 'All shopping checked off') {
      await expect(
        page.getByText('Everything is checked off', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'View list' }).click();
      await expect(page.locator('.full-list input:checked')).toHaveCount(8);
      await page.getByRole('button', { name: 'Complete shopping' }).click();
      await expect(
        page.getByText('Your shopping list is empty', { exact: true }),
      ).toBeVisible();
    }
    if (scenario === 'Loading')
      await expect(page.getByRole('status')).toContainText(
        'Loading your dashboard',
      );
    if (scenario === 'Load failure') {
      await expect(page.locator('.error[role=alert]')).toContainText('Couldn’t load');
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(page.locator('.today-section .meal-card')).toHaveCount(2);
    }
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await context.close();
  await browser.close();
  console.log(
    `${name}: PASS — layout, keyboard menus, meal flows, selection, shopping, all scenarios; no external requests or page errors`,
  );
}
(async () => {
  await verify(chromium, { width: 1440, height: 900 }, 'desktop');
  await verify(webkit, { width: 390, height: 844 }, 'iphone');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
