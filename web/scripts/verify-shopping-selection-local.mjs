// Disposable local-only verification. Never resets the shared local database.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  createLocalRuntime,
  localSupabaseEnvironment,
  LOCAL_APP_ORIGIN,
} from './local-e2e-runtime.mjs';
import { mapRecipeRows } from '../src/lib/recipe-identity.ts';
import {
  initialShoppingSelection,
  createSelectedShoppingEntry,
} from '../src/lib/shopping-selection.ts';
import {
  createEmptyShoppingDocument,
  validateShoppingDocumentV3,
  projectShoppingDocument,
} from '../src/lib/shopping-document.ts';
import { replacePlannedRecipe } from '../src/hooks/use-replace-planned-recipe.ts';
import { getWeekStartDate } from '../src/components/planner/meal-planner.utils.ts';

const root = process.cwd();
const status = createLocalRuntime(root).status();
if (!status.ok)
  throw new Error(
    'Existing local Supabase is required; no reset or remote fallback.',
  );
const local = localSupabaseEnvironment(status.output);
const admin = createClient(local.supabaseUrl, local.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `shopping-selection-${randomUUID()}@example.test`;
const password = `Local-${randomUUID()}!`;
let owner;
let foreignOwner;
const foreignRecipeId = randomUUID();
let server;
let browser;
let activePage;
let activeErrors = [];
const artifacts = path.join(
  root,
  '..',
  '.codex-artifacts',
  'shopping-selection',
);
fs.mkdirSync(artifacts, { recursive: true });
const serverLog = fs.openSync(path.join(artifacts, 'server.log'), 'w');
function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

try {
  owner = checked(
    await admin.auth.admin.createUser({ email, password, email_confirm: true }),
  ).user.id;
  const client = createClient(local.supabaseUrl, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  checked(await client.auth.signInWithPassword({ email, password }));
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const ingredients = [
    {
      label: null,
      ingredients: [
        { item: 'milk', amount: 1, unit: 'cup' },
        { item: 'olive oil', amount: 2, unit: 'tbsp' },
        { item: 'carrot', amount: 2, unit: '' },
      ],
    },
  ];
  const inserted = checked(
    await client
      .from('recipes')
      .insert(
        ids.map((id, i) => ({
          recipe_uuid: id,
          id,
          user_id: owner,
          name: ['Selection Soup', 'Selection Salad', 'Selection Pasta'][i],
          category: i === 2 ? 'Lunch' : 'Dinner',
          servings: 4,
          ingredient_sections: ingredients,
          instruction_sections: [
            { label: null, steps: ['Cook the fixture ingredients.'] },
          ],
          notes: [],
        })),
      )
      .select('*'),
  );
  const recipes = mapRecipeRows(inserted);
  const foreignEmail = `shopping-selection-${randomUUID()}@example.test`;
  foreignOwner = checked(
    await admin.auth.admin.createUser({
      email: foreignEmail,
      password,
      email_confirm: true,
    }),
  ).user.id;
  const foreignClient = createClient(local.supabaseUrl, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  checked(
    await foreignClient.auth.signInWithPassword({
      email: foreignEmail,
      password,
    }),
  );
  checked(
    await foreignClient.from('recipes').insert({
      recipe_uuid: foreignRecipeId,
      id: foreignRecipeId,
      user_id: foreignOwner,
      name: 'Foreign fixture',
      category: 'Dinner',
      servings: 4,
      ingredient_sections: ingredients,
      instruction_sections: [{ label: null, steps: ['Cook.'] }],
      notes: [],
    }),
  );

  const week = getWeekStartDate(new Date(), 1);
  checked(
    await client.from('weekly_plans').upsert(
      {
        user_id: owner,
        week_date: week,
        recipe_uuids: ids.slice(0, 2),
        made_recipe_uuids: [ids[1]],
        day_assignment_recipe_uuids: {
          [ids[0]]: new Date().getDay(),
          [ids[1]]: new Date().getDay(),
        },
        scale: 1,
      },
      { onConflict: 'user_id,week_date' },
    ),
  );
  checked(
    await client
      .from('user_config')
      .update({ onboarding_completed_at: new Date().toISOString() })
      .eq('user_id', owner),
  );
  async function writeFixtureDocument(document) {
    const current = checked(
      await client.from('shopping_list').select('content_revision').single(),
    );
    const revision = current.content_revision + 1;
    checked(
      await client
        .from('shopping_list')
        .update({ document, content_revision: revision })
        .eq('user_id', owner)
        .eq('content_revision', current.content_revision),
    );
    return revision;
  }
  const empty = createEmptyShoppingDocument();
  await writeFixtureDocument(empty);

  // Prove filtered V3 contributions survive the actual SQL validator and RLS.
  const selection = {
    ...initialShoppingSelection(recipes[0]).selection,
    selectedYield: 8,
    ingredientOrdinals: [0, 2],
  };
  empty.recipeEntries[recipes[0].id] = createSelectedShoppingEntry(
    recipes[0],
    selection,
  );
  await writeFixtureDocument(empty);
  const roundTrip = checked(
    await client.from('shopping_list').select('document').single(),
  ).document;
  expect(validateShoppingDocumentV3(roundTrip).ok).toBe(true);
  expect(roundTrip.recipeEntries[recipes[0].id].ingredients.length).toBe(2);
  expect(
    projectShoppingDocument(roundTrip).items.find(
      (row) => row.displayName === 'milk',
    ).quantity.amount,
  ).toBe(2);
  await writeFixtureDocument(createEmptyShoppingDocument());

  // Only this explicitly guarded loopback app is used for credentials and writes.
  const probe = await fetch(LOCAL_APP_ORIGIN).catch(() => null);
  if (probe)
    throw new Error(
      'Port 3107 is already in use; refusing to reuse an unknown app server.',
    );
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--port',
      '3107',
      '--hostname',
      '127.0.0.1',
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
      stdio: ['ignore', serverLog, serverLog],
    },
  );
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const response = await fetch(LOCAL_APP_ORIGIN).catch(() => null);
    if (response?.ok) break;
    if (server.exitCode !== null)
      throw new Error('Local app server exited. See ignored server.log.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // Compile the authenticated route before browser navigation timeouts begin.
  await fetch(`${LOCAL_APP_ORIGIN}/planner`);
  for (const [name, type, viewport] of [
    ['desktop', chromium, { width: 1440, height: 900 }],
    ['mobile', chromium, { width: 390, height: 844 }],
  ]) {
    const baselineRevision = await writeFixtureDocument(
      createEmptyShoppingDocument(),
    );
    browser = await type.launch();
    const context = await browser.newContext({
      viewport,
      hasTouch: name === 'mobile',
    });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(30000);
    const errors = [];
    activeErrors = errors;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('supabase.co'))
        errors.push('Unexpected remote Supabase request');
    });
    await page.goto(`${LOCAL_APP_ORIGIN}/planner`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const cart = page.getByRole('button', {
      name: 'Add Selection Soup ingredients to Shopping',
      exact: true,
    });
    await cart.waitFor({ state: 'visible', timeout: 60000 });
    await cart.click();
    await page.getByLabel('Selected yield for Selection Soup').fill('8');
    await page
      .getByLabel('Selection Soup: olive oil, ingredient 2', { exact: true })
      .uncheck();
    await page.screenshot({ path: path.join(artifacts, `${name}.png`) });
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    if (accessibility.violations.length)
      console.log(
        JSON.stringify(
          accessibility.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              failureSummary: n.failureSummary,
            })),
          })),
        ),
      );
    expect(accessibility.violations.map((v) => v.id)).toEqual([]);
    expect(
      await page
        .getByRole('dialog')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Add selected ingredients', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20000 });
    let saved = checked(
      await client
        .from('shopping_list')
        .select('document,content_revision')
        .single(),
    );
    expect(saved.document.recipeEntries[ids[0]].ingredients.length).toBe(2);
    expect(saved.document.recipeEntries[ids[0]].scaleV1).toEqual({
      numerator: '2',
      denominator: '1',
    });
    expect(saved.content_revision).toBe(baselineRevision + 1);
    // Reopening restores the saved subset; re-adding never multiplies quantities.
    const previousEntry = saved.document.recipeEntries[ids[0]];
    await cart.click();
    await expect(
      page.getByLabel('Selected yield for Selection Soup'),
    ).toHaveValue('8');
    await expect(
      page.getByLabel('Selection Soup: olive oil, ingredient 2', {
        exact: true,
      }),
    ).not.toBeChecked();
    await page
      .getByRole('button', { name: 'Add selected ingredients', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    saved = checked(
      await client
        .from('shopping_list')
        .select('document,content_revision')
        .single(),
    );
    expect(saved.content_revision).toBe(baselineRevision + 2);
    expect(saved.document.recipeEntries[ids[0]]).toEqual(previousEntry);
    await page
      .getByRole('button', {
        name: 'Add planned meal ingredients to Shopping',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      'cooked meals are included',
    );
    await expect(
      page.getByLabel('Selection Salad', { exact: true }),
    ).toBeChecked();
    await page
      .getByRole('button', { name: 'Add selected ingredients', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    saved = checked(
      await client.from('shopping_list').select('document').single(),
    );
    expect(Object.keys(saved.document.recipeEntries).length).toBe(2);
    expect(
      projectShoppingDocument(saved.document).items.find(
        (row) => row.displayName === 'milk',
      ).quantity.amount,
    ).toBe(3);
    // Guard failures are exercised through the actual production command.
    const today = new Date().getDay();
    const swapInput = {
      weekDate: week,
      oldRecipeId: ids[0],
      replacementRecipeId: ids[2],
      expectedDayOfWeek: today,
      dayOfWeek: (today + 1) % 7,
    };
    await expect(
      replacePlannedRecipe(client, owner, {
        ...swapInput,
        oldRecipeId: ids[1],
      }),
    ).rejects.toThrow('cooked meal');
    await expect(
      replacePlannedRecipe(client, owner, {
        ...swapInput,
        replacementRecipeId: ids[1],
      }),
    ).rejects.toThrow('already planned');
    await expect(
      replacePlannedRecipe(client, owner, {
        ...swapInput,
        expectedDayOfWeek: (today + 2) % 7,
      }),
    ).rejects.toThrow('moved');
    await expect(
      replacePlannedRecipe(client, owner, {
        ...swapInput,
        replacementRecipeId: randomUUID(),
      }),
    ).rejects.toBeDefined();
    await expect(
      replacePlannedRecipe(client, owner, {
        ...swapInput,
        replacementRecipeId: foreignRecipeId,
      }),
    ).rejects.toBeDefined();
    const racingClient = createClient(local.supabaseUrl, local.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (url, options) => {
          if (
            options?.method === 'PATCH' &&
            String(url).includes('/weekly_plans')
          ) {
            checked(
              await client
                .from('weekly_plans')
                .update({ made_recipe_uuids: ids.slice(0, 2) })
                .eq('week_date', week),
            );
          }
          return fetch(url, options);
        },
      },
    });
    checked(await racingClient.auth.signInWithPassword({ email, password }));
    await expect(
      replacePlannedRecipe(racingClient, owner, swapInput),
    ).rejects.toThrow('plan changed');
    expect(
      checked(
        await client
          .from('weekly_plans')
          .select('recipe_uuids')
          .eq('week_date', week)
          .single(),
      ).recipe_uuids,
    ).toEqual(ids.slice(0, 2));
    checked(
      await client
        .from('weekly_plans')
        .update({ made_recipe_uuids: [ids[1]] })
        .eq('week_date', week),
    );

    await page
      .getByRole('button', { name: 'Swap Selection Soup', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Swap with Selection Salad' }),
    ).toBeDisabled();
    await page
      .getByLabel('Scheduled day', { exact: true })
      .selectOption(String(swapInput.dayOfWeek));
    await page.getByLabel('Search recipes to swap').fill('Selection Pasta');
    await page.screenshot({ path: path.join(artifacts, `${name}-swap.png`) });
    const swapAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze();
    expect(swapAccessibility.violations.map((v) => v.id)).toEqual([]);
    expect(
      await page
        .getByRole('dialog')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Swap with Selection Pasta' })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20000 });
    const swapped = checked(
      await client
        .from('weekly_plans')
        .select('*')
        .eq('week_date', week)
        .single(),
    );
    expect(swapped.recipe_uuids).toEqual([ids[2], ids[1]]);
    expect(swapped.made_recipe_uuids).toEqual([ids[1]]);
    expect(swapped.scale).toBe(1);
    expect(swapped.day_assignment_recipe_uuids).toEqual({
      [ids[2]]: swapInput.dayOfWeek,
      [ids[1]]: today,
    });
    expect(
      checked(await client.from('shopping_list').select('document').single())
        .document,
    ).toEqual(saved.document);
    await expect(
      replacePlannedRecipe(client, owner, swapInput),
    ).rejects.toThrow('no longer');
    console.log(
      `${name}: explicit cross-category swap, chosen day, cooked/duplicate/stale guards, unrelated state, Shopping preservation, accessibility PASS`,
    );
    // Restore only this disposable account's plan for the next viewport.
    checked(
      await client
        .from('weekly_plans')
        .update({
          recipe_uuids: ids.slice(0, 2),
          day_assignment_recipe_uuids: { [ids[0]]: today, [ids[1]]: today },
        })
        .eq('week_date', week),
    );
    expect(errors).toEqual([]);
    await context.close();
    await browser.close();
    browser = null;
    console.log(
      `${name}: real Planner selection, servings, partial persistence, saved recovery, idempotent re-addition, weekly cooked inclusion, aggregation, accessibility PASS`,
    );
  }
  console.log('Local SQL validator and authenticated V3 round-trip PASS');
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(artifacts, 'failure.png') });
    console.log(
      'Failure page:',
      activePage.url(),
      'Browser errors:',
      activeErrors,
    );
  }
  throw error;
} finally {
  await browser?.close();
  if (server) {
    if (process.platform === 'win32') {
      const { spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else server.kill();
  }
  fs.closeSync(serverLog);
  if (owner) checked(await admin.auth.admin.deleteUser(owner));
  if (foreignOwner) checked(await admin.auth.admin.deleteUser(foreignOwner));
}
