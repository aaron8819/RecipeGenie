import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getWeekStartDate } from '../src/components/planner/meal-planner.utils.ts';

const expect=playwrightExpect.configure({timeout:30000});
const s=JSON.parse(readFileSync('../.codex-artifacts/dashboard-final-backend/status.json','utf8'));
assert.equal(s.API_URL,'http://127.0.0.1:62421');
const origin='http://127.0.0.1:3147', baseline=process.argv.includes('--expect-baseline');
const admin=createClient(s.API_URL,s.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const artifacts='../.codex-artifacts/dashboard-final';mkdirSync(artifacts,{recursive:true});
const checked=r=>{if(r.error)throw Error(r.error.message);return r.data;};
const browser=await chromium.launch({channel:'msedge'}),owners=[],results=[];
let page;
const png=readFileSync('public/pwa-icon-192.png');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  const email=`dashboard-final-${randomUUID()}@example.test`,password=`Local-${randomUUID()}!`;
  const owner=checked(await admin.auth.admin.createUser({email,password,email_confirm:true})).user.id;owners.push(owner);
  const client=createClient(s.API_URL,s.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  checked(await client.auth.signInWithPassword({email,password}));
  checked(await client.from('user_config').upsert({user_id:owner,week_start_day:1,onboarding_completed_at:new Date().toISOString()}));
  const ids=[randomUUID(),randomUUID(),randomUUID()],names=['Focus Soup','Focus Salad','Focus Curry'];
  checked(await client.from('recipes').insert(ids.map((id,i)=>({recipe_uuid:id,user_id:owner,name:names[i],category:'Dinner',servings:4,
   ingredient_sections:[{label:null,ingredients:[{item:'milk',amount:1,unit:'cup'},{item:'carrot',amount:2,unit:''}]}],instruction_sections:[{label:null,steps:['Cook.']}],notes:[]}))));
  const week=getWeekStartDate(new Date(),1),today=new Date().getDay();
  const setPlan=async(recipeIds)=>checked(await client.from('weekly_plans').upsert({user_id:owner,week_date:week,recipe_uuids:recipeIds,made_recipe_uuids:[],day_assignment_recipe_uuids:Object.fromEntries(recipeIds.map(id=>[id,today])),scale:1.5},{onConflict:'user_id,week_date'}));
  await setPlan([ids[0]]);
  const context=await browser.newContext({viewport,timezoneId:'America/Chicago'});page=await context.newPage();page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',()=>errors.push('pageerror')); // No URLs/tokens in reports.
  let optimizerStatuses=[];
  page.on('response',r=>{if(new URL(r.url()).pathname==='/_next/image')optimizerStatuses.push(r.status());});
  await context.route('https://test.supabase.co/**',r=>r.fulfill(r.request().url().includes('/expired/')?{status:403,body:'Expired'}:{contentType:'image/png',body:png}));
  await context.route('https://example.com/**',r=>r.fulfill({contentType:'image/png',body:png}));
  await page.goto(origin+'/dashboard');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await expect(page.locator('.dashboard-today')).toContainText(names[0]);
  const signed='https://test.supabase.co/storage/v1/object/sign/recipe-images/a.png?token=fixture';
  const photos=[['signed',signed,true],['external','https://example.com/photo.jpg',true],['same-origin',origin+'/pwa-icon-192.png',true],['missing',null,false],['failed',origin+'/missing-final.png',false],['expired','https://test.supabase.co/storage/v1/object/sign/expired/a.png?token=fixture',false]];
  for(const [label,photo,works] of baseline?photos.slice(0,1):photos) {
   optimizerStatuses=[];checked(await client.from('recipes').update({image_url:photo}).eq('recipe_uuid',ids[0]));await page.reload();await expect(page.locator('.dashboard-today')).toContainText(names[0]);
   const img=page.locator('.dashboard-today article img');
   if(works && !baseline) {await expect(img).toHaveCount(1);await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);}
   else await expect(img).toHaveCount(0);
   if(label==='signed') assert.deepEqual(optimizerStatuses,baseline?[400]:[]);
   results.push({width:viewport.width,photo:label,loaded:works&&!baseline,optimizerStatuses:[...optimizerStatuses]});
   console.log(`PASS ${viewport.width} photo ${label}: ${baseline?'original rejection reproduced':'expected rendering/fallback'}`);
  }
  checked(await client.from('recipes').update({image_url:null}).eq('recipe_uuid',ids[0]));await page.reload();await expect(page.locator('.dashboard-today')).toContainText(names[0]);
  let planWritten=false;
  await context.route('**/rest/v1/weekly_plans*',async route=>{
   if(['POST','PATCH'].includes(route.request().method()))planWritten=true;
   else if(planWritten && route.request().method()==='GET')await sleep(700);
   await route.continue();
  });
  await context.route('**/rest/v1/recipes*',async route=>{
   if(route.request().method()==='GET' && route.request().url().includes(ids[1]))await sleep(1200);
   await route.continue();
  });
  async function dismissal(trigger,key) {
   await trigger.focus();await trigger.click();await expect(page.getByRole('dialog')).toBeVisible();
   if(key==='Escape')await page.keyboard.press('Escape');else await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
   await expect(page.getByRole('dialog')).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  async function add(trigger,heading,expectedDay=today) {
   await trigger.click();await page.getByRole('dialog').getByRole('button',{name:/Focus Salad/}).click();await page.getByRole('button',{name:'Add to Plan',exact:true}).click();
   await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText(names[1],{exact:true}).first()).toBeVisible();await sleep(500);
   if(baseline) assert.equal(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   else await expect(heading).toBeFocused();
   const plan=checked(await client.from('weekly_plans').select('*').eq('week_date',week).single());
   assert(plan.recipe_uuids.includes(ids[1]));assert.equal(Number(plan.scale),1.5);
   if(expectedDay!==null)assert.equal(plan.day_assignment_recipe_uuids[ids[1]],expectedDay);
  }
  const todaySection=page.locator('.dashboard-today');
  await add(todaySection.getByRole('button',{name:'Plan a meal',exact:true}).first(),page.locator('#dashboard-today-title'));
  console.log(`PASS ${viewport.width} delayed populated Dashboard Add: ${baseline?'BODY regression reproduced':'section focus and API persistence'}`);
  if(!baseline) {
   // Every successful flow observes delayed plan and expanded recipe reads.
   for(const location of ['today','week','planner'])for(const empty of [false,true]) {
    planWritten=false;await setPlan(empty?[]:[ids[0]]);await page.goto(origin+(location==='planner'?'/planner':'/dashboard'));
    const section=location==='today'?page.locator('.dashboard-today'):location==='week'?page.locator('.dashboard-week'):page.locator('[aria-label="Meal planner"]');
    await expect(section).toBeVisible();
    if(!empty)await expect(section).toContainText(names[0]);
    else if(location!=='planner')await expect(section).toContainText(location==='today'?'No meals planned today':'No meals planned this week');
    let trigger;
    if(location==='today')trigger=section.getByRole('button',{name:'Plan a meal',exact:true}).filter({visible:true}).first();
    else if(location==='week')trigger=section.getByRole('button',{name:`Add meal for ${new Date().toLocaleDateString('en-US',{weekday:'short'})}`,exact:true});
    else trigger=empty?page.locator('[data-planner-empty-slot]').filter({visible:true}).first():page.getByRole('button',{name:viewport.width===1440?'Add recipe':'Add',exact:true}).first();
    // Empty Planner day defaults to a different date; select today's empty slot.
    if(location==='planner' && empty)trigger=viewport.width===1440
      ? page.locator('[data-planner-empty-slot]').filter({visible:true}).nth((today+6)%7)
      : page.getByRole('button',{name:'Add recipe',exact:true});
    await expect(trigger).toBeEnabled();
    for(const key of ['Cancel','Escape'])await dismissal(trigger,key);
    const heading=location==='today'?page.locator('#dashboard-today-title'):location==='week'?page.locator('#dashboard-week-title'):section;
    await add(trigger,heading,location==='planner'&&(!empty||viewport.width===390)?null:today);
    results.push({width:viewport.width,focus:location,empty,successfulAdd:true,cancel:true,escape:true,persisted:true});
    console.log(`PASS ${viewport.width} ${location} ${empty?'empty→populated':'populated'} Add/Cancel/Escape with delayed reads and API evidence`);
   }
  }
  await context.unroute('**/rest/v1/weekly_plans*');await context.unroute('**/rest/v1/recipes*');
  // Week-level Planner additions intentionally leave the day unassigned.
  // Use a separate explicitly assigned fixture for the final loaded screenshot.
  await setPlan([ids[1]]);
  checked(await client.from('recipes').update({image_url:signed}).eq('recipe_uuid',ids[1]));await page.goto(origin+'/dashboard');await expect(page.locator('.dashboard-today')).toContainText(names[1]);
  if(!baseline)await expect.poll(()=>page.locator('.dashboard-today article img').first().evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  await page.screenshot({path:`${artifacts}/${baseline?'before':'after'}-${viewport.width}.png`,fullPage:true});
  await context.close();
 }
}finally {
 writeFileSync(`${artifacts}/${baseline?'before':'after'}-evidence.json`,JSON.stringify(results,null,2));
 for(const owner of owners)checked(await admin.auth.admin.deleteUser(owner));
 await Promise.race([browser.close(),sleep(5000)]);
}
console.log('Remaining-finding browser regressions complete; disposable owners removed');
process.exit(0);
