import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { applyShoppingDocumentMutation, createEmptyShoppingDocument,
  type ShoppingDocumentStateV3, type ShoppingDocumentMutation } from '../src/lib/shopping-document';
import { persistShoppingMutationWithReplay } from '../src/lib/shopping-document-persistence';
import { validateSettingIntent, validateSettingsReplacement,
  type ShoppingSettingIntent } from '../src/lib/shopping-settings';
import { E2E_CONFIG } from './e2e-env';
import { createLocalRuntime, localSupabaseEnvironment } from '../scripts/local-e2e-runtime.mjs';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.describe.configure({ mode: 'serial' });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`semantic settings and real database races at ${viewport.width}x${viewport.height}`, async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    expect(E2E_CONFIG.target).toBe('local');
    expect(E2E_CONFIG.baseURL).toBe('http://127.0.0.1:3107');
    expect(E2E_CONFIG.supabaseUrl).toBe('http://127.0.0.1:54321');
    const status = createLocalRuntime(process.cwd()).status();
    expect(status.ok).toBe(true);
    const local = localSupabaseEnvironment(status.output);
    const authOptions = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(local.supabaseUrl, local.serviceRoleKey, authOptions);
    const email = `slice2-${randomUUID()}@example.test`;
    const password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(created.error).toBeNull();
    const owner = created.data.user!.id;
    const client = createClient(local.supabaseUrl, local.anonKey, authOptions);
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    const evidence: string[] = [];
    const diagnostics = { pageErrors: 0, externalRequests: 0 };
    const read = async (): Promise<ShoppingDocumentStateV3> => {
      const result = await client.from('shopping_list').select('document,content_revision').eq('user_id', owner).single();
      expect(result.error).toBeNull();
      return { document: result.data!.document, contentRevision: result.data!.content_revision };
    };
    const write = async (before: ShoppingDocumentStateV3, next: ShoppingDocumentStateV3) => {
      const result = await client.from('shopping_list').update({
        document: next.document, content_revision: before.contentRevision + 1,
      }).eq('user_id', owner).eq('content_revision', before.contentRevision)
        .select('document,content_revision').maybeSingle();
      expect(result.error).toBeNull();
      return result.data ? { document: result.data.document, contentRevision: result.data.content_revision } : null;
    };
    const commit = async (mutation: ShoppingDocumentMutation) => {
      const before = await read();
      expect(await write(before, applyShoppingDocumentMutation(before, mutation))).not.toBeNull();
    };
    const original = createEmptyShoppingDocument();
    original.preferences.excludedIngredientKeys = ['salt'];
    original.preferences.categoryOrder = ['misc', 'produce'];
    original.manualItems = [{ id: 'bread', displayName: 'bread', quantity: null,
      categoryKey: 'misc', bucket: 'items', checked: false }];
    const resetOwned = async () => { const before = await read(); expect(await write(before, { ...before, document: original })).not.toBeNull(); };
    const exclusion = (key: string, enabled = true): ShoppingSettingIntent => ({ type: 'setExclusion', key, enabled });
    const login = async () => {
      const context = await browser.newContext({ viewport, baseURL: E2E_CONFIG.baseURL });
      contexts.push(context);
      const page = await context.newPage();
      page.on('pageerror', () => diagnostics.pageErrors++);
      page.on('request', request => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) diagnostics.externalRequests++;
      });
      await page.goto('/pantry');
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible();
      await page.goto('/pantry');
      await showExclusions(page);
      return page;
    };
    const showExclusions = async (page: Page) => {
      await expect(page.getByRole('heading', { name: 'Pantry', exact: true })).toBeVisible();
      if (viewport.width < 768) await page.getByRole('button', { name: /^Excluded \d/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Salt variants', exact: true })).toBeVisible();
    };
    const reload = async (page: Page) => { await page.reload(); await showExclusions(page); };
    const add = async (page: Page, keyword: string) => {
      await page.getByPlaceholder('Add excluded keyword (comma-separated)...').fill(keyword);
      await page.getByRole('button', { name: 'Submit excluded keywords', exact: true }).click();
    };
    const capture = async (page: Page, name: string) => {
      await page.screenshot({ path: testInfo.outputPath(name + '.png'), fullPage: true,
        mask: [page.getByText(email, { exact: true })] });
    };
    try {
      expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
      expect((await client.from('user_config').update({ onboarding_completed_at: new Date().toISOString() }).eq('user_id', owner)).error).toBeNull();
      // Maintained G03/H07: real owner-filtered CAS, deterministic interleavings.
      const cases: [ShoppingSettingIntent, ShoppingSettingIntent, string[]][] = [
        [exclusion('pepper'), exclusion('cumin'), ['salt', 'pepper', 'cumin']],
        [exclusion('pepper'), exclusion('salt', false), ['pepper']],
        [exclusion('salt', false), exclusion('cumin'), ['cumin']],
        [exclusion('pepper'), exclusion('pepper'), ['salt', 'pepper']],
        [exclusion('salt', false), exclusion('salt', false), []],
      ];
      for (const [first, second, expected] of cases) {
        await resetOwned();
        const observed = await read();
        await commit(first);
        const result = await persistShoppingMutationWithReplay({
          initial: observed, mutation: second, write, refetch: read,
          validateReplay: fresh => validateSettingIntent(observed, fresh, second),
        });
        expect(result.document.preferences.excludedIngredientKeys).toEqual(expected);
        expect(result.document.manualItems).toEqual(original.manualItems);
        expect(result.document.preferences.categoryOrder).toEqual(original.preferences.categoryOrder);
      }
      evidence.push('G03/H07 and disjoint add/remove, repeated add/remove pass with real CAS replay; unrelated content/order preserved.');
      await resetOwned();
      const observed = await read();
      await commit(exclusion('salt', false));
      const latest = await read();
      expect(() => validateSettingIntent(observed, latest, exclusion('salt'))).toThrow();
      await expect(persistShoppingMutationWithReplay({
        initial: observed, mutation: { type: 'updatePreferences', preferences: { excludedIngredientKeys: [] } },
        write, refetch: read, validateReplay: fresh => validateSettingsReplacement(observed, fresh),
      })).rejects.toThrow('Your change was not saved');
      expect(await read()).toEqual(latest);
      evidence.push('Stale bulk reset refuses after real failed CAS; same-key opposite intent refuses.');

      await resetOwned();
      const a = await login();
      const b = await login();
      // A real write lands after A reads, before its PATCH; retry must preserve B.
      let patches = 0;
      await a.route('**/rest/v1/shopping_list*', async route => {
        if (route.request().method() === 'PATCH' && patches++ === 0) await commit(exclusion('cumin'));
        await route.continue();
      });
      await add(a, 'pepper');
      await expect.poll(async () => (await read()).document.preferences.excludedIngredientKeys).toEqual(['salt', 'cumin', 'pepper']);
      expect(patches).toBe(2);
      await a.unrouteAll({ behavior: 'wait' });
      await add(b, 'oregano');
      await expect.poll(async () => (await read()).document.preferences.excludedIngredientKeys).toContain('oregano');
      for (const page of [a, b]) {
        await reload(page);
        const list = page.getByTestId('exact-exclusion-items');
        for (const key of ['salt', 'cumin', 'pepper', 'oregano']) await expect(list.getByText(key, { exact: true })).toBeVisible();
      }
      await capture(a, 'independent-exclusions');
      evidence.push('Two authenticated browser sessions preserve independent exclusions after reload; forced browser CAS conflict retries exactly once.');

      await a.getByRole('checkbox', { name: 'Salt variants', exact: true }).click();
      await expect.poll(async () => (await read()).document.preferences.excludeSaltVariants).toBe(true);
      await b.getByRole('checkbox', { name: 'Black pepper variants', exact: true }).click();
      await expect.poll(async () => (await read()).document.preferences.excludeBlackPepperVariants).toBe(true);
      await commit({ type: 'setFamilySetting', setting: 'excludeSaltVariants', enabled: false });
      await reload(b);
      await commit({ type: 'setFamilySetting', setting: 'excludeSaltVariants', enabled: true });
      await b.getByRole('checkbox', { name: 'Salt variants', exact: true }).click();
      await expect(b.getByText('Shopping settings changed in another session. Your change was not saved. Review the latest settings and try again.', { exact: true })).toBeVisible();
      const pendingChoice = b.getByRole('alert').filter({ hasText: 'Salt variants could not be turned on.' });
      await expect(pendingChoice).toBeVisible();
      await expect(b.getByRole('checkbox', { name: 'Salt variants', exact: true })).toBeChecked();
      await capture(b, 'family-conflict');
      await b.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(pendingChoice).toHaveCount(0);
      await reload(a);
      await expect(a.getByRole('checkbox', { name: 'Salt variants', exact: true })).toBeChecked();
      await expect(a.getByRole('checkbox', { name: 'Black pepper variants', exact: true })).toBeChecked();
      expect((await read()).document.manualItems).toEqual(original.manualItems);
      evidence.push('Independent family controls persist; stale same-family change reports conflict, refreshes saved value, retains choice for explicit retry.');

      // A stale cached duplicate must not hide a removal; failed input remains.
      await commit(exclusion('pepper', false));
      await add(a, 'pepper');
      await expect(a.getByText('Shopping settings changed in another session. Your change was not saved. Review the latest settings and try again.', { exact: true })).toBeVisible();
      await expect(a.getByPlaceholder('Add excluded keyword (comma-separated)...')).toHaveValue('pepper');
      expect((await read()).document.preferences.excludedIngredientKeys).not.toContain('pepper');
      await capture(a, 'retained-exclusion-input');
      evidence.push('Cached duplicate versus remote removal conflicts without a write; input retained and current settings refreshed.');

      await a.goto('/shopping');
      await a.getByRole('button', { name: viewport.width < 768 ? 'Clear list' : 'Clear', exact: true }).click();
      await expect(a.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
      await add(b, 'thyme');
      await expect.poll(async () => (await read()).document.preferences.excludedIngredientKeys).toContain('thyme');
      await a.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(a.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true })).toBeVisible();
      expect((await read()).document.manualItems).toEqual([]);
      evidence.push('Slice 1 Undo still refuses an intervening real settings write.');
      expect(diagnostics).toEqual({ pageErrors: 0, externalRequests: 0 });
      await testInfo.attach('scenario-evidence', { body: JSON.stringify({ evidence, diagnostics }), contentType: 'application/json' });
    } finally {
      for (const context of contexts) await context.close();
      await client.auth.signOut();
      expect((await admin.auth.admin.deleteUser(owner)).error, 'task-owned cleanup').toBeNull();
    }
  });
}
