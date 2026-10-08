import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import type { Database, Json } from '../src/types/database';
import { createEmptyShoppingDocument } from '../src/lib/shopping-document';
import { initializeShoppingDocument } from '../src/lib/shopping-initialization';
import { readShoppingCompatibility } from '../src/lib/shopping-compatibility';
import { parseQuantityV1 } from '../src/lib/recipe-quantity';
import { finishQualification, SetupFailure, type Failure } from './qualification-outcome';

config({ path: '.env.local', quiet: true });
const backend = 'http://127.0.0.1:54321';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== backend) {
  throw new Error('Combined fixtures require ephemeral hosted Actions and loopback Supabase');
}
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Disposable backend keys are missing');
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
  },
};
const admin = createClient<Database>(backend, service, clientOptions);
type RecipeInsert = Database['public']['Tables']['recipes']['Insert'];
type Owner = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient<Database>;
};
const ownerTables = [
  'recipes', 'recipe_history', 'weekly_plans', 'user_config',
  'shopping_list', 'pantry_items', 'plan_templates',
] as const;
const requiredChecks = [
  'owner-isolation', 'cards-selection-failure-retry', 'shopping-read-recovery',
  'shopping-response-loss-dedup', 'detail-saved-selection', 'planner-dashboard-focus',
  'planner-return-week-read-retry', 'planner-move-cook-remove-swap',
  'history-exact-undo-retry', 'shopping-stale-source',
];

function requireResult(error: unknown, data: unknown, operation: string): void {
  if (error || data === null) throw new SetupFailure(operation, error);
}

function privateRows(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid owned fixture identity');
  // Same fixed local Docker/psql path as existing migration CI, read-only count/data capture.
  // Never use a hosted connection, enumerate owners, or print raw protocol/auth data.
  const sql = ['shopping_protocol', 'shopping_admissions'].map(table =>
    `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) ` +
    `from private.${table} t where user_id = '${id}'::uuid;`).join('\n');
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_Recipe_Genie', 'psql',
      '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('Disposable private-table witness lookup failed');
  }
}

function monday(offset = 0): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset);
  return date.toISOString().slice(0, 10);
}

function recipe(owner: string, name: string): RecipeInsert {
  const id = randomUUID();
  const ingredient = (item: string, modifier: string) => ({
    item, amount: '1', unit: '', modifier, quantityV1: parseQuantityV1('1'),
  });
  return {
    id, recipe_uuid: id, user_id: owner, name, category: 'chicken', servings: 4,
    favorite: false, tags: [],
    ingredient_sections: [
      { label: 'Dressing', ingredients: [
        ingredient('lemon', 'zested'), ingredient('olive oil', ''),
      ] },
      { label: 'Finish', ingredients: [ingredient('lemon', 'sliced'), ingredient('parsley', '')] },
    ],
    instruction_sections: [{ label: 'Method', steps: ['Mix the dressing.', 'Finish and serve.'] }],
    notes: ['A disposable qualification recipe.'],
  };
}

async function owner(run: string, journal: Owner[]): Promise<Owner> {
  const email = `combined-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { combinedQualification: run },
  });
  requireResult(created.error, created.data.user, 'create owner');
  const value: Owner = {
    id: created.data.user!.id, email, password,
    client: createClient<Database>(backend, anon!, clientOptions),
  };
  // Journal the returned canonical identity before any subsequent acquisition/mutation.
  journal.push(value);
  const signed = await value.client.auth.signInWithPassword({ email, password });
  requireResult(signed.error, signed.data.user, 'sign in owner');
  const configured = await admin.from('user_config').update({
    onboarding_completed_at: new Date().toISOString(), week_start_day: 1,
    enabled_planner_categories: ['chicken'], history_exclusion_days: 0, auto_assign_days: true,
  }).eq('user_id', value.id);
  requireResult(configured.error, true, 'configure owner');
  return value;
}

async function snapshot(value: Owner): Promise<string> {
  const rows: unknown[] = [];
  for (const table of ownerTables) {
    const result = await admin.from(table).select('*').eq('user_id', value.id);
    requireResult(result.error, result.data, 'read witness');
    rows.push([table, result.data!.map(row => JSON.stringify(row)).sort()]);
  }
  rows.push(['private shopping receipt state', privateRows(value.id)]);
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

async function cleanup(value: Owner, run: string): Promise<boolean> {
  const signedOut = await value.client.auth.signOut({ scope: 'global' });
  const revoked = !signedOut.error;
  const found = await admin.auth.admin.getUserById(value.id);
  if (found.error || found.data.user?.email !== value.email ||
    found.data.user.app_metadata.combinedQualification !== run) return false;
  const removed = await admin.auth.admin.deleteUser(value.id);
  if (removed.error) return false;
  const absent = await admin.auth.admin.getUserById(value.id);
  if (absent.data.user || absent.error?.status !== 404) return false;
  for (const table of ownerTables) {
    const rows = await admin.from(table).select('*', { count: 'exact', head: true })
      .eq('user_id', value.id);
    if (rows.error || rows.count !== 0) return false;
  }
  const shares = await admin.from('recipe_shares').select('id', { count: 'exact', head: true })
    .or(`sender_user_id.eq.${value.id},recipient_user_id.eq.${value.id}`);
  return revoked && !shares.error && shares.count === 0 && privateRows(value.id) === '[]\n[]';
}

async function login(page: Page, value: Owner): Promise<void> {
  await page.goto('/recipes');
  await page.getByLabel('Email', { exact: true }).fill(value.email);
  await page.getByLabel('Password', { exact: true }).fill(value.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Go to Planner', exact: true })).toBeVisible();
}

async function geometry(page: Page, dialog?: Locator): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (dialog) {
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (!bounds || !viewport) throw new Error('Dialog bounds unavailable');
    expect(bounds.x).toBeGreaterThanOrEqual(-1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    // The dialog may scroll internally but its frame must remain on screen.
    expect(bounds.y).toBeGreaterThanOrEqual(-1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    for (let index = 0;index < 12;index++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
    }
  }
}

for (const viewport of [
  { width: 1440, height: 900 }, { width: 390, height: 844 },
]) {
  test(`combined acceptance ${viewport.width}x${viewport.height}`, async ({ browser }, info) => {
    const run = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${randomUUID()}`;
    const owners: Owner[] = [];
    const contexts: BrowserContext[] = [];
    const checks: string[] = [];
    const cleanupResults: { ownerId: string; absent: boolean; }[] = [];
    const directory = path.resolve('..', '.codex-artifacts', 'combined-ui');
    const artifact = `${info.project.name}-${viewport.width}`;
    let passed = false;
    let witnessStatus = 'snapshot-not-acquired';
    let primaryFailure: Failure | undefined;
    let teardownFailure: Failure | undefined;
    let stage = 'acquire primary owner';
    let witnessBefore: string | undefined;
    let cleanupComplete = true;
    let releasePending: (() => void) | undefined;
    try {
      const primary = await owner(run, owners);
      stage = 'acquire witness owner';
      const witness = await owner(run, owners);
      const main = recipe(primary.id,
        'Qualification citrus chicken with a long grouped ingredient title for narrow cards');
      const cooked = recipe(primary.id, 'Qualification cooked chicken');
      const unassigned = recipe(primary.id, 'Qualification unassigned chicken');
      const replacement = recipe(primary.id, 'Qualification replacement chicken');
      const rows = [main, cooked, unassigned, replacement];
      stage = 'seed canonical recipes';
      const inserted = await admin.from('recipes').insert(rows);
      requireResult(inserted.error, true, 'seed canonical recipes');
      const today = new Date().getUTCDay();
      stage = 'seed weekly plans';
      for (const week of [monday(), monday(7)]) {
        const seeded = await admin.from('weekly_plans').upsert({
          user_id: primary.id, week_date: week, scale: 2,
          recipe_uuids: [main.id, cooked.id, unassigned.id], made_recipe_uuids: [cooked.id],
          day_assignment_recipe_uuids: { [main.id]: today, [cooked.id]: (today + 1) % 7 },
        });
        requireResult(seeded.error, true, 'seed weekly plan');
      }
      stage = 'seed shopping';
      const legacyDocument = createEmptyShoppingDocument();
      legacyDocument.manualItems.push({
        id: randomUUID(), displayName: 'manual bread',
        quantity: { amount: 1, unit: 'count' }, categoryKey: 'bakery', bucket: 'items',
        checked: false
      });
      const document = initializeShoppingDocument(legacyDocument, []);
      const seededShopping = await admin.from('shopping_list')
        .update({ document: document as unknown as Json }).eq('user_id', primary.id);
      requireResult(seededShopping.error, true, 'seed shopping');
      stage = 'acquire witness snapshot';
      witnessBefore = await snapshot(witness);
      stage = 'owner scoped read';
      const protectedRows = await witness.client.from('recipes').select('recipe_uuid')
        .eq('recipe_uuid', main.id);
      requireResult(protectedRows.error, protectedRows.data, 'owner scoped read');
      expect(protectedRows.data).toHaveLength(0);
      checks.push('owner-isolation');

      stage = 'browser acceptance';
      const context = await browser.newContext({
        viewport, baseURL: 'http://127.0.0.1:3107', timezoneId: 'UTC',
      });
      contexts.push(context);
      // Browser-only transport accommodation for local HTTP production in WebKit.
      // Server CSP is unchanged. This run is not a production CSP qualification.
      if (info.project.name === 'combined-webkit') {
        await context.route('http://127.0.0.1:3107/**', async route => {
          if (route.request().resourceType() !== 'document') return route.continue();
          const response = await route.fetch();
          const headers = { ...response.headers() };
          if (headers['content-security-policy']) {
            headers['content-security-policy'] = headers['content-security-policy']
              .replace(/(?:^|;)\s*upgrade-insecure-requests\s*(?=;|$)/g, '');
          }
          await route.fulfill({ response, headers });
        });
      }
      const page = await context.newPage();
      let externalRequests = 0;
      context.on('request', request => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) &&
          !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests++;
      });
      const readShopping = async () => {
        const result = await primary.client.from('shopping_list')
          .select('document,content_revision').eq('user_id', primary.id).single();
        requireResult(result.error, result.data, 'read shopping');
        const compatible = readShoppingCompatibility(result.data!.document,
          result.data!.content_revision);
        if (compatible.status !== 'Supported') throw new Error('Unsupported fixture document');
        return compatible.state;
      };
      const readPlan = async (week = monday()) => {
        const result = await primary.client.from('weekly_plans').select('*')
          .eq('user_id', primary.id).eq('week_date', week).single();
        requireResult(result.error, result.data, 'read plan');
        return result.data!;
      };
      const readHistory = async () => {
        const result = await primary.client.from('recipe_history').select('id,recipe_uuid')
          .eq('user_id', primary.id).order('id');
        requireResult(result.error, result.data, 'read history');
        return result.data!;
      };
      const cardMenu = async (item: RecipeInsert, action: string) => {
        const trigger = page.getByRole('button', { name: `Actions for ${item.name}`, exact: true });
        await trigger.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('menuitem', { name: action, exact: true }).click();
        return trigger;
      };
      const shoppingDialog = () => page.getByRole('dialog');
      const yieldControl = () => shoppingDialog().getByRole('spinbutton',
        { name: `Selected yield for ${main.name}`, exact: true });
      const submit = () => shoppingDialog().getByRole('button',
        { name: 'Add selected ingredients', exact: true });
      const assertSaved = async () => {
        await expect(yieldControl()).toHaveValue('5');
        // Accessible ordinal names distinguish identical lemon occurrences across sections.
        for (let index = 0;index < 4;index++) {
          const control = shoppingDialog().getByRole('checkbox', {
            name: new RegExp(`ingredient ${index + 1}$`),
          });
          if (index === 0 || index === 2) await expect(control).toBeChecked();
          else await expect(control).not.toBeChecked();
        }
      };
      const cancelFocus = async (trigger: Locator) => {
        await geometry(page, shoppingDialog());
        await shoppingDialog().getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(shoppingDialog()).toHaveCount(0);
        await expect(trigger).toBeFocused();
      };
      await login(page, primary);

      await test.step('cards: invalid admission retains draft; retry writes real DB', async () => {
        await page.goto('/recipes');
        await cardMenu(main, 'Add to Shopping List');
        await expect(yieldControl()).toHaveValue('4');
        await yieldControl().fill('5');
        await shoppingDialog().getByRole('button', { name: 'Deselect all', exact: true }).click();
        for (const ordinal of [1, 3]) {
          await shoppingDialog().getByRole('checkbox',
            { name: new RegExp(`ingredient ${ordinal}$`) }).check();
        }
        const before = await readShopping();
        await page.route('**/api/shopping', route => route.fulfill({
          status: 400,
          contentType: 'application/json', body: '{"status":"InvalidInput"}'
        }));
        await submit().click();
        await expect(shoppingDialog().getByRole('alert')).toBeVisible();
        await assertSaved();
        expect(await readShopping()).toEqual(before);
        await page.unroute('**/api/shopping');
        await submit().click();
        await expect(shoppingDialog()).toHaveCount(0);
        await expect.poll(async () => (await readShopping()).document
          .recipeEntries[main.id]?.selectedServings).toBe(5);
        const saved = (await readShopping()).document;
        expect(saved.recipeEntries[main.id].ingredients).toHaveLength(2);
        expect(saved.recipeEntries[main.id].sourceEvidence?.occurrences
          .map(item => item.ordinal)).toEqual([0, 2]);
        expect(saved.manualItems).toEqual(document.manualItems);
      });
      checks.push('cards-selection-failure-retry');

      await test.step('selector read error is retryable without replacing saved data', async () => {
        const before = await readShopping();
        await page.route('**/rest/v1/shopping_list*', route => route.fulfill({
          status: 503,
          contentType: 'application/json', body: '{"message":"Qualification read unavailable"}'
        }));
        await page.reload();
        const trigger = await cardMenu(main, 'Add to Shopping List');
        await expect(shoppingDialog().getByRole('alert')).toContainText(
          'Could not load your shopping selections');
        await page.unroute('**/rest/v1/shopping_list*');
        await shoppingDialog().getByRole('button', { name: 'Retry', exact: true }).click();
        await assertSaved();
        await cancelFocus(trigger);
        expect(await readShopping()).toEqual(before);
      });
      checks.push('shopping-read-recovery');

      await test.step('lost real execute response reuses admission and applies once', async () => {
        await cardMenu(main, 'Add to Shopping List');
        await yieldControl().fill('6');
        const before = await readShopping();
        let lost = false;
        const operations = new Set<string>();
        await page.route('**/api/shopping', async route => {
          const body: unknown = route.request().postDataJSON();
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('Unexpected qualification command shape');
          }
          const command = body as Record<string, unknown>;
          if (typeof command.operationId === 'string') operations.add(command.operationId);
          if (command.phase === 'execute' && !lost) {
            lost = true;
            const response = await route.fetch();
            expect(response.ok()).toBe(true);
            return route.abort('failed');
          }
          return route.continue();
        });
        await submit().click();
        await expect(shoppingDialog()).toHaveCount(0);
        await page.unroute('**/api/shopping');
        expect(lost).toBe(true);
        expect(operations.size).toBe(1);
        const after = await readShopping();
        expect(after.contentRevision).toBe(before.contentRevision + 1);
        expect(after.document.recipeEntries[main.id].selectedServings).toBe(6);
        expect(after.document.recipeEntries[main.id].ingredients).toHaveLength(2);
        await cardMenu(main, 'Add to Shopping List');
        await yieldControl().fill('5');
        await submit().click();
        await expect(shoppingDialog()).toHaveCount(0);
      });
      checks.push('shopping-response-loss-dedup');

      await test.step('detail and print entry preserve selection and trigger focus', async () => {
        const editTrigger = await cardMenu(main, 'Edit recipe');
        await expect(page.getByRole('dialog', { name: 'Edit Recipe', exact: true })).toBeVisible();
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(editTrigger).toBeFocused();
        await cardMenu(main, 'Print recipe');
        await expect(page.getByTestId('recipe-detail-page')).toBeVisible();
        await expect(page.getByRole('heading', { level: 1, name: main.name })).toBeVisible();
        for (let index = 0;index < 5;index++) {
          await page.getByRole('button', { name: 'Increase yield', exact: true }).click();
        }
        const trigger = page.getByRole('button', { name: 'Add to Shopping List', exact: true });
        await trigger.click();
        await assertSaved();
        await cancelFocus(trigger);
        await geometry(page);
      });
      checks.push('detail-saved-selection');

      await test.step('Planner/Dashboard saved selector and cooked inclusion', async () => {
        await page.goto('/planner');
        const trigger = page.getByRole('button', {
          name: `Add ${main.name} ingredients to Shopping`, exact: true,
        });
        await trigger.click();
        await assertSaved();
        await cancelFocus(trigger);
        const fullWeek = page.getByRole('button', {
          name: 'Add planned meal ingredients to Shopping', exact: true,
        });
        await fullWeek.focus();
        await page.keyboard.press('Enter');
        await expect(yieldControl()).toHaveValue('5');
        await expect(shoppingDialog().getByRole('spinbutton', {
          name: `Selected yield for ${cooked.name}`, exact: true,
        })).toHaveValue('8');
        await geometry(page, shoppingDialog());
        await submit().click();
        await expect(shoppingDialog()).toHaveCount(0);
        expect((await readShopping()).document.recipeEntries[cooked.id].selectedServings).toBe(8);
        await page.goto('/dashboard');
        const dashboardTrigger = page.getByRole('button', {
          name: `Meal actions for ${main.name}`, exact: true,
        });
        await dashboardTrigger.click();
        await page.getByRole('menuitem', { name: 'Add to shopping', exact: true }).click();
        await assertSaved();
        await cancelFocus(dashboardTrigger);
      });
      checks.push('planner-dashboard-focus');

      await test.step('return week survives detail/back/reload and failed plan read', async () => {
        await page.goto('/planner');
        await page.getByRole('button', { name: 'Next week', exact: true }).click();
        const selectedURL = page.url();
        await page.locator('.planner-meal-title').filter({ hasText: main.name }).click();
        await expect(page.getByTestId('recipe-detail-page')).toBeVisible();
        await page.getByRole('button', { name: 'Back to planner', exact: true }).click();
        await expect(page).toHaveURL(selectedURL);
        await page.reload();
        await expect(page.locator('.planner-meal-card')).toHaveCount(3);
        const before = await readPlan(monday(7));
        await page.route('**/rest/v1/weekly_plans*', route => route.fulfill({
          status: 503,
          contentType: 'application/json', body: '{"message":"Qualification plan unavailable"}'
        }));
        await page.reload();
        await expect(page.getByText("Couldn't load this week's plan.", { exact: false }))
          .toBeVisible();
        await expect(page.getByRole('button', { name: 'Add meal', exact: true })).toHaveCount(0);
        await page.unroute('**/rest/v1/weekly_plans*');
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(page.locator('.planner-meal-card')).toHaveCount(3);
        await expect(page).toHaveURL(selectedURL);
        expect(await readPlan(monday(7))).toEqual(before);
      });
      checks.push('planner-return-week-read-retry');

      await test.step('real Planner move, cooked Undo, remove Undo, swap retry', async () => {
        await page.goto('/planner');
        const duplicateBefore = await readPlan();
        await page.getByRole('button', { name: 'Add meal', exact: true }).click();
        await page.getByRole('dialog').getByRole('textbox', { name: 'Search recipes to add' })
          .fill(main.name);
        await page.getByRole('dialog').getByRole('button').filter({ hasText: main.name }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Add to Plan', exact: true })
          .click();
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
        expect(await readPlan()).toEqual(duplicateBefore);
        await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
        const meal = () => page.locator('.planner-meal-card').filter({ hasText: main.name });
        await meal().getByRole('button', { name: 'Move to another day', exact: true }).click();
        await page.locator('[role="menuitem"]:not([data-disabled]):not([aria-disabled="true"])')
          .first().click();
        await expect.poll(async () => {
          const assignments = (await readPlan()).day_assignment_recipe_uuids;
          if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) {
            throw new Error('Expected canonical assignment map');
          }
          return assignments[main.id];
        }).not.toBe(today);
        await meal().getByRole('button', { name: `Mark ${main.name} as cooked`, exact: true })
          .click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readPlan()).made_recipe_uuids).toEqual([cooked.id]);
        await meal().getByRole('button', { name: `Remove ${main.name} from plan`, exact: true })
          .click();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await expect.poll(async () => (await readPlan()).recipe_uuids).toContain(main.id);
        const before = await readPlan();
        await meal().getByRole('button', { name: `Swap ${main.name}`, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByRole('textbox', { name: 'Search recipes to swap', exact: true })
          .fill(replacement.name);
        await page.route('**/rest/v1/rpc/replace_planned_recipe', route => route.fulfill({
          status: 503, contentType: 'application/json',
          body: '{"message":"Qualification swap unavailable"}',
        }));
        await dialog.getByRole('button', { name: `Swap with ${replacement.name}`, exact: true })
          .click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        expect(await readPlan()).toEqual(before);
        await page.unroute('**/rest/v1/rpc/replace_planned_recipe');
        await dialog.getByRole('button', { name: `Swap with ${replacement.name}`, exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(async () => (await readPlan()).recipe_uuids).toContain(replacement.id);
        expect((await readPlan()).recipe_uuids).not.toContain(main.id);
        await geometry(page);
      });
      checks.push('planner-move-cook-remove-swap');

      await test.step('global history Undo fails, retries only its captured row, prevents overlap',
        async () => {
          await page.goto('/recipes');
          const planBefore = await readPlan();
          const before = await readHistory();
          await cardMenu(main, 'Mark made');
          await expect.poll(async () => (await readHistory()).length).toBe(before.length + 1);
          const added = (await readHistory()).find(row => !before.some(old => old.id === row.id));
          if (!added) throw new Error('Expected exact created history identity');
          await page.route('**/rest/v1/recipe_history*', route => {
            if (route.request().method() !== 'DELETE') return route.continue();
            return route.fulfill({
              status: 503, contentType: 'application/json',
              body: '{"message":"Qualification Undo unavailable"}'
            });
          });
          await page.getByRole('button', { name: 'Undo', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Retry Undo', exact: true })).toBeVisible();
          expect((await readHistory()).some(row => row.id === added.id)).toBe(true);
          const newer = await admin.from('recipe_history').insert({
            user_id: primary.id, recipe_uuid: main.id,
          }).select('id').single();
          requireResult(newer.error, newer.data, 'seed newer exact history row');
          await page.unroute('**/rest/v1/recipe_history*');
          let deletes = 0;
          const pending = new Promise<void>(resolve => { releasePending = resolve; });
          await page.route('**/rest/v1/recipe_history*', async route => {
            if (route.request().method() !== 'DELETE') return route.continue();
            deletes++;
            const url = new URL(route.request().url());
            expect(url.searchParams.get('id')).toBe(`eq.${added.id}`);
            expect(url.searchParams.get('user_id')).toBe(`eq.${primary.id}`);
            await pending;
            return route.continue();
          });
          const retry = page.getByRole('button', { name: 'Retry Undo', exact: true });
          await retry.click();
          await expect(page.getByRole('button', { name: 'Retrying Undo…', exact: true }))
            .toBeDisabled();
          await page.keyboard.press('Enter');
          await page.keyboard.press('Enter');
          expect(deletes).toBe(1);
          releasePending!();
          await expect.poll(async () => (await readHistory()).some(row => row.id === added.id))
            .toBe(false);
          expect((await readHistory()).some(row => row.id === newer.data!.id)).toBe(true);
          expect(await readPlan()).toEqual(planBefore);
          await page.unroute('**/rest/v1/recipe_history*');
        });
      checks.push('history-exact-undo-retry');

      await test.step('server stale-source rejection retains draft/list', async () => {
        await cardMenu(main, 'Add to Shopping List');
        await assertSaved();
        const before = await readShopping();
        const updated = await admin.from('recipes').update({ servings: 7 })
          .eq('recipe_uuid', main.id)
          .eq('user_id', primary.id);
        requireResult(updated.error, true, 'change disposable recipe behind cached selector');
        await submit().click();
        await expect(shoppingDialog().getByRole('alert')).toBeVisible();
        await expect(yieldControl()).toHaveValue('5');
        expect(await readShopping()).toEqual(before);
        await shoppingDialog().getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.reload();
        await cardMenu(main, 'Add to Shopping List');
        await expect(shoppingDialog()).toBeVisible();
        await geometry(page, shoppingDialog());
        await shoppingDialog().getByRole('button', { name: 'Cancel', exact: true }).click();
      });
      checks.push('shopping-stale-source');
      expect(checks).toEqual(requiredChecks);
      expect(externalRequests).toBe(0);
      witnessStatus = await snapshot(witness) === witnessBefore ? 'unchanged' : 'changed';
      expect(witnessStatus).toBe('unchanged');
      mkdirSync(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, `${artifact}.png`), fullPage: true,
        animations: 'disabled', mask: [page.getByText(primary.email, { exact: true })]
      });
      passed = true;
    } catch (error) {
      primaryFailure = { error };
    } finally {
      try {
        // Reserve bounded teardown time even after an assertion failure/step timeout.
        info.setTimeout(info.timeout + 120_000);
        releasePending?.();
        for (const context of contexts) {
          try { await context.close(); } catch { cleanupComplete = false; }
        }
        if (owners[1] && witnessBefore) {
          try {
            witnessStatus = await snapshot(owners[1]) === witnessBefore ? 'unchanged' : 'changed';
          } catch { witnessStatus = 'snapshot-read-failed'; }
        }
        for (const value of owners) {
          let absent = false;
          try { absent = await cleanup(value, run); } catch { /* Continue other owned cleanup. */ }
          cleanupResults.push({ ownerId: value.id, absent });
          cleanupComplete = cleanupComplete && absent;
        }
        mkdirSync(directory, { recursive: true });
        writeFileSync(path.join(directory, `${artifact}.json`), JSON.stringify({
          schema: 2, sha: process.env.COMBINED_UI_EXPECTED_SHA, runId: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT, engine: info.project.name, viewport, checks,
          result: passed && witnessStatus === 'unchanged' && cleanupComplete && owners.length === 2
            ? 'PASS' : 'FAIL',
          stage, primaryFailure: primaryFailure !== undefined,
          setupError: primaryFailure?.error instanceof SetupFailure
            ? { operation: primaryFailure.error.operation, code: primaryFailure.error.code }
            : { operation: 'unknown', code: 'unknown' },
          witnessStatus, cleanupComplete, owners: cleanupResults,
          limitation: 'Injected browser faults; WebKit HTTP CSP accommodation; no sharing/import',
        }, null, 2));
        if (!cleanupComplete || owners.length !== 2) {
          throw new Error('Qualification cleanup/owner acquisition incomplete');
        }
        if (witnessStatus !== 'unchanged') {
          throw new Error(`Qualification witness status: ${witnessStatus}`);
        }
      } catch (error) {
        teardownFailure = { error };
      }
      finishQualification(primaryFailure, teardownFailure);
    }
  });
}
