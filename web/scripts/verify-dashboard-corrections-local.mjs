import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium, expect as playwrightExpect } from '@playwright/test';
const expect = playwrightExpect.configure({ timeout: 30000 });
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { getWeekStartDate } from '../src/components/planner/meal-planner.utils.ts';

// This verifier is deliberately bound to the task-owned disposable stack.
// It never reads ambient credentials or resets another backend.
const status = JSON.parse(readFileSync('../.codex-artifacts/dashboard-backend/status.json', 'utf8'));
assert.equal(status.API_URL, 'http://127.0.0.1:55321');
const origin = 'http://127.0.0.1:3127';
const db = postgres({host:'127.0.0.1',port:55322,user:'postgres',password:'postgres',database:'postgres',max:5,onnotice:()=>{}});
assert.equal((await db`select max(version) as version from supabase_migrations.schema_migrations`)[0].version, '031');
const admin = createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const artifacts='../.codex-artifacts/dashboard-corrections'; mkdirSync(artifacts,{recursive:true});
const owners=[]; const evidence=[]; let browser; let page;
const checked=r=>{if(r.error) throw Error(r.error.message);return r.data;};
const week=getWeekStartDate(new Date(),1), today=new Date().getDay();
function record(label){evidence.push(label);console.log('PASS '+label);}
async function focusAfter(trigger,open,dismiss){
 await trigger.focus();await open();await expect(page.getByRole('dialog')).toBeVisible();
 await expect.poll(()=>page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await expect(page.getByRole('menu')).toHaveCount(0);
 await dismiss();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(trigger).toBeFocused();
}
async function menu(recipe,action){
 await page.getByRole('button',{name:`Meal actions for ${recipe}`,exact:true}).first().click();
 await page.getByRole('menuitem',{name:action,exact:true}).click();
}
try {
 // Use installed Chromium on Windows ARM; bundled headless-shell stalls here.
 browser=await chromium.launch(process.platform==='win32'?{channel:'msedge'}:{});
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const email=`dashboard-fixes-${randomUUID()}@example.test`,password=`Local-${randomUUID()}!`;
  const owner=checked(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;owners.push(owner);
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  checked(await client.auth.signInWithPassword({email,password}));
  checked(await client.from('user_config').upsert({user_id:owner,week_start_day:1,onboarding_completed_at:new Date().toISOString()},{onConflict:'user_id'}));
  const ids=[randomUUID(),randomUUID(),randomUUID()],names=['Correction Soup','Correction Salad','Correction Curry'];
  checked(await client.from('recipes').insert(ids.map((id,i)=>({recipe_uuid:id,user_id:owner,name:names[i],category:'Dinner',servings:4,
   ingredient_sections:[{label:null,ingredients:[{item:'milk',amount:1,unit:'cup'},{item:'carrot',amount:2,unit:''}]}],instruction_sections:[{label:null,steps:['Cook.']}],notes:[]}))));
  checked(await client.from('weekly_plans').upsert({user_id:owner,week_date:week,recipe_uuids:[ids[0]],made_recipe_uuids:[],day_assignment_recipe_uuids:{[ids[0]]:today},scale:1.5},{onConflict:'user_id,week_date'}));
  const context=await browser.newContext({viewport,timezoneId:'America/Chicago'});page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='example.com')return route.fulfill({contentType:'image/png',body:readFileSync('public/pwa-icon-192.png')});return ['127.0.0.1','localhost'].includes(u.hostname)||u.protocol==='data:'?route.continue():route.abort();});
  await page.goto(origin+'/shopping',{waitUntil:'domcontentloaded'});await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.getByRole('button',{name:'Update this shopping list',exact:true}).click();
  await expect.poll(async()=> (await db`select document->>'schemaVersion' as version from public.shopping_list where user_id=${owner}`)[0].version).toBe('4');
  console.log('Authenticated '+viewport.width);
  const read=async()=>checked(await client.from('shopping_list').select('*').single());
  await page.goto(origin+'/planner',{waitUntil:'domcontentloaded'});
  const shoppingTrigger=page.getByRole('button',{name:`Add ${names[0]} ingredients to Shopping`,exact:true}).first();
  for(const dismiss of [()=>page.keyboard.press('Escape'),()=>page.getByRole('button',{name:'Cancel',exact:true}).click()]){
   await focusAfter(shoppingTrigger,async()=>{await shoppingTrigger.click();await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('6');},dismiss);
  }
  const swapTrigger=page.getByRole('button',{name:`Swap ${names[0]}`,exact:true}).first();
  for(const dismiss of [()=>page.keyboard.press('Escape'),()=>page.getByRole('button',{name:'Cancel',exact:true}).click()])await focusAfter(swapTrigger,()=>swapTrigger.click(),dismiss);
  const addTrigger=page.locator('[data-planner-empty-slot]').first();
  for(const dismiss of [()=>page.keyboard.press('Escape'),()=>page.getByRole('button',{name:'Cancel',exact:true}).click()])await focusAfter(addTrigger,()=>addTrigger.click(),dismiss);
  record(`${viewport.width}: Planner Add/Swap/Shopping Cancel and Escape restore focus; meal yield=6`);
  await page.getByRole('button',{name:'Add planned meal ingredients to Shopping',exact:true}).click();await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('6');await page.keyboard.press('Escape');
  await page.goto(origin+'/dashboard',{waitUntil:'domcontentloaded'});
  const dashboardTrigger=page.getByRole('button',{name:`Meal actions for ${names[0]}`,exact:true}).first();
  for(const action of ['Add to shopping','Swap meal'])for(const dismiss of [()=>page.keyboard.press('Escape'),()=>page.getByRole('button',{name:'Cancel',exact:true}).click()])await focusAfter(dashboardTrigger,()=>menu(names[0],action),dismiss);
  await menu(names[0],'Add to shopping');await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('6');
  await page.getByLabel(`Selected yield for ${names[0]}`).fill('8');await page.getByLabel(`${names[0]}: milk, ingredient 1`,{exact:true}).uncheck();
  await page.getByRole('button',{name:'Add selected ingredients',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(dashboardTrigger).toBeFocused();
  let saved=await read();assert.equal(saved.document.recipeEntries[ids[0]].selectedServings,8);assert.equal(saved.document.recipeEntries[ids[0]].ingredients.length,1);assert.equal(saved.document.recipeEntries[ids[0]].sourceEvidence.occurrences[0].ordinal,1);
  await page.reload();await menu(names[0],'Add to shopping');await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('8');await expect(page.getByLabel(`${names[0]}: milk, ingredient 1`,{exact:true})).not.toBeChecked();
  await page.getByRole('button',{name:'Add selected ingredients',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);assert.deepEqual((await read()).document.recipeEntries,saved.document.recipeEntries);
  await expect(page.getByRole('checkbox',{name:'Check off carrot',exact:true})).toBeVisible();await page.getByRole('checkbox',{name:'Check off carrot',exact:true}).click();
  await expect.poll(async()=>Object.values((await read()).document.acknowledgements??{}).some(a=>a.basis!==null)).toBe(true);
  console.log('Dashboard check saved; opening Shopping');
  await page.goto(origin+'/shopping',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Expand Fresh Produce category',exact:true}).click();await expect(page.getByRole('button',{name:'Check off carrots',exact:true,pressed:true})).toBeVisible();await page.getByRole('button',{name:'Check off carrots',exact:true,pressed:true}).click();
  await expect.poll(async()=>Object.values((await read()).document.acknowledgements??{}).every(a=>a.basis===null)).toBe(true);
  await page.goto(origin+'/planner',{waitUntil:'domcontentloaded'});await shoppingTrigger.click();await expect(page.getByLabel(`Selected yield for ${names[0]}`)).toHaveValue('8');await page.keyboard.press('Escape');
  record(`${viewport.width}: initialized partial sources/adjusted yield, saved reopen/re-add/reload and shared check-off persist across Dashboard, Planner and Shopping`);
  await page.goto(origin+'/dashboard',{waitUntil:'domcontentloaded'});await menu(names[0],'Swap meal');
  const detail=await context.newPage();await detail.goto(`${origin}/recipes/${ids[0]}`);await detail.getByRole('button',{name:'Mark made',exact:true}).click();
  await expect.poll(async()=> (await db`select count(*)::int as n from public.recipe_history where user_id=${owner} and recipe_uuid=${ids[0]}`)[0].n).toBe(1);
  const before=checked(await client.from('weekly_plans').select('*').eq('week_date',week).single());assert.equal(before.made_recipe_uuids.includes(ids[0]),false);
  const shoppingBefore=await read();await page.bringToFront();await page.getByRole('button',{name:`Swap with ${names[1]}`,exact:true}).click();await expect(page.getByRole('dialog')).toContainText('A cooked meal cannot be swapped.');
  assert.deepEqual(checked(await client.from('weekly_plans').select('*').eq('week_date',week).single()),before);assert.deepEqual(await read(),shoppingBefore);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await detail.close();
  record(`${viewport.width}: actual recipe-history cooking in another tab rejects stale Dashboard swap without changing plan/history/scale/Shopping`);
  // Photo URLs exercise host admission and failure fallback; HTTP storage is
  // tested by unit policy and remains subject to baseline CSP restrictions.
  for(const photo of ['https://example.com/photo.jpg',origin+'/pwa-icon-192.png',null,origin+'/missing-correction-photo.jpg']){
   checked(await client.from('recipes').update({image_url:photo}).eq('recipe_uuid',ids[0]));await page.reload();await expect(page.locator('.dashboard-today')).toContainText(names[0]);await expect(page.getByText('Something went wrong',{exact:true})).toHaveCount(0);
   const photos=page.locator('.dashboard-today article img');
   if(photo==='https://example.com/photo.jpg'||photo===origin+'/pwa-icon-192.png')await expect.poll(()=>photos.first().evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
   else await expect(photos).toHaveCount(0);
  }
  const dashboardAdd = page.getByRole('button',{name:'Plan a meal',exact:true}).first();
  for(const dismiss of [()=>page.keyboard.press('Escape'),()=>page.getByRole('button',{name:'Cancel',exact:true}).click()])await focusAfter(dashboardAdd,()=>dashboardAdd.click(),dismiss);
  await dashboardAdd.click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(names[1])}).click();await page.getByRole('button',{name:'Add to Plan',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(dashboardAdd).toBeFocused();
  await menu(names[1],'Swap meal');await page.getByRole('button',{name:`Swap with ${names[2]}`,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeFocused();
  await page.goto(origin+'/planner',{waitUntil:'domcontentloaded'});
  const newSwap=page.getByRole('button',{name:`Swap ${names[2]}`,exact:true}).first();await newSwap.click();
  let failSwap=true;
  const swapFailure=route=>failSwap?(failSwap=false,route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Local retry check',code:'P0001'})})):route.continue();
  await context.route('**/rest/v1/rpc/replace_planned_recipe',swapFailure);
  const retryPlan=checked(await client.from('weekly_plans').select('*').eq('week_date',week).single());
  await page.getByRole('button',{name:`Swap with ${names[1]}`,exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Local retry check');
  assert.deepEqual(checked(await client.from('weekly_plans').select('*').eq('week_date',week).single()),retryPlan);
  await page.getByRole('button',{name:`Swap with ${names[1]}`,exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('[aria-label="Meal planner"]')).toBeFocused();
  await context.unroute('**/rest/v1/rpc/replace_planned_recipe',swapFailure);
  const addControl=await addTrigger.elementHandle();
  await addTrigger.click();await page.getByRole('dialog').getByRole('button',{name:new RegExp(names[2])}).click();
  let failAdd=true;
  const addFailure=route=>failAdd&&route.request().method()!=='GET'?(failAdd=false,route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Local add retry check',code:'P0001'})})):route.continue();
  await context.route('**/rest/v1/weekly_plans*',addFailure);
  const addPlan=checked(await client.from('weekly_plans').select('*').eq('week_date',week).single());
  await page.getByRole('button',{name:'Add to Plan',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  assert.deepEqual(checked(await client.from('weekly_plans').select('*').eq('week_date',week).single()),addPlan);
  await page.getByRole('button',{name:'Add to Plan',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.unroute('**/rest/v1/weekly_plans*',addFailure);
  await expect.poll(()=>addControl.evaluate(el=>el.isConnected?el===document.activeElement:document.activeElement?.getAttribute('aria-label')==='Meal planner')).toBe(true);
  const newShopping=page.getByRole('button',{name:`Add ${names[1]} ingredients to Shopping`,exact:true}).first();await newShopping.click();
  let failShopping=true;
  const shoppingFailure=route=>failShopping?(failShopping=false,route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({status:'RetryCapacity'})})):route.continue();
  await context.route('**/api/shopping',shoppingFailure);
  const retryShopping=await read();
  await page.getByRole('button',{name:'Add selected ingredients',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();assert.deepEqual(await read(),retryShopping);
  await page.getByRole('button',{name:'Add selected ingredients',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(newShopping).toBeFocused();
  await context.unroute('**/api/shopping',shoppingFailure);
  record(`${viewport.width}: Dashboard Add dismissal/success; Planner Add/Swap/Shopping failures preserve state and dialogs, retry succeeds with trigger/fallback focus`);
  await page.goto(origin+'/dashboard',{waitUntil:'domcontentloaded'});
  await page.screenshot({path:`${artifacts}/${viewport.width}-dashboard.png`,fullPage:true});
  assert.deepEqual(errors,[]);record(`${viewport.width}: external/same-origin/missing/failed photos preserve route; no page errors`);
  await context.close();
 }
 console.log('Browser corrections complete');writeFileSync(`${artifacts}/evidence.json`,JSON.stringify(evidence,null,2));
} catch(error){console.error(error);if(page){console.error('Focus at failure:',await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),text:document.activeElement?.textContent?.slice(0,100)})).catch(()=>null));await page.screenshot({path:`${artifacts}/failure.png`,fullPage:true}).catch(()=>{});}throw error;}
finally{if(browser)await browser.close();for(const owner of owners)checked(await admin.auth.admin.deleteUser(owner));await db.end();}
