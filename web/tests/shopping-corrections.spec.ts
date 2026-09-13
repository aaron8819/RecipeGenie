import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { createEmptyShoppingDocument } from '../src/lib/shopping-document';
import { SHOPPING_INVERSE_BYTES, shoppingContent, shoppingInverseBytes } from '../src/lib/shopping-clear';
import type { ShoppingCommand } from '../src/lib/shopping-command';

const local = parse(readFileSync('.env.local'));
if (local.NEXT_PUBLIC_SUPABASE_URL !== (process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:57321' : 'http://127.0.0.1:56321')) throw new Error('Requires isolated correction stack');
const admin = createClient(local.NEXT_PUBLIC_SUPABASE_URL, local.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const sql = postgres({ host: '127.0.0.1', port: process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 57322 : 56322, database: 'postgres', user: 'postgres', password: 'postgres', max: 1 });
test.afterAll(async () => { await sql.end(); });
async function send(page: Page, command: ShoppingCommand) {
  return page.evaluate(async (command) => {
    const operationId = crypto.randomUUID();
    const request = async (phase: string, sequence?: string) => (await fetch('/api/shopping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, operationId, command, sequence }),
    })).json();
    const admission = await request('admit');
    return request('execute', admission.sequence);
  }, command);
}
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`F2/F3 correction flows ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    const email = `corrections-${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull(); const owner = created.data.user!.id;
    const context = await browser.newContext({ viewport }); const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    const read = async () => (await sql`select document,content_revision from public.shopping_list where user_id=${owner}`)[0];
    const capture = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false,
        mask: [page.getByText(email, { exact: true })], animations: 'disabled' });
    };
    const clearButton = () => viewport.width < 768 ? page.getByRole('button', { name: 'Clear list', exact: true }) : page.getByRole('button', { name: 'Clear', exact: true });
    try {
      await sql`update public.user_config set onboarding_completed_at=now() where user_id=${owner}`;
      const document = createEmptyShoppingDocument();
      document.manualItems = [{ id: randomUUID(), displayName: 'Before race', quantity: null, categoryKey: 'misc', bucket: 'items', checked: false }];
      for (let i = 0; i < 7; i++) {
        await sql`update public.shopping_list set document=${sql.json(JSON.parse(JSON.stringify(document)))},content_revision=content_revision+1 where user_id=${owner}`;
      }
      await page.goto('/shopping');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible();
      await page.goto('/shopping');
      await expect(page.getByText('Before race', { exact: true })).toBeVisible();

      // Hold a real revision-7 GET; advance only the client's stale clock to
      // trigger the normal reconnect refetch. Database time stays untouched.
      let release!: () => void; let held!: () => void;
      const barrier = new Promise<void>((resolve) => { release = resolve; });
      const started = new Promise<void>((resolve) => { held = resolve; });
      let intercepted = false;
      await page.route('**/rest/v1/shopping_list?*', async (route) => {
        if (intercepted || route.request().method() !== 'GET') return route.continue();
        intercepted = true;
        const response = await route.fetch();
        const body = await response.json();
        expect((Array.isArray(body) ? body[0] : body).content_revision).toBe(7);
        held(); await barrier; await route.fulfill({ response });
      });
      await page.clock.install(); await page.clock.fastForward(31000);
      await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
      await started;
      expect((await send(page, { protocol: 1, observedRevision: 7, mutation: { type: 'setExclusion', key: 'race-setting', enabled: true } })).status).toBe('Applied');
      const add = page.getByPlaceholder(viewport.width < 768 ? 'Add milk, apples, basil...' : 'Add tomatoes, milk...');
      await add.fill('After race'); await add.press('Enter');
      await expect(add).toHaveValue('');
      await expect(page.getByText('After race', { exact: true })).toBeVisible();
      expect(Number((await read()).content_revision)).toBe(9);
      const lateResponse = page.waitForResponse((response) => response.url().includes('/rest/v1/shopping_list?') && response.request().method() === 'GET');
      release(); await lateResponse;
      await expect(page.getByText('After race', { exact: true })).toBeVisible();
      expect(Number((await read()).content_revision)).toBe(9);
      await capture('F2-query7-after-committed9');
      await page.unroute('**/rest/v1/shopping_list?*');

      const preClear = (await read()).document;
      let undoBody: unknown;
      page.on('request', (request) => {
        if (request.url().endsWith('/api/shopping') && request.postDataJSON()?.command?.mutation?.type === 'undoClear') undoBody = request.postDataJSON();
      });
      await clearButton().click();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.getByText('After race', { exact: true })).toBeVisible();
      expect((await read()).document).toEqual(preClear);
      expect(Buffer.byteLength(JSON.stringify(undoBody))).toBeLessThan(256);
      await capture('F3-manual-clear-undo');

      // Keep the visible fixture small. A large opaque ID crosses the same
      // persisted byte bound without thousands of rows or huge visible text.
      const large = createEmptyShoppingDocument();
      large.manualItems = [{ id: 'large-item', displayName: 'Large inverse fixture',
        quantity: null, categoryKey: 'misc', bucket: 'excluded', checked: false }];
      const padding = SHOPPING_INVERSE_BYTES + 1 - shoppingInverseBytes(shoppingContent(large));
      large.manualItems[0].id += 'x'.repeat(padding);
      expect(shoppingInverseBytes(shoppingContent(large))).toBeGreaterThan(SHOPPING_INVERSE_BYTES);
      await sql`update public.shopping_list set document=${sql.json(JSON.parse(JSON.stringify(large)))},content_revision=content_revision+1 where user_id=${owner}`;
      await page.reload();
      await clearButton().click();
      await expect(page.getByText('This list exceeds the Undo storage limit.', { exact: false })).toBeVisible();
      await capture('F3-unsupported-before-confirmation');
      const prior = await read();
      expect((await send(page, { protocol: 1, observedRevision: Number(prior.content_revision),
        mutation: { type: 'setExclusion', key: 'concurrent-confirmation', enabled: true } })).status).toBe('Applied');
      const changed = await read();
      const refused = page.waitForResponse((response) => response.url().endsWith('/api/shopping') &&
        response.request().postDataJSON()?.phase === 'execute');
      await page.getByRole('button', { name: 'Clear list', exact: true }).last().click();
      expect((await (await refused).json()).status).toBe('Conflict');
      await expect(page.getByText(/confirm Clear again; nothing was cleared/)).toBeVisible();
      expect(await read()).toEqual(changed);
      await capture('F3-concurrent-confirmation-refused');
      await clearButton().click();
      await page.getByRole('button', { name: 'Clear list', exact: true }).last().click();
      await expect(page.getByText('Shopping list cleared. Undo is unavailable for this Clear.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
      expect((await read()).document.manualItems).toEqual([]);
      await capture('F3-confirmed-without-undo');
      expect(errors).toEqual([]);
    } finally {
      await context.close(); await admin.auth.admin.deleteUser(owner);
    }
  });
}
