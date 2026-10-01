import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { shoppingCompatibilityFixture } from '../src/test/shopping-compatibility-fixtures';
import type { ShoppingCommand } from '../src/lib/shopping-command';

const local = parse(readFileSync('.env.local'));
if (local.NEXT_PUBLIC_SUPABASE_URL !== (process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:57321' : 'http://127.0.0.1:56321')) throw new Error('Requires the isolated Slice 6 stack');
const admin = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres({ host: '127.0.0.1', port: process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 57322 : 56322, database: 'postgres',
  user: 'postgres', password: 'postgres', max: 1 });
test.afterAll(async () => { await sql.end(); });

async function send(page: Page, command: ShoppingCommand, operationId = randomUUID()) {
  return page.evaluate(async ({ command, operationId }) => {
    const request = async (phase: string, sequence?: string) => (await fetch('/api/shopping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, operationId, command, sequence }),
    })).json();
    const admission = await request('admit');
    if (admission.status !== 'Admitted') return admission;
    return request('execute', admission.sequence);
  }, { command, operationId });
}
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`authoritative Shopping flows ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const email = `slice6-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const owner = created.data.user!.id;
    const contexts = await Promise.all([browser.newContext({ viewport }), browser.newContext({ viewport })]);
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const [page, other] = pages;
    const errors: string[] = [];
    for (const p of pages) p.on('pageerror', (e) => errors.push(e.message));
    const read = async () => (await sql`select document, content_revision from public.shopping_list where user_id = ${owner}`)[0];
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true,
        mask: [page.getByText(email, { exact: true })], animations: 'disabled' });
    };
    try {
      await sql`update public.user_config set onboarding_completed_at = now() where user_id = ${owner}`;
      const { document } = shoppingCompatibilityFixture();
      for (const item of document.manualItems) item.id = randomUUID();
      // Administrator fixture setup only in the isolated test database.
      await sql`update public.shopping_list set document = ${sql.json(JSON.parse(JSON.stringify(document)))}, content_revision = content_revision + 1 where user_id = ${owner}`;
      for (const p of pages) {
        await p.goto((process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:3117/shopping' : 'http://127.0.0.1:3116/shopping'));
        await p.getByLabel('Email', { exact: true }).fill(email);
        await p.getByLabel('Password', { exact: true }).fill(password);
        await p.getByRole('button', { name: 'Sign In', exact: true }).click();
        await expect(p.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible();
        await p.goto((process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:3117/shopping' : 'http://127.0.0.1:3116/shopping'));
        await expect(p.getByText('1–2 + 1–2', { exact: true })).toBeVisible();
      }
      const initial = await read();
      const manual = page.getByTestId('shopping-item-row').filter({ hasText: 'Added manually' }).filter({ hasText: 'lemons' });
      await manual.getByRole('button', { name: /^Actions for / }).click();
      await page.getByRole('menuitem', { name: 'Edit item', exact: true }).click();
      await page.getByLabel('Manual item amount', { exact: true }).fill('3.5');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByLabel('Manual item amount', { exact: true })).toHaveCount(0);
      expect((await read()).document.recipeEntries).toEqual(initial.document.recipeEntries);
      expect((await read()).document.preferences).toEqual(initial.document.preferences);
      await capture('ordinary-edit');

      // Lose an admission response after it is durably recorded.
      let admissionDropped = false, executionDropped = false;
      await page.route('**/api/shopping', async (route) => {
        const body = route.request().postDataJSON();
        if (!admissionDropped && body.phase === 'admit') {
          const result = await route.fetch(); expect((await result.json()).status).toBe('Admitted');
          admissionDropped = true; await route.abort('failed'); return;
        }
        if (!executionDropped && body.phase === 'execute') {
          const result = await route.fetch(); expect((await result.json()).status).toBe('Applied');
          const saved = await read();
          expect((await send(other, { protocol: 1, observedRevision: Number(saved.content_revision),
            mutation: { type: 'setExclusion', key: 'cumin', enabled: true } })).status).toBe('Applied');
          executionDropped = true; await route.abort('failed'); return;
        }
        await route.continue();
      });
      const add = page.getByPlaceholder(viewport.width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...');
      await add.fill('yogurt'); await add.press('Enter');
      await expect(add).toHaveValue('');
      await expect(page.getByTestId('shopping-item-row').filter({ hasText: 'yogurt' })).toBeVisible();
      expect(admissionDropped && executionDropped).toBe(true);
      expect((await read()).document.manualItems.filter((i: { displayName: string }) => i.displayName === 'yogurt')).toHaveLength(1);
      expect((await read()).document.preferences.excludedIngredientKeys).toContain('cumin');
      await page.unroute('**/api/shopping');
      await capture('lost-responses-recovered');

      // Deliberately pause the first edit at the network boundary. A second
      // authenticated session changes the same target before it is executed.
      let changed = false;
      await page.route('**/api/shopping', async (route) => {
        const body = route.request().postDataJSON();
        if (!changed && body.phase === 'execute') {
          changed = true;
          const saved = await read();
          const item = saved.document.manualItems[0];
          expect((await send(other, { protocol: 1, observedRevision: Number(saved.content_revision),
            mutation: { type: 'editManualItem', id: item.id, changes: { quantity: { amount: 7, unit: 'count' } } } })).status).toBe('Applied');
        }
        await route.continue();
      });
      await manual.getByRole('button', { name: /^Actions for / }).click();
      await page.getByRole('menuitem', { name: 'Edit item', exact: true }).click();
      await page.getByLabel('Manual item amount', { exact: true }).fill('9');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.locator('form [role="alert"]')).toBeVisible();
      await expect(page.getByLabel('Manual item amount', { exact: true })).toHaveValue('9');
      expect((await read()).document.manualItems[0].quantity.amount).toBe(7);
      await capture('conflict-keeps-input');
      await page.unroute('**/api/shopping');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();

      // Both delivery attempts lose their response. Reload must recover the
      // stored operation, even though the originating form is reconstructed.
      await page.route('**/api/shopping', async (route) => {
        const body = route.request().postDataJSON();
        if (body.phase === 'execute') { await route.fetch(); await route.abort('failed'); }
        else await route.continue();
      });
      await add.fill('oats'); await add.press('Enter');
      await expect(page.getByRole('button', { name: 'Retry saved change', exact: true })).toBeVisible();
      await expect(add).toHaveValue('oats');
      await page.unroute('**/api/shopping');
      await page.reload();
      await page.getByRole('button', { name: 'Retry saved change', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry saved change', exact: true })).toHaveCount(0);
      expect((await read()).document.manualItems.filter((i: { displayName: string }) => i.displayName === 'oats')).toHaveLength(1);
      await capture('saved-attempt-after-reload');

      // New client shows an actionable compatibility response. Database tests
      // independently exercise actual old table/RPC denials under JWT roles.
      await page.route('**/api/shopping', async (route) => {
        const body = route.request().postDataJSON(); body.command.protocol = 0;
        await route.continue({ postData: JSON.stringify(body) });
      });
      await add.fill('basil'); await add.press('Enter');
      await expect(page.getByText('Shopping has been updated. Refresh the application to continue.', { exact: true }).first()).toBeVisible();
      await expect(add).toHaveValue('basil');
      await capture('compatibility-keeps-input');
      expect(errors).toEqual([]);
    } finally {
      for (const context of contexts) await context.close();
      expect((await admin.auth.admin.deleteUser(owner)).error).toBeNull();
    }
  });
}
