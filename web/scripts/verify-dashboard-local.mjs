// Disposable, loopback-only Dashboard integration acceptance checks.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createLocalRuntime, localSupabaseEnvironment, LOCAL_APP_ORIGIN } from './local-e2e-runtime.mjs';
import { getWeekStartDate, getWeekDays } from '../src/components/planner/meal-planner.utils.ts';
import { createEmptyShoppingDocument } from '../src/lib/shopping-document.ts';

const root = process.cwd();
const status = createLocalRuntime(root).status();
if (!status.ok) throw new Error('Existing local Supabase is required. No reset or remote fallback.');
const local = localSupabaseEnvironment(status.output);
const admin = createClient(local.supabaseUrl, local.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const artifacts = path.resolve(root, '../.codex-artifacts/dashboard');
fs.mkdirSync(artifacts, { recursive: true });
const log = fs.openSync(path.join(artifacts, 'server.log'), 'w');
let server;
let browser;
let page;
let owner;
const errors = [];
const email = `dashboard-${randomUUID()}@example.test`;
const password = `Local-${randomUUID()}!`;
const ids = Array.from({ length: 5 }, () => randomUUID());
const names = ['Dashboard Soup', 'Dashboard Salad', 'Dashboard Pasta', 'Dashboard Curry', 'Dashboard Rice'];
const today = new Date();
const week = getWeekStartDate(today, 1);
const days = getWeekDays(week);
const todayDay = today.getDay();
const otherDay = (todayDay + 1) % 7;
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
let client;
async function readPlan() { return checked(await client.from('weekly_plans').select('*').eq('week_date', week).single()); }
async function readShopping() { return checked(await client.from('shopping_list').select('*').single()); }
async function fixture() {
  checked(await client.from('recipe_history').delete().eq('user_id', owner));
  checked(await client.from('weekly_plans').upsert({
    user_id: owner, week_date: week, recipe_uuids: ids.slice(0, 3), made_recipe_uuids: [],
    day_assignment_recipe_uuids: { [ids[0]]: todayDay, [ids[1]]: todayDay, [ids[2]]: otherDay }, scale: 1.5,
  }, { onConflict: 'user_id,week_date' }));
  const shopping = await readShopping();
  checked(await client.from('shopping_list').update({ document: createEmptyShoppingDocument(), content_revision: shopping.content_revision + 1 }).eq('user_id', owner).eq('content_revision', shopping.content_revision));
}
async function menu(name, action) {
  await page.locator('.dashboard-today').getByRole('button', { name: `Meal actions for ${name}`, exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}
async function axe(scope) {
  const result = await new AxeBuilder({ page }).include(scope).analyze();
  if (result.violations.length) fs.writeFileSync(path.join(artifacts, 'axe-failure.json'), JSON.stringify(result.violations, null, 2));
  expect(result.violations.map((v) => v.id)).toEqual([]);
}
async function dashboard() {
  await page.goto(`${LOCAL_APP_ORIGIN}/dashboard`);
  await expect(page.locator('.dashboard-today')).not.toContainText('Loading…');
  await expect(page.locator('.dashboard-week')).not.toContainText('Loading…');
  await expect(page.locator('.dashboard-shopping')).not.toContainText('Loading…');
}

try {
  owner = checked(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  client = createClient(local.supabaseUrl, local.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  checked(await client.auth.signInWithPassword({ email, password }));
  checked(await client.from('user_config').upsert({ user_id: owner, week_start_day: 1, onboarding_completed_at: new Date().toISOString() }, { onConflict: 'user_id' }));
  checked(await client.from('recipes').insert(ids.map((id, index) => ({
    id, recipe_uuid: id, user_id: owner, name: names[index], category: 'Dinner', servings: 4, total_time_minutes: 25,
    ingredient_sections: [{ label: null, ingredients: [
      { item: 'milk', amount: 1, unit: 'cup' }, { item: 'carrot', amount: 2, unit: '' },
      { item: 'olive oil', amount: 2, unit: 'tbsp' },
    ] }], instruction_sections: [{ label: null, steps: ['Cook the synthetic ingredients.'] }], notes: [],
  }))));
  if (await fetch(LOCAL_APP_ORIGIN).catch(() => null)) throw new Error('Port 3107 occupied; refusing an unknown server.');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3107'], {
    cwd: root, windowsHide: true, stdio: ['ignore', log, log],
    env: { ...process.env, RECIPE_GENIE_E2E_TARGET: 'local', NEXT_PUBLIC_SUPABASE_URL: local.supabaseUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.anonKey, SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey },
  });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if ((await fetch(LOCAL_APP_ORIGIN).catch(() => null))?.ok) break;
    if (server.exitCode !== null) throw new Error('Local server exited; inspect server.log.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await fetch(`${LOCAL_APP_ORIGIN}/dashboard`);
  browser = await chromium.launch();
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    await fixture();
    const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', timezoneId: 'America/Chicago' });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (request.url().includes('supabase.co')) errors.push('Unexpected remote Supabase request'); });
    await page.goto(`${LOCAL_APP_ORIGIN}/dashboard`);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page.locator('.dashboard-today').getByRole('article')).toHaveCount(2);
    await expect(page.locator('.dashboard-day-row')).toHaveCount(7);
    await expect(page.locator('.dashboard-is-today .dashboard-week-meal')).toHaveCount(2);
    await expect(page.locator('.dashboard-week')).toContainText(days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    const nav = page.getByRole('navigation', { name: name === 'desktop' ? 'Primary navigation' : 'Bottom navigation', exact: true });
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link')).toHaveCount(5);
    await nav.getByRole('link', { name: 'Pantry', exact: true }).click();
    await expect(page).toHaveURL(LOCAL_APP_ORIGIN + '/pantry');
    await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await expect(page.locator('.dashboard-today').getByRole('article')).toHaveCount(2);
    if (name === 'desktop') await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Help', exact: true })).not.toBeVisible();
    const bounds = await page.locator('.dashboard-today, .dashboard-shopping, .dashboard-week').evaluateAll((nodes) => nodes.map((node) => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y }; }));
    if (name === 'desktop') { expect(bounds[1].x).toBeGreaterThan(bounds[0].x); expect(bounds[2].x).toBe(bounds[0].x); }
    else { expect(bounds[1].y).toBeGreaterThan(bounds[0].y); expect(bounds[2].y).toBeGreaterThan(bounds[1].y); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await axe('.dashboard');
    await page.screenshot({ path: path.join(artifacts, `${name}-populated.png`), fullPage: true });

    // Canonical recipe route, refresh, return source, and direct-link fallback.
    await page.locator('.dashboard-today').getByRole('link', { name: 'Open Dashboard Soup', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/recipes/${ids[0]}\\?from=dashboard`));
    await page.reload();
    await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/dashboard`);
    await page.goto(`${LOCAL_APP_ORIGIN}/recipes/${ids[0]}`);
    await page.getByRole('button', { name: 'Back to recipes', exact: true }).click();
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/recipes`);
    await page.goto(LOCAL_APP_ORIGIN);
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/recipes`);
    await dashboard();

    // Keyboard menu access and focus restoration.
    const trigger = page.locator('.dashboard-today').getByRole('button', { name: 'Meal actions for Dashboard Soup', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await menu(names[0], 'Add to shopping');
    await page.getByLabel(`Selected yield for ${names[0]}`).fill('8');
    await page.getByLabel(`${names[0]}: olive oil, ingredient 3`, { exact: true }).uncheck();
    await axe('[role="dialog"]');
    expect(await page.getByRole('button', { name: 'Close', exact: true }).evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Add selected ingredients', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    let saved = await readShopping();
    expect(saved.document.recipeEntries[ids[0]].scaleV1).toEqual({ numerator: '2', denominator: '1' });
    expect(saved.document.recipeEntries[ids[0]].ingredients).toHaveLength(2);
    await menu(names[0], 'Add to shopping');
    await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('8');
    await expect(page.getByLabel(`${names[0]}: olive oil, ingredient 3`, { exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await page.getByRole('button', { name: 'Add week to shopping', exact: true }).click();
    await expect(page.getByLabel(`Selected yield for ${names[1]}`)).toHaveValue('6');
    await page.getByRole('button', { name: 'Add selected ingredients', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    saved = await readShopping();
    expect(Object.keys(saved.document.recipeEntries)).toHaveLength(3);
    await expect(page.locator('.dashboard-shopping')).toContainText('3 items remaining');

    // Quick add canonical duplicates, five-row preview, quantities and rapid taps.
    await page.getByLabel('Quick add shopping items').fill('apples, bread, coffee, dates, eggs, apples');
    await page.getByRole('button', { name: 'Add shopping items', exact: true }).click();
    await expect(page.locator('.dashboard-shopping')).toContainText('was already on the shopping list');
    await expect(page.getByLabel('Quick add shopping items')).toBeFocused();
    await expect(page.locator('.dashboard-shopping')).toContainText('8 items remaining');
    await expect(page.locator('.dashboard-shopping-row')).toHaveCount(5);
    await expect(page.locator('.dashboard-shopping')).toContainText('+ 3 more items');
    await page.route('**/rest/v1/shopping_list*', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });
    const checkbox = page.locator('.dashboard-shopping-row input').first();
    const label = await checkbox.getAttribute('aria-label');
    await checkbox.check();
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
    await expect(page.locator('.dashboard-shopping')).toContainText('8 items remaining');
    await checkbox.check();
    await expect(page.locator('.dashboard-shopping')).toContainText('7 items remaining');
    await page.waitForTimeout(2000);
    await page.unroute('**/rest/v1/shopping_list*');
    await page.getByRole('link', { name: 'View all →', exact: true }).click();
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/shopping`);
    await expect(page.getByRole('heading', { name: /Shopping/ }).first()).toBeVisible();
    await dashboard();
    await page.reload();
    await expect(page.locator('.dashboard-shopping')).toContainText('7 items remaining');

    // Cook, history date, cooked restrictions, then move/remove cooked meal.
    const card = page.locator('.dashboard-today').getByRole('article', { name: names[0], exact: true });
    await card.getByRole('button', { name: 'Mark as cooked', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Cooked', exact: true })).toBeDisabled();
    expect((await readPlan()).made_recipe_uuids).toContain(ids[0]);
    const history = checked(await client.from('recipe_history').select('*').eq('recipe_uuid', ids[0]));
    expect(new Date(history[0].date_made).getDate()).toBe(today.getDate());
    await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Swap meal', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('menuitem', { name: 'Add to shopping', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('menuitem', { name: 'Move to another day', exact: true }).click();
    await page.getByLabel('Scheduled day', { exact: true }).selectOption(String(otherDay));
    await page.getByRole('button', { name: 'Move meal', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await readPlan()).day_assignment_recipe_uuids[ids[0]]).toBe(otherDay);
    await page.getByRole('link', { name: 'Open planner →', exact: true }).click();
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/planner?week=${week}`);
    await expect(page.getByText(names[0], { exact: true }).first()).toBeVisible();
    await dashboard();
    const weekSoup = page.locator('.dashboard-week-meal').filter({ hasText: names[0] });
    await weekSoup.getByRole('button', { name: `Meal actions for ${names[0]}`, exact: true }).click();
    await page.getByRole('menuitem', { name: 'Remove from plan', exact: true }).click();
    await expect(weekSoup).toHaveCount(0);
    expect((await readShopping()).document.recipeEntries[ids[0]]).toBeTruthy();

    // Searchable explicit swap plus Surprise me through the guarded path.
    await menu(names[1], 'Swap meal');
    await page.getByLabel('Search recipes to swap').fill(names[3]);
    await page.getByLabel('Scheduled day', { exact: true }).selectOption(String(todayDay));
    await page.getByRole('button', { name: `Swap with ${names[3]}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await readPlan()).recipe_uuids).toContain(ids[3]);
    expect((await readShopping()).document.recipeEntries[ids[1]]).toBeTruthy();
    await menu(names[3], 'Swap meal');
    await page.getByRole('button', { name: 'Surprise me', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await readPlan()).recipe_uuids).not.toContain(ids[3]);

    // Existing picker receives the selected date, persistence and reload.
    const beforeAdd = await readPlan();
    const addIndex = ids.findIndex((id) => !beforeAdd.recipe_uuids.includes(id));
    await page.locator('.dashboard-today').getByRole('button', { name: 'Plan a meal', exact: true }).first().click();
    await page.getByPlaceholder('Search recipes...').fill(names[addIndex]);
    await page.getByRole('button', { name: new RegExp(names[addIndex]) }).click();
    await page.getByRole('button', { name: 'Add to Plan', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await readPlan()).day_assignment_recipe_uuids[ids[addIndex]]).toBe(todayDay);
    await page.reload();
    await expect(page.locator('.dashboard-today').getByRole('article', { name: names[addIndex], exact: true })).toBeVisible();

    // Section isolation, distinct loading/failure states, and retry.
    await page.route('**/rest/v1/pantry_items*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Injected local Pantry failure' }) }));
    await page.reload();
    await expect(page.locator('.dashboard-shopping').getByRole('alert')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.dashboard-today').getByRole('article').first()).toBeVisible();
    await expect(page.locator('.dashboard-shopping')).not.toContainText('Your shopping list is empty');
    await page.unroute('**/rest/v1/pantry_items*');
    await page.locator('.dashboard-shopping').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.dashboard-shopping').getByRole('alert')).toHaveCount(0);
    await page.route('**/rest/v1/weekly_plans*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Injected local plan failure' }) }));
    await page.reload();
    await expect(page.locator('.dashboard-today').getByRole('status')).toContainText('Loading…');
    await expect(page.locator('.dashboard-today').getByRole('alert')).toBeVisible({ timeout: 45000 });
    await expect(page.getByLabel('Quick add shopping items')).toBeVisible();
    await page.unroute('**/rest/v1/weekly_plans*');
    await page.locator('.dashboard-today').getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('.dashboard-today').getByRole('alert')).toHaveCount(0);

    // Real empty, all-cooked, completed Shopping and Sunday week boundaries.
    let currentPlan = await readPlan();
    checked(await client.from('weekly_plans').update({ made_recipe_uuids: currentPlan.recipe_uuids }).eq('week_date', week));
    await page.reload();
    await expect(page.locator('.dashboard-today').getByRole('article').first()).toBeVisible();
    await expect(page.getByLabel('Quick add shopping items')).toBeVisible();
    await expect(page.locator('.dashboard-today').getByRole('button', { name: 'Mark as cooked', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifacts, `${name}-all-cooked.png`), fullPage: true });
    // Check every preview row without clearing the persisted list.
    for (let index = 0; index < 12; index++) {
      const check = page.locator('.dashboard-shopping-row input:not(:checked)').first();
      if (!await check.count()) break;
      await check.check();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.dashboard-shopping')).toContainText('All shopping completed');
    await page.reload();
    await expect(page.locator('.dashboard-shopping')).toContainText('All shopping completed');
    await page.screenshot({ path: path.join(artifacts, name + '-shopping-completed.png'), fullPage: true });
    await page.getByRole('link', { name: 'View all →', exact: true }).click();
    await page.getByRole('button', { name: 'Complete Shopping', exact: true }).click();
    await dashboard();
    await expect(page.locator('.dashboard-shopping')).toContainText('Your shopping list is empty');
    saved = await readShopping();
    checked(await client.from('weekly_plans').delete().eq('user_id', owner));
    checked(await client.from('recipe_history').delete().eq('user_id', owner));

    await page.reload();
    await expect(page.locator('.dashboard-today')).toContainText('No meals planned today');
    await expect(page.locator('.dashboard-week')).toContainText('No meals planned this week');
    await expect(page.locator('.dashboard-day-row')).toHaveCount(7);
    await expect(page.locator('.dashboard-shopping')).toContainText('Your shopping list is empty');
    await page.screenshot({ path: path.join(artifacts, `${name}-empty.png`), fullPage: true });
    const sundayWeek = getWeekStartDate(today, 0);
    checked(await client.from('user_config').update({ week_start_day: 0 }).eq('user_id', owner));
    checked(await client.from('weekly_plans').upsert({ user_id: owner, week_date: sundayWeek, recipe_uuids: [ids[0]], made_recipe_uuids: [], day_assignment_recipe_uuids: { [ids[0]]: todayDay }, scale: 1 }, { onConflict: 'user_id,week_date' }));
    await page.reload();
    await expect(page.locator('.dashboard-day-date').first()).toContainText('Sun');
    await page.getByRole('link', { name: 'Open planner →', exact: true }).click();
    await expect(page).toHaveURL(`${LOCAL_APP_ORIGIN}/planner?week=${sundayWeek}`);
    checked(await client.from('user_config').update({ week_start_day: 1 }).eq('user_id', owner));
    await context.close();
    console.log(`${name}: Dashboard actions, selection/servings, Shopping preview/duplicates, cross-view reload, keyboard/focus, layout, errors/retry, real states, Sunday boundaries PASS`);
  }
  expect(errors).toEqual([]);
  console.log('Dashboard local-only acceptance checks PASS; Safari unverified.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    fs.writeFileSync(path.join(artifacts, 'failure.txt'), `${page.url()}\n${await page.locator('body').innerText()}\n${errors.join('\n')}`);
  }
  throw error;
} finally {
  await browser?.close();
  if (server) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else server.kill();
  }
  fs.closeSync(log);
  if (owner) checked(await admin.auth.admin.deleteUser(owner));
}
