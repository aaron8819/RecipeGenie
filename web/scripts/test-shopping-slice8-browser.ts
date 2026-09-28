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

async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const a = await owner();
      await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
      await apply(a, { type: 'initialize' });
      const recipeId = randomUUID();
      const inserted = await a.client.from('recipes').insert({ user_id: a.id, recipe_uuid: recipeId, name: 'Slice 8 lemon recipe',
        category: 'Dinner', servings: 4, tags: [], ingredient_sections: [{ label: null, ingredients: [{ item: 'lemon', amount: 2, unit: 'count' }] }],
        instruction_sections: [{ label: null, steps: ['Mix'] }] }).select('*').single();
      check(inserted.error, null, 'recipe fixture');
      const recipe = mapRecipeRows([inserted.data] as never)[0];
      await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
      await apply(a, extra(randomUUID(), 'lemon', 3));
      await apply(a, extra(randomUUID(), 'apple'));
      await apply(a, { type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { apple: 'dairy', lemon: 'dairy' } } });
      check((await a.client.from('shopping_list').select('document,content_revision,shopping_clear_undo_available,trip_id,content_epoch')).error, null, 'authenticated row metadata read');
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      try {
        await page.goto('http://127.0.0.1:3117/shopping');
        await page.getByLabel('Email', { exact: true }).fill(a.email);
        await page.getByLabel('Password', { exact: true }).fill(a.password);
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        await page.getByRole('link', { name: 'Go to Planner', exact: true }).waitFor();
        await page.goto('http://127.0.0.1:3117/shopping');
        const response = (type: string) => { const pending = page.waitForResponse(r => r.url().endsWith('/api/shopping') &&
          r.request().postDataJSON()?.phase === 'execute' && r.request().postDataJSON()?.command?.mutation?.type === type); pending.catch(() => {}); return pending; };
        const checking = response('setChecked');
        await page.getByRole('button', { name: /^Check off lemons?$/ }).click();
        check((await (await checking).json()).status, 'Applied', 'real UI check captures basis');
        await expect.poll(async () => projectShoppingDocument((await read(a)).document, []).items.find(row => row.orderingKey === 'lemon')?.checked).toBe(true);
        check((await read(a)).document.acknowledgements.lemon.basis.parts[0].amount.numerator, '5', 'UI acknowledges unrounded recipe plus extra total');
        const original = await read(a);
        await page.screenshot({ path: `../.codex-artifacts/slice8/browser-${viewport.width}-checked.png`, fullPage: true });
        async function clear() {
          await page.getByRole('button', { name: viewport.width === 390 ? 'Clear list' : 'Clear', exact: true }).click();
          const pending = response('complete');
          const dialog = page.getByRole('alertdialog');
          await dialog.getByRole('button', { name: 'Clear list', exact: true }).click();
          check((await (await pending).json()).receipt.undoAvailable, true, 'UI recipe Clear offers safe Undo');
          await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
        }
        await clear();
        await apply(a, { type: 'learnOrder', draggedRowRef: 'derived:lemon', draggedOrderingKey: 'lemon', sourceCategoryKey: 'dairy',
          targetRowRef: 'derived:apple', targetOrderingKey: 'apple', targetCategoryKey: 'dairy', placement: 'before' });
        const newerOrganization = (await read(a)).document.preferences;
        const undoing = response('undoClear');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        const restoredResponse = await (await undoing).json();
        check(restoredResponse.status, 'Applied', 'UI Undo coexists with second-session dormant move');
        const restored = await read(a);
        check(restored.document.recipeEntries, original.document.recipeEntries, 'UI restores frozen recipe');
        check(restored.document.preferences, newerOrganization, 'UI keeps newer ingredient order and category');
        check(restored.document.acknowledgements, original.document.acknowledgements, 'UI restores acknowledged content');
        await page.reload();
        await page.getByRole('button', { name: 'Check off apple', exact: true }).waitFor();
        check((await read(a)).document.preferences.ingredientOrderByCategory.dairy, ['lemon', 'apple'], 'returning identities retain moved dormant slots on reload');
        await page.screenshot({ path: `../.codex-artifacts/slice8/browser-${viewport.width}-restored.png`, fullPage: true });

        await clear();
        await apply(a, extra(randomUUID(), 'bread'));
        const changed = await read(a);
        const refusing = response('undoClear');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        check((await (await refusing).json()).status, 'UndoUnavailable', 'UI Undo refuses second-session content');
        await page.getByText('Shopping changed after Clear; Undo was not applied.', { exact: true }).waitFor();
        check(await read(a), changed, 'UI conflict preserves bread and all current state');
        await page.screenshot({ path: `../.codex-artifacts/slice8/browser-${viewport.width}-conflict.png`, fullPage: true });
        await page.reload();
        await page.getByRole('button', { name: 'Check off bread', exact: true }).waitFor();
        await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
        await page.reload();
        await page.getByRole('button', { name: 'Check off bread', exact: true }).waitFor();
        await clear();
        await apply(a, { type: 'deleteRecipe', recipeId });
        const deletedState = await read(a);
        const missingSource = response('undoClear');
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        check((await (await missingSource).json()).status, 'SourceUnavailable', 'UI refuses recipe deleted in second session');
        await page.getByText('A saved recipe is no longer available. Undo was not applied.', { exact: true }).waitFor();
        check(await read(a), deletedState, 'source refusal restores no manual subset');
        await page.screenshot({ path: `../.codex-artifacts/slice8/browser-${viewport.width}-source-unavailable.png`, fullPage: true });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
        check(errors, [], 'no browser runtime errors');
        evidence[viewport.width] = { original, restored, changed, errors };
      } catch (error) {
        await page.screenshot({ path: `../.codex-artifacts/slice8/browser-${viewport.width}-failure.png`, fullPage: true });
        console.error(await page.locator('body').innerText()); throw error;
      } finally { await context.close(); }
    }
    complete = true;
  } finally {
    await browser.close();
    for (const id of owners) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
    await db.end();
    writeFileSync('../.codex-artifacts/slice8/browser-results.json', JSON.stringify({ complete, checks, evidence }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
