import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from '@playwright/test';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument } from '../src/lib/shopping-document';
import { mapRecipeRows } from '../src/lib/recipe-identity';
import { shoppingCompatibilityFixture, ONE } from '../src/test/shopping-compatibility-fixtures';

const env = parse(readFileSync('.env.local'));
if (env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:57321') throw new Error('Requires isolated Slice 7 stack');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres({ host: '127.0.0.1', port: 57322, database: 'postgres', user: 'postgres', password: 'postgres', max: 1 });
test.afterAll(async () => { await sql.end(); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`Slice 7 production UI ${viewport.width}x${viewport.height}`, async ({ browser }, info) => {
    const email = `slice7-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull(); const owner = created.data.user!.id;
    const context = await browser.newContext({ viewport }); const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const read = async () => (await sql`select document,content_revision from public.shopping_list where user_id=${owner}`)[0];
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled', fullPage: false });
    };
    try {
      await sql`update public.user_config set onboarding_completed_at=now() where user_id=${owner}`;
      const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      const id = randomUUID();
      const inserted = await client.from('recipes').insert({ user_id: owner, recipe_uuid: id, name: 'Slice Seven Lemons', category: 'Dinner', servings: 4,
        tags: [], ingredient_sections: [{ label: 'Sauce', ingredients: shoppingCompatibilityFixture().recipes[0].ingredientSections[0].ingredients }],
        instruction_sections: [{ label: null, steps: ['Mix.'] }] }).select('*').single();
      expect(inserted.error).toBeNull();
      const recipe = mapRecipeRows([inserted.data] as never)[0];
      const document = createEmptyShoppingDocument();
      document.recipeEntries[id] = createShoppingRecipeEntry(recipe, 4, ONE);
      const manualId = randomUUID();
      document.manualItems = [{ id: manualId, displayName: 'lemon', quantity: { amount: 3, unit: 'count' }, categoryKey: 'produce', bucket: 'items', checked: true }];
      document.preferences.ingredientOrderByCategory = { produce: ['hidden', 'lemon'] };
      await sql`update public.shopping_list set document=${sql.json(JSON.parse(JSON.stringify(document)))},content_revision=1 where user_id=${owner}`;
      await page.goto('/shopping');
      await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible();
      await page.goto('/shopping');
      await page.getByRole('button', { name: 'Update this shopping list', exact: true }).click();
      await expect(page.getByText('Extras, source quantities and legacy amounts', { exact: true })).toBeVisible();
      await expect.poll(async () => (await read()).document.schemaVersion).toBe(4);
      expect((await read()).document.manualItems[0].identity.meaning).toBe('legacyIndependent');
      const editor = page.getByTestId(`need-${manualId}`);
      await editor.locator('summary').first().click();
      await editor.getByLabel('Amount for lemon', { exact: true }).fill('4');
      await editor.getByRole('button', { name: 'Save independent amount', exact: true }).click();
      await expect.poll(async () => (await read()).document.manualItems[0].quantity.amount).toBe(4);
      expect((await read()).document.manualItems[0].identity.meaning).toBe('legacyIndependent');
      await capture('legacy-edit-and-resolution-preview');
      await editor.getByRole('button', { name: 'Confirm meaning and location', exact: true }).click();
      await expect.poll(async () => (await read()).document.manualItems[0].identity.meaning).toBe('extra');
      expect(projectShoppingDocument((await read()).document).items.find(row => row.orderingKey === 'lemon')?.quantity?.amount).toBe(6);
      expect((await read()).document.manualItems[0].identity.conversion.raw).toEqual(document.manualItems[0]);
      expect((await read()).document.preferences.ingredientOrderByCategory.produce).toEqual(['hidden', 'lemon']);
      await editor.locator('summary').first().click();
      await page.getByLabel('Purchase', { exact: true }).fill('milk');
      await page.getByLabel('Extra amount', { exact: true }).fill('1/3');
      await page.getByLabel('Extra unit', { exact: true }).fill('cup');
      await page.getByRole('button', { name: 'Add extra or reminder', exact: true }).click();
      await expect(page.getByLabel('Purchase', { exact: true })).toHaveValue('');
      expect((await read()).document.manualItems[1].quantity.exactQuantityV1.value).toEqual({ numerator: '1', denominator: '3' });
      await page.getByText('Slice Seven Lemons: 4 selected servings', { exact: true }).click();
      await page.getByLabel('Total Shopping yield for Slice Seven Lemons', { exact: true }).fill('8');
      await page.getByRole('button', { name: 'Set total yield', exact: true }).click();
      await expect.poll(async () => (await read()).document.recipeEntries[id].selectedServings).toBe(8);
      const revision = (await read()).content_revision;
      await page.getByRole('button', { name: 'Set total yield', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Set total yield', exact: true })).toBeEnabled();
      expect((await read()).content_revision).toBe(revision);
      expect((await read()).document.recipeEntries[id].sourceEvidence.occurrences[0].section).toBe('Sauce');
      await page.getByLabel('Quantity mode for Slice Seven Lemons').selectOption('batches');
      await page.getByLabel('Total Shopping yield for Slice Seven Lemons').fill('1/2');
      await page.getByRole('button', { name: 'Set total yield', exact: true }).click();
      await expect.poll(async () => (await read()).document.recipeEntries[id].scaleV1).toEqual({ numerator: '1', denominator: '2' });
      await capture('exact-extra-and-batch-selection');
      const saved = (await read()).document;
      await page.reload();
      await expect(page.getByText('Extras, source quantities and legacy amounts', { exact: true })).toBeVisible();
      expect((await read()).document).toEqual(saved);
      await page.getByText('Extras, source quantities and legacy amounts', { exact: true }).click();
      await capture('grouped-purchase-breakdown');
      const clear = page.getByRole('button', { name: viewport.width < 768 ? 'Clear list' : 'Clear', exact: true });
      await clear.click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await expect(page.getByRole('alertdialog')).toContainText('Undo');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      expect((await read()).document).toEqual(saved);
      expect(errors).toEqual([]);
    } finally {
      await context.close(); expect((await admin.auth.admin.deleteUser(owner)).error).toBeNull();
    }
  });
}
