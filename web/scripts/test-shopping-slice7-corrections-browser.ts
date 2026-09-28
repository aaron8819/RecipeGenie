import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument } from '../src/lib/shopping-document';
import { mapRecipeRows } from '../src/lib/recipe-identity';

const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const db = postgres({ host:'127.0.0.1', port:57322, database:'postgres', user:'postgres', password:'postgres', max:5, onnotice:()=>{} });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const owners:string[]=[];
const evidence:any={}; let checks=0;
function check(a:any,b:any,label:string){assert.deepEqual(a,b,label);checks++;console.log('PASS '+label);}
async function owner(){const email=randomUUID()+'@example.test',password=randomUUID()+randomUUID();
 const r=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.equal(r.error,null);const id=r.data.user!.id;owners.push(id);
 const jar=new Map<string,string>();const client=createServerClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>cs.forEach(c=>jar.set(c.name,c.value))}});
 assert.equal((await client.auth.signInWithPassword({email,password})).error,null);
 return {id,client,email,password,cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; ')};}
type Owner=Awaited<ReturnType<typeof owner>>;
const read=async(a:Owner)=>(await db`select document,content_revision from public.shopping_list where user_id=${a.id}`)[0];
const cmd=(mutation:any,revision:number,more:any={})=>({protocol:1,observedRevision:revision,mutation,...more});
async function http(a:Owner,body:any){const r=await fetch('http://127.0.0.1:3117/api/shopping',{method:'POST',headers:{Origin:'http://127.0.0.1:3117',Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function admit(a:Owner,command:any){const operationId=randomUUID();const r=await http(a,{phase:'admit',operationId,command});assert.equal(r.status,'Admitted');return {phase:'execute',operationId,sequence:r.sequence,command};}
async function send(a:Owner,command:any){return http(a,await admit(a,command));}
async function apply(a:Owner,mutation:any){const r=await send(a,cmd(mutation,Number((await read(a)).content_revision)));check(r.status,'Applied',mutation.type);return r;}
const extra=(id:string,name:string,amount=1)=>({type:'addManualItem',item:{id,displayName:name,quantity:{amount,unit:'count'},categoryKey:'produce',bucket:'items',checked:false}});
async function main(){
 const browser=await chromium.launch();
 try{for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const a=await owner(); await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
  const legacy=createEmptyShoppingDocument();legacy.manualItems=['zucchini','banana','apple'].map((name,i)=>({id:'legacy-'+i,displayName:name,quantity:{amount:i+1,unit:'count'},categoryKey:'produce',bucket:'items' as const,checked:false}));
  legacy.preferences.ingredientOrderByCategory={produce:['zucchini','hidden','banana','apple']};
  await db`update public.shopping_list set document=${db.json(legacy as any)},content_revision=1 where user_id=${a.id}`;
  const c1=await browser.newContext({viewport}),c2=await browser.newContext({viewport});
  const p1=await c1.newPage(),p2=await c2.newPage();
  const errors:string[]=[];p1.on('pageerror',e=>errors.push(e.message));p2.on('pageerror',e=>errors.push(e.message));
  async function login(page:any){await page.goto('http://127.0.0.1:3117/shopping');await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor();await page.goto('http://127.0.0.1:3117/shopping');}
  const shot=async(name:string)=>{check(await p1.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow '+name);await p1.screenshot({path:`../.codex-artifacts/review/corrected-browser-${viewport.width}-${name}.png`,fullPage:true});};
  try{
   await login(p1);await p1.getByRole('button',{name:'Update this shopping list',exact:true}).waitFor();await shot('legacy-before');
   await p1.getByRole('button',{name:'Update this shopping list',exact:true}).click();await p1.getByText('Extras, source quantities and legacy amounts',{exact:true}).waitFor();
   await p1.getByText('Extras, source quantities and legacy amounts',{exact:true}).click();await shot('legacy-after');
   check(await p1.locator('[data-testid^="shopping-row-manual:"]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-testid'))),['shopping-row-manual:legacy-0','shopping-row-manual:legacy-1','shopping-row-manual:legacy-2'],'F2 actual DOM order preserved');
   await p1.getByTestId('shopping-category-produce').scrollIntoViewIfNeeded();
   await p1.screenshot({path:`../.codex-artifacts/review/corrected-browser-${viewport.width}-legacy-order-detail.png`,fullPage:false});
   check(projectShoppingDocument((await read(a)).document).items.map(r=>r.displayName),['zucchini','banana','apple'],'F2 initialization UI preserves order');
   const rid=randomUUID();const inserted=await a.client.from('recipes').insert({user_id:a.id,recipe_uuid:rid,name:'Review Lemon Soup',category:'Dinner',servings:4,tags:[],ingredient_sections:[{label:'Sauce',ingredients:[{item:'lemon',amount:2,unit:'count'}]}],instruction_sections:[{label:null,steps:['Mix']}]}).select('*').single();assert.equal(inserted.error,null);
   const recipe=mapRecipeRows([inserted.data] as any)[0];const entry=(n:number)=>createShoppingRecipeEntry(recipe,4*n,{numerator:String(n),denominator:'1'});
   await apply(a,{type:'upsertRecipe',entry:entry(1)});await p1.reload();await p1.getByText('Review Lemon Soup: 4 selected servings',{exact:true}).click();await p1.getByLabel('Total Shopping yield for Review Lemon Soup').fill('8');
   await login(p2);
   // Session 2 sends real cookie-authenticated commands while session 1 retains its open editor and observed selection version.
   async function second(mutation:any){const revision=Number((await read(a)).content_revision);const body=cmd(mutation,revision);return p2.evaluate(async(command:any)=>{const operationId=crypto.randomUUID();const admission=await (await fetch('/api/shopping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'admit',operationId,command})})).json();return (await fetch('/api/shopping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:'execute',operationId,sequence:admission.sequence,command})})).json();},body);}
   check((await second({type:'removeRecipe',recipeId:rid})).status,'Applied','second browser session removes source');
   check((await second({type:'upsertRecipe',entry:entry(3)})).status,'Applied','second browser session selects total 12');
   const before=await read(a);await shot('stale-editor');
   const response=p1.waitForResponse(async r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');await p1.getByRole('button',{name:'Set total yield',exact:true}).click();
   check((await (await response).json()).status,'Conflict','F1 stale editor conflicts');
   const after=await read(a);check(after.document.recipeEntries[rid].selectedServings,12,'F1 preserves replacement yield');
   await p1.getByText('Review Lemon Soup: 12 selected servings',{exact:true}).waitFor();await shot('stale-conflict');
   check(after,before,'F1 conflict preserves entire replacement snapshot and organization');
   await p1.getByRole('region',{name:'Selection quantities and frozen evidence'}).getByRole('alert').filter({hasText:'Shopping changed'}).waitFor();
   await p1.reload();await p1.getByText('Review Lemon Soup: 12 selected servings',{exact:true}).click();
   await p1.getByLabel('Total Shopping yield for Review Lemon Soup').fill('8');
   let responseDropped=false;
   await p1.route('**/api/shopping',async route=>{
    const body=route.request().postDataJSON();
    if(body.phase==='execute') {
     const response=await route.fetch();const result=await response.json();
     if(!responseDropped) {
      check(result.status,'Applied','F1 yield committed before response loss');responseDropped=true;
      check((await second({type:'removeRecipe',recipeId:rid})).status,'Applied','F1 remove after lost response commit');
      check((await second({type:'upsertRecipe',entry:entry(3)})).status,'Applied','F1 replace after lost response commit');
     } else {
      check(result.status,'AlreadyApplied','F1 automatic retry returns receipt');
      await route.fulfill({response});return;
     }
     await route.abort('failed');return;
    }
    await route.continue();
   });
   await p1.getByRole('button',{name:'Set total yield',exact:true}).click();
   await p1.getByRole('region',{name:'Selection quantities and frozen evidence'}).getByRole('alert').filter({hasText:'Your change was confirmed'}).waitFor();
   const lostResponseState=await read(a);check(lostResponseState.document.recipeEntries[rid].selectedServings,12,'F1 lost response preserves new selection');
   await p1.unroute('**/api/shopping');
   const retryResponse=p1.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await p1.getByRole('button',{name:'Set total yield',exact:true}).click();
   check((await (await retryResponse).json()).status,'Conflict','F1 historical success did not retarget open editor');
   await p1.reload();
   check(await read(a),lostResponseState,'F1 receipt recovery and reload preserve replacement identity, snapshot and organization');
   await p1.getByText('Review Lemon Soup: 12 selected servings',{exact:true}).waitFor();await shot('lost-yield-response-recovered');
   check((await second({type:'complete'})).status,'Applied','prepare empty visible list');
   await apply(a,{type:'upsertRecipe',entry:entry(1)});
   const duplicateId=randomUUID();
   const duplicate=await a.client.from('recipes').insert({user_id:a.id,recipe_uuid:duplicateId,name:'Review Lemon Soup',category:'Dinner',servings:4,tags:[],ingredient_sections:[{label:'Sauce',ingredients:[{item:'lemon',amount:2,unit:'count'}]}],instruction_sections:[{label:null,steps:['Mix']}]}).select('*').single();assert.equal(duplicate.error,null);
   const duplicateEntry=createShoppingRecipeEntry(mapRecipeRows([duplicate.data] as any)[0],4,{numerator:'1',denominator:'1'});
   await apply(a,{type:'upsertRecipe',entry:duplicateEntry});
   await apply(a,{type:'addManualItem',item:{id:'extra',displayName:'lemon',quantity:{amount:3,unit:'count'},categoryKey:'produce',bucket:'items',checked:false}});
   const group=projectShoppingDocument((await read(a)).document).items[0];
   await apply(a,{type:'setSuppressed',aggregateKey:group.rowRef.slice('derived:'.length),suppressed:true});
   const hidden=await read(a);check(projectShoppingDocument(hidden.document).items.length,0,'F3 no visible purchase rows');
   await p1.reload();
   const expand=async()=>{const button=p1.getByRole('button',{name:'Show recipes in list',exact:true});if(await button.count())await button.click();};
   await p1.getByTestId('shopping-recipe-context').waitFor();await expand();
   const label=`Review Lemon Soup (${[rid,duplicateId].sort().indexOf(rid)+1})`;
   const remove=p1.getByTitle(`Remove all items from ${label}`,{exact:true});await remove.waitFor();
   await shot('hidden-duplicate-selections');
   let release!:()=>void, entered!:()=>void;
   const hold=new Promise<void>(resolve=>{release=resolve}), blocked=new Promise<void>(resolve=>{entered=resolve});
   await p1.route('**/api/shopping',async route=>{const body=route.request().postDataJSON();if(body.phase==='execute'&&body.command?.mutation.type==='removeRecipe'){entered();await hold;}await route.continue();});
   const removedResponse=p1.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await remove.click();await blocked;
   check(await remove.count(),1,'F3 source control remains while command is uncommitted');
   check(await read(a),hidden,'F3 delayed removal has no persistence side effect');
   check((await second({type:'removeRecipe',recipeId:rid})).status,'Applied','F3 concurrent session removes hidden source');
   check((await second({type:'upsertRecipe',entry:entry(3)})).status,'Applied','F3 concurrent session replaces hidden source');
   const replaced=await read(a);release();
   check((await (await removedResponse).json()).status,'Conflict','F3 held UI removal cannot target replacement');
   check(await read(a),replaced,'F3 stale removal preserves replacement and shared purchase');
   await p1.unroute('**/api/shopping');await p1.reload();await p1.getByTestId('shopping-recipe-context').waitFor();await expand();
   const removeCurrent=p1.getByTitle(`Remove all items from ${label}`,{exact:true});
   const currentResponse=p1.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await removeCurrent.click();check((await (await currentResponse).json()).status,'Applied','F3 current hidden source removes');
   await p1.getByTitle('Remove all items from Review Lemon Soup',{exact:true}).waitFor();
   check(Object.keys((await read(a)).document.recipeEntries),[duplicateId],'F3 duplicate title remains separately operable');
   const lastResponse=p1.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await p1.getByTitle('Remove all items from Review Lemon Soup',{exact:true}).click();check((await (await lastResponse).json()).status,'Applied','F3 last hidden source removes');
   await p1.getByTestId('shopping-recipe-context').waitFor({state:'detached'});
   const final=await read(a);check(final.document.recipeEntries,{},'F3 persisted selections empty');check(final.document.manualItems,hidden.document.manualItems,'F3 preserves hidden manual extra');check(final.document.preferences,hidden.document.preferences,'F3 preserves organization');
   await shot('hidden-sources-removed');
   check((await second({type:'editManualItem',id:'extra',changes:{bucket:'items'}})).status,'Applied','F4 show extra for inspected rebind');
   await p1.reload();const manual=p1.getByTestId('need-extra');await manual.locator('summary').click();
   await manual.getByLabel('Name for lemon',{exact:true}).fill('apple');
   const manualRow=projectShoppingDocument((await read(a)).document).items[0];
   check((await second({type:'pantry',rowRef:manualRow.rowRef})).status,'Applied','F4 other session moves inspected manual to Pantry');
   const pantryState=await read(a);
   const rebindResponse=p1.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await manual.getByRole('button',{name:'Save extra or reminder',exact:true}).click();
   check((await (await rebindResponse).json()).status,'Conflict','F4 browser stale manual rebind conflicts');
   check(await read(a),pantryState,'F4 browser preserves identity quantity bucket and placement');
   await manual.getByRole('alert').filter({hasText:'Shopping changed'}).waitFor();await shot('stale-pantry-rebind');
   evidence[String(viewport.width)]={before,after,hidden,replaced,final,errors};check(errors,[],'no page errors');
  }finally{await c1.close();await c2.close();}
 }}finally{await browser.close();for(const id of owners){assert.equal((await admin.auth.admin.deleteUser(id)).error,null);}await db.end();writeFileSync('../.codex-artifacts/review/corrected-browser-results.json',JSON.stringify({checks,evidence},null,2));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
