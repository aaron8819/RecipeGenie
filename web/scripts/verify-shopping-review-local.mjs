// Disposable loopback-only Chrome acceptance; never reset shared fixtures or services.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { chromium, expect } from '@playwright/test';
import {
  assertLocalFixtureMigrations,
  parseEnv,
  resolveSupabaseCli,
} from './local-e2e-runtime.mjs';
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
} from '../src/lib/shopping-document.ts';
import { initializeShoppingDocument } from '../src/lib/shopping-initialization.ts';
import { getWeekStartDate } from '../src/components/planner/meal-planner.utils.ts';

const root = process.cwd();
const appOrigin = 'http://127.0.0.1:3146';
// Pass an existing supported stack directory; this command only reads its status.
// Example: node --import tsx scripts/verify-shopping-review-local.mjs <backend-workdir>
const backendRoot = path.resolve(process.argv[2] ?? path.join(root, '..'));
const config = fs.readFileSync(path.join(backendRoot, 'supabase', 'config.toml'), 'utf8');
const project = config.match(/^project_id\s*=\s*"([^"\r\n]+)"/m)?.[1];
if (!['Recipe_Genie', 'Recipe_Genie_Shopping_Integration'].includes(project)) {
  throw new Error('Only an existing recognized Recipe Genie local stack is allowed.');
}
const apiPort = config.match(/\[api\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
const expectedOrigin = `http://127.0.0.1:${apiPort}`;
if (!['http://127.0.0.1:54321', 'http://127.0.0.1:62821'].includes(expectedOrigin)) {
  throw new Error('Unexpected local stack port; refusing fixture writes.');
}
const status = spawnSync(
  resolveSupabaseCli(root).absolutePath,
  ['status', '-o', 'env', '--workdir', backendRoot],
  { encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true },
);
if (status.status !== 0)
  throw new Error('Existing local backend required; no start/reset/fallback.');
const values = parseEnv(status.stdout);
const local = {
  supabaseUrl: values.API_URL,
  anonKey: values.ANON_KEY,
  serviceRoleKey: values.SERVICE_ROLE_KEY,
};
if (local.supabaseUrl !== expectedOrigin || !local.anonKey || !local.serviceRoleKey) {
  throw new Error('Local stack origin/key evidence is incomplete or contradictory.');
}
const databaseUrl = new URL(values.DB_URL ?? '');
const dbPort = config.match(/\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
if (
  !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
  databaseUrl.hostname !== '127.0.0.1' ||
  databaseUrl.port !== dbPort ||
  databaseUrl.pathname !== '/postgres'
) {
  throw new Error('Fixture SQL requires the same explicitly guarded loopback stack.');
}
const db = postgres(databaseUrl.href, { max: 1, onnotice: () => undefined });
const admin = createClient(local.supabaseUrl, local.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const artifacts = path.join(
  root,
  '..',
  '.codex-artifacts',
  'shopping-review',
  `${Date.now()}-${randomUUID().slice(0, 8)}`,
);
fs.mkdirSync(artifacts, { recursive: true });
const sourceFiles = [
  'src/components/shopping/shopping-selection-dialog.tsx',
  'src/lib/shopping-selection.ts',
  'src/lib/shopping-document.ts',
  'src/lib/shopping-command-planner.ts',
  'src/lib/shopping-initialized-command.ts',
];
const receipt = {
  base: spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim(),
  sourceHashes: Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ]),
  ),
  target: appOrigin,
  backend: local.supabaseUrl,
  journeys: [],
  cleanup: false,
};
const owners = [];
let server;
let browser;
let page;
let client;
const log = fs.openSync(path.join(artifacts, 'server.log'), 'w');
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function capture(file) {
  await page.evaluate(async () => {
    const animations = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.screenshot({ path: path.join(artifacts, file) });
}
async function saved() {
  return checked(await client.from('shopping_list').select('document,content_revision').single());
}
try {
  const ledger = await db`select version from supabase_migrations.schema_migrations`;
  assertLocalFixtureMigrations(
    ledger.map((row) => row.version),
    ['024', '029', '030'],
  );
  receipt.requiredFixtureMigrations = ['024', '029', '030'];
  if (await fetch(appOrigin).catch(() => null))
    throw new Error('Dedicated port occupied; refusing reuse.');
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3146',
    ],
    {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        RECIPE_GENIE_E2E_TARGET: 'local',
        NEXT_PUBLIC_SUPABASE_URL: local.supabaseUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
      },
      stdio: ['ignore', log, log],
    },
  );
  await expect
    .poll(async () => Boolean((await fetch(appOrigin).catch(() => null))?.ok), { timeout: 120000 })
    .toBe(true);
  browser = await chromium.launch({ channel: 'chrome' });
  receipt.browser = browser.version();
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['phone-emulation', { width: 390, height: 844 }],
  ]) {
    const email = `shopping-review-${randomUUID()}@example.test`;
    const password = `Local-${randomUUID()}!`;
    const owner = checked(
      await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    ).user.id;
    owners.push(owner);
    client = createClient(local.supabaseUrl, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    checked(await client.auth.signInWithPassword({ email, password }));
    const ids = [randomUUID(), randomUUID()];
    const names = ['Review Soup', 'Review Salad'];
    const sections = [
      {
        label: 'Soup',
        ingredients: [
          { item: 'onion', amount: 1, unit: '' },
          { item: 'kosher salt', amount: 1, unit: 'tsp' },
          { item: 'carrot', amount: 1, unit: '' },
          { item: 'cilantro', amount: 1, unit: 'cup', modifier: 'optional' },
        ],
      },
      { label: 'Optional Garnish', ingredients: [{ item: 'parsley', amount: 1, unit: 'cup' }] },
    ];
    checked(
      await client.from('recipes').insert(
        ids.map((id, index) => ({
          id,
          recipe_uuid: id,
          user_id: owner,
          name: names[index],
          category: 'Dinner',
          servings: 4,
          ingredient_sections: sections,
          instruction_sections: [{ label: null, steps: ['Cook the soup.'] }],
          notes: [],
        })),
      ),
    );
    checked(await client.from('pantry_items').insert({ user_id: owner, item: 'onion' }));
    checked(
      await client
        .from('user_config')
        .update({ onboarding_completed_at: new Date().toISOString() })
        .eq('user_id', owner),
    );
    const document = initializeShoppingDocument(createEmptyShoppingDocument(), []);
    document.preferences.excludeSaltVariants = true;
    const current = await saved();
    // Supported disposable fixture setup only. UI writes below use the real command API.
    await db`update public.shopping_list set document=${db.json(document)},
      content_revision=${current.content_revision + 1} where user_id=${owner}`;
    const baseline = (await saved()).content_revision;
    const week = getWeekStartDate(new Date(), 1);
    checked(
      await client.from('weekly_plans').upsert(
        {
          user_id: owner,
          week_date: week,
          recipe_uuids: ids,
          made_recipe_uuids: [ids[1]],
          scale: 1,
          day_assignment_recipe_uuids: {
            [ids[0]]: new Date().getDay(),
            [ids[1]]: new Date().getDay(),
          },
        },
        { onConflict: 'user_id,week_date' },
      ),
    );

    const context = await browser.newContext({ viewport, hasTouch: name === 'phone-emulation' });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname.endsWith('supabase.co')) {
        errors.push('Unexpected hosted backend request');
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${appOrigin}/recipes`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const ingredient = (recipeName, item, ordinal) =>
      page.getByLabel(`${recipeName}: ${item}, ingredient ${ordinal}`, { exact: true });
    const add = (count) =>
      page.getByRole('button', {
        name: `Add ${count} ${count === 1 ? 'ingredient' : 'ingredients'}`,
        exact: true,
      });
    async function defaults(recipeName) {
      await expect(ingredient(recipeName, 'onion', 1)).not.toBeChecked();
      await expect(ingredient(recipeName, 'kosher salt', 2)).not.toBeChecked();
      await expect(ingredient(recipeName, 'carrot', 3)).toBeChecked();
      await expect(ingredient(recipeName, 'cilantro', 4)).not.toBeChecked();
      await expect(ingredient(recipeName, 'parsley', 5)).not.toBeChecked();
      await expect(dialog).toContainText('In pantry');
      await expect(dialog).toContainText('Excluded');
      await expect(dialog).toContainText('Optional');
    }

    // Actual recipe-list menu, default review, empty-selection guard and cancellation.
    await page
      .getByRole('button', { name: 'Actions for Review Salad', exact: true })
      .waitFor({ state: 'visible', timeout: 90000 });
    await page.getByRole('button', { name: 'Actions for Review Salad', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add to Shopping List', exact: true }).click();
    await defaults('Review Salad');
    await ingredient('Review Salad', 'carrot', 3).uncheck();
    await expect(add(0)).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await saved()).content_revision).toBe(baseline);

    // Actual Planner single-recipe review: explicit inclusion survives the command and database.
    await page.goto(`${appOrigin}/planner`);
    const cart = page.getByRole('button', {
      name: 'Add Review Soup ingredients to Shopping',
      exact: true,
    });
    await cart.waitFor({ state: 'visible', timeout: 90000 });
    await cart.click();
    await defaults('Review Soup');
    await ingredient('Review Soup', 'onion', 1).check();
    await ingredient('Review Soup', 'kosher salt', 2).check();
    await page.getByLabel('Selected yield for Review Soup').fill('8');
    await expect(ingredient('Review Soup', 'onion', 1)).toBeChecked();
    await expect(ingredient('Review Soup', 'cilantro', 4)).not.toBeChecked();
    await expect(add(3)).toBeEnabled();
    await capture(`${name}-single.png`);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await add(3).click();
    await expect(dialog).toHaveCount(0);
    let stored = await saved();
    expect(
      stored.document.recipeEntries[ids[0]].sourceEvidence.occurrences.map(
        (source) => source.ordinal,
      ),
    ).toEqual([0, 1, 2]);
    expect(stored.document.recipeEntries[ids[0]].scaleV1).toEqual({
      numerator: '2',
      denominator: '1',
    });
    expect(
      projectShoppingDocument(stored.document, [{ item: 'onion' }]).items.map(
        (row) => row.orderingKey,
      ),
    ).toEqual(expect.arrayContaining(['onion', 'kosher salt', 'carrot']));
    expect(stored.document.preferences.excludeSaltVariants).toBe(true);
    await cart.click();
    await expect(page.getByLabel('Selected yield for Review Soup')).toHaveValue('8');
    await expect(ingredient('Review Soup', 'kosher salt', 2)).toBeChecked();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Actual whole-plan review includes cooked meals and fresh defaults for the other recipe.
    await page
      .getByRole('button', { name: 'Add planned meal ingredients to Shopping', exact: true })
      .click();
    await defaults('Review Salad');
    await expect(ingredient('Review Soup', 'kosher salt', 2)).toBeChecked();
    await expect(dialog).toContainText('cooked meals are included');
    await page.getByLabel('Selected yield for Review Soup').fill('4');
    await expect(ingredient('Review Soup', 'onion', 1)).toBeChecked();
    await capture(`${name}-week.png`);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await add(4).click();
    await expect(dialog).toHaveCount(0);
    stored = await saved();
    expect(
      stored.document.recipeEntries[ids[1]].sourceEvidence.occurrences.map(
        (source) => source.ordinal,
      ),
    ).toEqual([2]);
    expect(
      projectShoppingDocument(stored.document, [{ item: 'onion' }]).items.find(
        (row) => row.orderingKey === 'carrot',
      ).sources,
    ).toHaveLength(2);

    // Actual recipe-detail review restores saved identities; manually checked optional reaches Shopping.
    await page.goto(`${appOrigin}/recipes/${ids[1]}`);
    await page.getByRole('button', { name: 'Add to Shopping List', exact: true }).click();
    await defaults('Review Salad');
    await ingredient('Review Salad', 'parsley', 5).check();
    await page.getByLabel('Selected yield for Review Salad').fill('8');
    await ingredient('Review Salad', 'carrot', 3).uncheck();
    await expect(add(1)).toBeEnabled();
    await add(1).click();
    await expect(dialog).toHaveCount(0);
    stored = await saved();
    expect(
      stored.document.recipeEntries[ids[1]].sourceEvidence.occurrences.map(
        (source) => source.ordinal,
      ),
    ).toEqual([4]);
    expect(
      projectShoppingDocument(stored.document, [{ item: 'onion' }]).items.some(
        (row) => row.orderingKey === 'parsley',
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Add to Shopping List', exact: true }).click();
    await expect(ingredient('Review Salad', 'parsley', 5)).toBeChecked();
    await expect(ingredient('Review Salad', 'carrot', 3)).not.toBeChecked();
    await capture(`${name}-detail.png`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await saved()).content_revision).toBe(stored.content_revision);
    expect(errors).toEqual([]);
    receipt.journeys.push({
      name,
      viewport,
      physicalDevice: false,
      status: 'PASS',
      checks: [
        'recipe-list cancellation/empty guard',
        'Planner single defaults/manual inclusion/scaling',
        'Planner week/cooked inclusion/aggregation',
        'recipe-detail optional persistence/reopening',
        'unchanged exclusion preference',
        'no dialog horizontal overflow',
        'no page errors',
      ],
    });
    await context.close();
    await client.auth.signOut();
    console.log(`${name}: PASS`);
  }
} catch (error) {
  receipt.failure = error.message;
  if (page && !page.isClosed())
    await page.screenshot({ path: path.join(artifacts, 'failure.png') });
  throw error;
} finally {
  await browser?.close();
  if (server)
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  fs.closeSync(log);
  for (const owner of owners) checked(await admin.auth.admin.deleteUser(owner));
  await db.end();
  receipt.cleanup = true;
  fs.writeFileSync(path.join(artifacts, 'receipt.json'), JSON.stringify(receipt, null, 2));
}
