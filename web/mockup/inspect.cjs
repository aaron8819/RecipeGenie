const { chromium, webkit, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const path = require('node:path');
(async () => {
  for (const [name, type, viewport] of [
    ['desktop', chromium, { width: 1440, height: 900 }],
    ['iphone', webkit, { width: 390, height: 844 }],
  ]) {
    const browser = await type.launch();
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3115');
    await page.evaluate(() => document.fonts.ready);
    const profile = page.getByRole('button', { name: 'Open profile menu' }).filter({ visible: true });
    await profile.click();
    await page.getByRole('menuitem', { name: 'Profile', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('fixture account');
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    if (name === 'iphone') {
      await expect(page.locator('.mobile-header')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeHidden();
      const navBounds = await page.getByRole('navigation').boundingBox();
      expect(navBounds.y + navBounds.height).toBe(viewport.height);
      await page.getByLabel('Development scenario').scrollIntoViewIfNeeded();
      const scrolledBounds = await page.getByRole('navigation').boundingBox();
      expect(scrolledBounds.y).toBe(navBounds.y);
      await page.evaluate(() => window.scrollTo(0, 0));
    } else {
      await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('No real account was signed out');
      await page.getByRole('button', { name: 'Dismiss message' }).click();
    }
    await page.screenshot({
      path: path.join(__dirname, 'verification', `${name}-viewport.png`),
    });
    let results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.getByRole('button', { name: 'Add week to shopping' }).click();
    results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await page.keyboard.press('Escape');
    await page
      .getByLabel('Development scenario')
      .selectOption('All shopping checked off');
    await page.getByRole('button', { name: 'View list' }).click();
    await page.getByRole('button', { name: 'Complete shopping' }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.locator('.full-list input:checked')).toHaveCount(8);
    await page
      .getByLabel('Development scenario')
      .selectOption('Completely empty');
    await page
      .locator('.today-section')
      .getByRole('button', { name: 'Plan a meal' })
      .first()
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Honey Berry Oatmeal/ })
      .click();
    const openMealShopping = async () => {
      await page
        .locator('.today-section')
        .getByRole('button', { name: 'Meal actions for Honey Berry Oatmeal' })
        .click();
      await page.getByRole('menuitem', { name: 'Add to shopping' }).click();
    };
    await openMealShopping();
    await page.getByLabel('Servings for Honey Berry Oatmeal').fill('8');
    await page
      .getByRole('dialog')
      .getByLabel('blueberries', { exact: false })
      .uncheck();
    await page
      .getByRole('button', { name: 'Add selected ingredients' })
      .click();
    await expect(
      page.locator('.shopping-section').getByText('3 items remaining'),
    ).toBeVisible();
    await expect(
      page.locator('.shopping-row').filter({ hasText: 'milk' }),
    ).toContainText('4 cup');
    await page.locator('.shopping-row').filter({ hasText: 'milk' }).click();
    await openMealShopping();
    await page.getByLabel('Servings for Honey Berry Oatmeal').fill('8');
    await page
      .getByRole('dialog')
      .getByLabel('blueberries', { exact: false })
      .uncheck();
    await page
      .getByRole('button', { name: 'Add selected ingredients' })
      .click();
    await expect(
      page.locator('.shopping-section').getByText('2 items remaining'),
    ).toBeVisible();
    await page
      .locator('.shopping-section')
      .getByRole('button', { name: 'View all' })
      .click();
    await expect(page.locator('.full-list .shopping-row')).toHaveCount(3);
    await expect(
      page
        .locator('.full-list .shopping-row')
        .filter({ hasText: 'milk' })
        .locator('input'),
    ).toBeChecked();
    console.log(
      `${name}: axe dashboard and shopping dialog PASS; completion Undo, servings, ingredient selection and checked re-addition PASS`,
    );
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
