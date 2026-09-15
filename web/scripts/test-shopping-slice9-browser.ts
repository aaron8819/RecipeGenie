import { inspectOrganization } from '../src/lib/shopping-organization';
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
 const browser=await chromium.launch();
 try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
   const a=await owner(); await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
   await apply(a,{type:'initialize'});
   for(const name of ['apple','banana','carrot','lemon']) await apply(a,extra(randomUUID(),name));
   const context=await browser.newContext({viewport}); const page=await context.newPage(); const errors:string[]=[];
   page.on('pageerror',e=>errors.push(String(e)));
   try {
    await page.goto('http://127.0.0.1:3117/shopping');
    await page.getByLabel('Email',{exact:true}).fill(a.email); await page.getByLabel('Password',{exact:true}).fill(a.password);
    await page.getByRole('button',{name:'Sign In',exact:true}).click();
    await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor(); await page.goto('http://127.0.0.1:3117/shopping');
    async function open(){await page.getByRole('button',{name:'Organize',exact:true}).click();await page.getByRole('menuitem',{name:'Shopping settings'}).click();await page.getByRole('dialog',{name:'Shopping organization'}).waitFor();}
    const dialog=page.getByRole('dialog',{name:'Shopping organization'});
    const execute=async(button:string,expected='Applied')=>{
     const response=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
     await dialog.getByRole('button',{name:button,exact:true}).click();
     const result=await(await response).json();check(result.status,expected,`UI ${button} ${expected}`);
     await expect(dialog.getByRole('button',{name:'Review latest organization'})).toBeEnabled();
     return result;
    };
    await open();
    await dialog.getByLabel('Purchase to organize').selectOption('carrot');
    await dialog.getByLabel('Destination category',{exact:true}).selectOption('dairy');
    await dialog.getByLabel('Purchase position').selectOption('start');
    await dialog.getByRole('button',{name:'Move purchase',exact:true}).focus();
    const keyboardResponse=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
    await page.keyboard.press('Enter');check((await(await keyboardResponse).json()).status,'Applied','S53 keyboard move to empty category');
    await expect(dialog.getByRole('button',{name:'Undo move',exact:true})).toBeVisible();
    check((await read(a)).document.preferences.ingredientOrderByCategory.dairy,['carrot'],'keyboard move persisted');
    await page.screenshot({path:`../.codex-artifacts/slice9/organization-${viewport.width}.png`,fullPage:true});
    await execute('Undo move');
    check((await read(a)).document.preferences.ingredientOrderByCategory.produce,['apple','banana','carrot','lemon'],'conditional UI inverse persisted');
    // Open draft remains frozen across a second session write and background GET.
    const snap=await read(a);
    await apply(a,inspectOrganization(snap.document,{kind:'move',key:'carrot',destination:{categoryKey:'frozen',at:'end'}}));
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    const frozen=await read(a);
    await execute('Move purchase','Conflict');
    await expect(dialog.getByText(/Your choices are preserved/)).toBeVisible();
    check(await read(a),frozen,'stale UI draft conflict preserves exact database state');
    await page.screenshot({path:`../.codex-artifacts/slice9/conflict-${viewport.width}.png`,fullPage:true});
    await dialog.getByRole('button',{name:'Review latest organization',exact:true}).click();
    await expect(dialog.getByText(/Latest organization loaded/)).toBeVisible();
    await execute('Move purchase');
    // Lost response: server commits, client sees transport failure, retry returns receipt.
    let dropped=false;const seen:any[]=[];
    await page.route('**/api/shopping',async route=>{
     const body=route.request().postDataJSON();
     if(body?.phase==='execute'&&body.command?.mutation?.type==='organize') {
      const response=await route.fetch();seen.push({operationId:body.operationId,sequence:body.sequence,result:await response.json()});
      if(!dropped){dropped=true;await route.abort('failed');return;}await route.fulfill({response});return;
     }await route.continue();
    });
    await dialog.getByLabel('Purchase to organize').selectOption('apple');
    await execute('Move purchase','AlreadyApplied');
    await page.unroute('**/api/shopping');
    check(seen.map(r=>r.result.status),['Applied','AlreadyApplied'],'lost response recovered via same receipt');
    check(new Set(seen.map(r=>r.operationId)).size,1,'lost response retains operation');
    check(Number((await db`select count(*) from private.shopping_admissions where user_id=${a.id} and operation_id=${seen[0].operationId} and receipt is not null`)[0].count),1,'one authoritative move receipt');
    // Immediate category deletion persists even when editor closes/reloads.
    await dialog.getByLabel('Category name',{exact:true}).fill('Market');await execute('Create category');
    let row=await read(a);const custom='custom_'+row.document.preferences.customCategories[0].id;
    await dialog.getByLabel('Destination category',{exact:true}).selectOption(custom);await execute('Move purchase');
    await dialog.getByLabel('Category to edit').selectOption(custom);
    await dialog.getByLabel('Destination category',{exact:true}).selectOption('misc');await execute('Delete category');
    row=await read(a);check(row.document.preferences.categoryByIngredient.apple,'misc','deletion persisted selected fallback');
    check(row.document.preferences.customCategories,[],'category deletion immediate');
    await execute('Undo category deletion');
    check((await read(a)).document.preferences.categoryByIngredient.apple,custom,'category deletion Undo restores remembered placement');
    await execute('Delete category');row=await read(a);
    await page.reload();await page.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();await open();
    check((await read(a)).document.preferences,row.document.preferences,'reload preserves organization');
    await dialog.getByLabel('Purchase to organize').selectOption('apple');await execute('Reset category');
    await execute('Reset position');
    const reset=await read(a);check(reset.document.preferences.ingredientOrderByCategory.produce.at(-1),'apple','UI reset position remembered');
    await page.screenshot({path:`../.codex-artifacts/slice9/reset-${viewport.width}.png`,fullPage:true});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no horizontal overflow');
    check(errors,[],'no runtime exceptions');evidence[viewport.width]={seen,preferences:reset.document.preferences};
   } finally {await context.close();}
  }
  complete=true;
 } finally {await browser.close();for(const id of owners) assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end();writeFileSync('../.codex-artifacts/slice9/browser-results.json',JSON.stringify({complete,checks,evidence},null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
