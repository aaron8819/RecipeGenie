import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { mapRecipeRows } from '../src/lib/recipe-identity';
import { createShoppingRecipeEntry, projectShoppingDocument } from '../src/lib/shopping-document';

const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const db = postgres({ host:'127.0.0.1', port:57322, database:'postgres', user:'postgres', password:'postgres', max:5, onnotice:()=>{} });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const owners:string[]=[];
const evidence:any={}; let checks=0; let complete=false;
function check(a:any,b:any,label:string){assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);}
async function owner(){const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID();
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(r.error,null);const id=r.data.user!.id;owners.push(id);
 const jar=new Map<string,string>();const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>jar.set(c.name,c.value))}});
 assert.equal((await client.auth.signInWithPassword({email,password})).error,null);
 return {id,client,email,password,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};}
type Owner=Awaited<ReturnType<typeof owner>>;
const read=async(a:Owner)=>(await db`select document,content_revision,trip_id,content_epoch from public.shopping_list where user_id=${a.id}`)[0];
const cmd=(mutation:any,revision:number,more:any={})=>({protocol:1,observedRevision:revision,mutation,...more});
async function http(a:Owner,body:any){const r=await fetch('http://127.0.0.1:3117/api/shopping',{method:'POST',headers:{Origin:'http://127.0.0.1:3117',Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function admit(a:Owner,command:any){const operationId=randomUUID();const r=await http(a,{phase:'admit',operationId,command});assert.equal(r.status,'Admitted');return {phase:'execute',operationId,sequence:r.sequence,command};}
async function send(a:Owner,command:any){return http(a,await admit(a,command));}
async function apply(a:Owner,mutation:any){const r=await send(a,cmd(mutation,Number((await read(a)).content_revision)));check(r.status,'Applied',mutation.type);return r;}
const extra=(id:string,name:string,amount=1)=>({type:'addManualItem',item:{id,displayName:name,quantity:{amount,unit:'count'},categoryKey:'produce',bucket:'items',checked:false}});

type Page = import('playwright').Page;
function response(page: Page, type: string) {
  return page.waitForResponse(r => r.url().endsWith('/api/shopping') &&
    r.request().postDataJSON()?.phase === 'execute' && r.request().postDataJSON()?.command?.mutation?.type === type);
}
async function login(page: Page, a: Owner) {
  await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
  await page.goto('http://127.0.0.1:3117/shopping');
  await page.getByLabel('Email', { exact: true }).fill(a.email);
  await page.getByLabel('Password', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('link', { name: 'Go to Planner', exact: true }).waitFor();
  await page.goto('http://127.0.0.1:3117/shopping');
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      for (const finding of ['alternatives', 'package']) {
        const a = await owner(); await apply(a, { type: 'initialize' });
        const id = randomUUID();
        if (finding === 'alternatives') {
          const inserted = await a.client.from('recipes').insert({ user_id: a.id, recipe_uuid: id,
            name: 'Alternative coverage', category: 'Dinner', servings: 4, tags: [],
            ingredient_sections: [{ label: null, ingredients: [{ item: 'yogurt', amount: 2, unit: 'cup', alternatives: ['sour cream'] }] }],
            instruction_sections: [{ label: null, steps: ['Mix'] }] }).select('*').single();
          assert.equal(inserted.error, null);
          await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(mapRecipeRows([inserted.data] as never)[0], 4, { numerator: '1', denominator: '1' }) });
        } else await apply(a, { type: 'addManualItem', item: { id, displayName: 'tomato', quantity: { amount: 2, unit: 'can' }, categoryKey: 'produce', bucket: 'items', checked: false } });
        const context = await browser.newContext({ viewport }); const page = await context.newPage();
        await login(page, a);
        const checking = response(page, 'setChecked');
        await page.getByRole('button', { name: finding === 'alternatives' ? 'Check off yogurt' : 'Check off tomato', exact: true }).click();
        check((await (await checking).json()).status, 'Applied', 'actual checkbox acknowledgement');
        await expect.poll(async () => projectShoppingDocument((await read(a)).document, []).items[0]?.checked).toBe(true);
        if (finding === 'alternatives') {
          const changed = await a.client.from('recipes').update({ ingredient_sections: [{ label: null, ingredients: [{ item: 'yogurt', amount: 2, unit: 'cup' }] }] }).eq('recipe_uuid', id).select('*').single();
          assert.equal(changed.error, null);
          await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(mapRecipeRows([changed.data] as never)[0], 4, { numerator: '1', denominator: '1' }) });
        } else await apply(a, { type: 'editManualItem', id, changes: { quantity: { amount: 1, unit: 'can' } } });
        await page.reload();
        await page.getByText('Requirement changed', { exact: true }).waitFor();
        check(projectShoppingDocument((await read(a)).document, []).items[0].checked, false, `${finding} persists reopened after reload`);
        await page.screenshot({ path: `../.codex-artifacts/review/${finding}-${viewport.width}-corrected.png`, fullPage: true });
        const key = finding === 'alternatives' ? 'yogurt' : 'tomato';
        // Task-owned persisted compatibility fixture: simulate retained V1 evidence.
        await db`update public.shopping_list set document=jsonb_set(document,
          array['acknowledgements',${key},'basis','comparisonVersion'],'1'::jsonb),content_revision=content_revision+1 where user_id=${a.id}`;
        await page.reload();
        await page.getByText('Please recheck: the previous check did not save enough ingredient or package detail.', { exact: true }).waitFor();
        check((await read(a)).document.acknowledgements[key].basis.comparisonVersion, 1, 'read retains previous coverage evidence');
        await page.screenshot({ path: `../.codex-artifacts/review/recheck-${finding}-${viewport.width}.png`, fullPage: true });
        const rechecking = response(page, 'setChecked');
        await page.getByRole('button', { name: `Check off ${key}`, exact: true }).click();
        check((await (await rechecking).json()).receipt.outcome, 'Applied', 'explicit recheck saves corrected basis');
        await page.reload();
        await page.getByText('All items checked', { exact: false }).waitFor();
        check((await read(a)).document.acknowledgements[key].basis.comparisonVersion, 2, 'recheck survives reload');
        await context.close();
      }
      for (const scenario of ['delayed-cache', 'delayed-read', 'read-failure', 'lost-response', 'rejected', 'normal', 'organization', 'invalid-undo']) {
        const a = await owner(); await apply(a, { type: 'initialize' }); await apply(a, extra(randomUUID(), 'lemon'));
        const context = await browser.newContext({ viewport }); const page = await context.newPage();
        const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
        const gate = deferred(), held = deferred();
        try {
          await login(page, a); await page.getByRole('button', { name: /^Check off lemon/ }).waitFor();
          if (scenario === 'delayed-cache') await page.clock.install();
          let armed = true;
          if (['delayed-cache', 'delayed-read', 'read-failure'].includes(scenario)) {
            await page.route('**/rest/v1/shopping_list*', async route => {
              if (route.request().method() !== 'GET' || !armed) { await route.continue(); return; }
              if (scenario === 'read-failure') { await route.abort(); return; }
              armed = false;
              if (scenario === 'delayed-read') { held.resolve(); await gate.promise; await route.continue(); return; }
              const actual = await route.fetch(); held.resolve(); await gate.promise; await route.fulfill({ response: actual });
            });
          }
          if (scenario === 'lost-response') await page.route('**/api/shopping', async route => {
            const body = route.request().postDataJSON();
            if (armed && body.phase === 'execute' && body.command.mutation.type === 'complete') {
              armed = false; const actual = await route.fetch();
              check((await actual.json()).receipt.outcome, 'Applied', 'lost response committed before network loss');
              await route.abort();
            } else await route.continue();
          });
          if (scenario === 'rejected') await apply(a, extra(randomUUID(), 'bread'));
          const executing = response(page, 'complete');
          await page.getByRole('button', { name: viewport.width === 390 ? 'Clear list' : 'Clear', exact: true }).click();
          const result = await (await executing).json();
          check(result.receipt.outcome, scenario === 'rejected' ? 'Conflict' : 'Applied', `${scenario} authoritative outcome`);
          if (scenario.startsWith('delayed-')) {
            await held.promise; await apply(a, extra(randomUUID(), 'bread'));
            if (scenario === 'delayed-cache') {
              // Advance freshness deterministically; held responses select race order.
              await page.clock.fastForward(31000);
              const refreshing = page.waitForResponse(r => r.url().includes('/rest/v1/shopping_list') && r.request().method() === 'GET');
              await page.evaluate(() => window.dispatchEvent(new Event('offline')));
              await page.evaluate(() => window.dispatchEvent(new Event('online')));
              await refreshing;
              await page.getByRole('button', { name: 'Check off bread', exact: true }).waitFor();
            }
            gate.resolve();
          }
          if (scenario === 'rejected') {
            await page.getByText(/confirm Clear again; nothing was cleared/).waitFor();
            check((await read(a)).document.manualItems.length, 2, 'rejected Clear preserves all content');
          } else {
            await page.getByText(scenario === 'lost-response' ? 'The earlier Clear was confirmed. Showing the current list.' :
              scenario === 'read-failure' ? 'Clear confirmed. Could not refresh the list; reload to see current state. Undo is unavailable.' :
              scenario.startsWith('delayed-') ? 'Shopping list cleared. Undo is unavailable for this Clear.' : 'Shopping list cleared', { exact: true }).waitFor();
            check((await read(a)).document.manualItems.map((item: any) => item.displayName), scenario.startsWith('delayed-') ? ['bread'] : [], 'persisted Clear outcome');
            if (['normal', 'organization', 'invalid-undo', 'lost-response'].includes(scenario)) {
              if (scenario === 'organization') await apply(a, { type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { lemon: 'dairy' } } });
              if (scenario === 'invalid-undo') await apply(a, extra(randomUUID(), 'bread'));
              const undoing = response(page, 'undoClear');
              await page.getByRole('button', { name: 'Undo', exact: true }).click();
              check((await (await undoing).json()).receipt.outcome, scenario === 'invalid-undo' ? 'UndoUnavailable' : 'Applied', `${scenario} Undo authority`);
              if (scenario === 'invalid-undo') await page.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true }).waitFor();
              else await page.getByRole('button', { name: /^Check off lemon/ }).waitFor();
              if (scenario === 'organization') check((await read(a)).document.preferences.categoryByIngredient.lemon, 'dairy', 'Undo retains organization');
            } else if (scenario !== 'rejected') await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
          }
          const receipts = await db`select receipt from private.shopping_admissions where user_id=${a.id} and receipt->>'outcome'='Applied'`;
          check(receipts.filter(row => Number(row.receipt.revision) === result.receipt.revision).length, 1, 'no second Clear commit');
          check(errors, [], 'no browser runtime errors');
          check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
          await page.screenshot({ path: `../.codex-artifacts/review/clear-${scenario}-${viewport.width}.png`, fullPage: true });
          await page.unrouteAll({ behavior: 'wait' });
          const saved = await read(a); await page.reload();
          await page.getByRole('heading', { name: 'Shopping List', exact: true }).waitFor();
          check(await read(a), saved, 'reload preserves saved results');
          evidence[`${viewport.width}-${scenario}`] = { outcome: result, revision: saved.content_revision };
        } finally { gate.resolve(); await context.close(); }
      }
    }
    complete = true;
  } finally {
    await browser.close();
    for (const id of owners) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
    await db.end();
    writeFileSync('../.codex-artifacts/review/corrections-browser-results.json', JSON.stringify({ complete, checks, evidence }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
