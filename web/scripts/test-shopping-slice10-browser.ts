import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { projectShoppingDocument } from '../src/lib/shopping-document';

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

async function main() {
 const browser=await chromium.launch();
 try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
   const a=await owner();
   await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
   const recipeId=randomUUID();
   const inserted=await a.client.from('recipes').insert({user_id:a.id,recipe_uuid:recipeId,name:'Foundation lemons',category:'Dinner',servings:4,tags:[],
    ingredient_sections:[{label:'Sauce',ingredients:[{item:'lemon',amount:2,unit:'count'}]}],instruction_sections:[{label:null,steps:['Mix']}]}).select('*').single();
   assert.equal(inserted.error,null);
   const context=await browser.newContext({viewport}); const page=await context.newPage();const errors:string[]=[];
   page.on('pageerror',error=>errors.push(String(error)));
   // No browser request may reach a hosted service, including incidental assets.
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname) ? route.continue() : route.abort();
   });
   try {
    const response=await page.goto('http://127.0.0.1:3117/shopping');
    const policy=response!.headers()['content-security-policy'];
    check(policy.includes(' http://127.0.0.1:57321;'),true,'production CSP permits exact local backend');
    check(policy.includes('http://127.0.0.1:*'),false,'production CSP has no loopback wildcard');
    await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);
    await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor();
    await page.goto('http://127.0.0.1:3117/shopping');
    const execute=async(type:string,action:()=>Promise<unknown>)=>{
     const pending=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute'&&r.request().postDataJSON()?.command?.mutation?.type===type);
     pending.catch(()=>{});await action();const result=await(await pending).json();check(result.status,'Applied','UI '+type);return result;
    };
    await execute('initialize',()=>page.getByRole('button',{name:'Update this shopping list',exact:true}).click());
    await page.goto(`http://127.0.0.1:3117/recipes/${recipeId}`);
    await execute('upsertRecipes',()=>page.getByRole('button',{name:'Add to Shopping List',exact:true}).click());
    await page.goto('http://127.0.0.1:3117/shopping');
    await page.getByText('Foundation lemons: 4 selected servings',{exact:true}).click();
    await page.getByLabel('Total Shopping yield for Foundation lemons').fill('8');
    await execute('upsertRecipe',()=>page.getByRole('button',{name:'Set total yield',exact:true}).click());
    check((await read(a)).document.recipeEntries[recipeId].selectedServings,8,'selected yield is total eight');
    const frozen=(await read(a)).document.recipeEntries;
    await page.getByLabel('Purchase',{exact:true}).fill('lemon');await page.getByLabel('Extra amount',{exact:true}).fill('3');await page.getByLabel('Extra unit',{exact:true}).fill('count');
    await execute('addManualItem',()=>page.getByRole('button',{name:'Add extra or reminder',exact:true}).click());
    const group=async()=>projectShoppingDocument((await read(a)).document,[]).items.find(row=>row.orderingKey==='lemon')!;
    check((await group()).quantity?.amount,7,'four recipe plus three extra retained');
    check((await read(a)).document.recipeEntries,frozen,'adding extra preserves frozen source');
    await execute('setChecked',()=>page.getByRole('button',{name:/^Check off lemons?$/}).click());
    await page.getByRole('region',{name:'Extras and legacy amounts'}).locator('summary').click();
    await page.getByLabel('Amount for lemon',{exact:true}).fill('2');
    await execute('editManualItem',()=>page.getByRole('button',{name:'Save extra or reminder',exact:true}).click());
    check((await group()).quantity?.amount,6,'manual editor changes only extra');check((await group()).checked,true,'covered decrease retains completion');
    await page.getByLabel('Amount for lemon',{exact:true}).fill('5');
    await execute('editManualItem',()=>page.getByRole('button',{name:'Save extra or reminder',exact:true}).click());
    check((await group()).quantity?.amount,9,'increase preserves all demand');check((await group()).checked,false,'uncovered increase reopens');
    check((await read(a)).document.recipeEntries,frozen,'extra edits preserve exact source evidence');
    const slots=(await read(a)).document.preferences.ingredientOrderByCategory;
    await page.reload();await page.getByRole('button',{name:/^Check off lemons?$/}).waitFor();
    check((await read(a)).document.preferences.ingredientOrderByCategory,slots,'reload preserves shared placement');
    await page.screenshot({path:`../.codex-artifacts/slice10/integrated-${viewport.width}.png`,fullPage:true});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');check(errors,[],'no browser runtime errors');
    evidence[viewport.width]={policy,state:await read(a),errors};
   } finally {await context.close();}
  }
  complete=true;
 } finally {
  await browser.close();for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end();
  writeFileSync('../.codex-artifacts/slice10/integrated-browser-results.json',JSON.stringify({checks,complete,evidence},null,2));
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
