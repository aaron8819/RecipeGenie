import { chromium } from 'playwright';
import { expect } from '@playwright/test';
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
const read=async(a:Owner)=>(await db`select document,content_revision from public.shopping_list where user_id=${a.id}`)[0];
const cmd=(mutation:any,revision:number,more:any={})=>({protocol:1,observedRevision:revision,mutation,...more});
async function http(a:Owner,body:any){const r=await fetch('http://127.0.0.1:3117/api/shopping',{method:'POST',headers:{Origin:'http://127.0.0.1:3117',Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json();}
async function admit(a:Owner,command:any){const operationId=randomUUID();const r=await http(a,{phase:'admit',operationId,command});assert.equal(r.status,'Admitted');return {phase:'execute',operationId,sequence:r.sequence,command};}
async function send(a:Owner,command:any){return http(a,await admit(a,command));}
async function apply(a:Owner,mutation:any){const r=await send(a,cmd(mutation,Number((await read(a)).content_revision)));check(r.status,'Applied',mutation.type);return r;}
const extra=(id:string,name:string,amount=1)=>({type:'addManualItem',item:{id,displayName:name,quantity:{amount,unit:'count'},categoryKey:'produce',bucket:'items',checked:false}});


async function main(){
 const browser=await chromium.launch();
 try {for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
  const a=await owner();await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
  const fixture=JSON.parse(readFileSync('src/test/fixtures/shopping-defective-v4.json','utf8')).originalV4;
  await db`update public.shopping_list set document=${db.json(fixture)},content_revision=1 where user_id=${a.id}`;
  const apple=randomUUID(),banana=randomUUID();
  await apply(a,extra(apple,'apple'));await apply(a,extra(banana,'banana'));
  await apply(a,{type:'updateCategoryPreferences',preferences:{categoryByIngredient:{apple:'dairy',banana:'dairy'}}});
  const context=await browser.newContext({viewport}),page=await context.newPage();const requests:any[]=[],errors:string[]=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(r.url().endsWith('/api/shopping')&&r.method()==='POST'){const body=r.postDataJSON();if(body.command?.mutation?.type==='resolvePlacement') requests.push(body);}});
  try {
   await page.goto('http://127.0.0.1:3117/shopping');await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor();await page.goto('http://127.0.0.1:3117/shopping');
   await page.getByRole('button',{name:'Review retained locations',exact:true}).click();
   const region=page.getByRole('region',{name:'Resolve location for lemon',exact:true});await region.waitFor();
   const beforeChoice=await read(a);await region.getByRole('combobox').nth(0).selectOption('dairy');await region.getByRole('combobox').nth(1).selectOption('apple');
   check(await read(a),beforeChoice,'choosing destination/anchor without confirming makes no write');
   // Cancellation by navigation discards the draft, without a location write.
   await page.reload();await region.waitFor();check(await read(a),beforeChoice,'cancel/reload preserves unresolved document');
   await region.getByRole('combobox').nth(0).selectOption('dairy');await region.getByRole('combobox').nth(1).selectOption('apple');
   await region.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-reviewed.png`});
   const reviewedRevision=Number((await read(a)).content_revision);
   await apply(a,{type:'learnOrder',draggedRowRef:'manual:'+apple,draggedOrderingKey:'apple',sourceCategoryKey:'dairy',targetRowRef:'manual:'+banana,targetOrderingKey:'banana',targetCategoryKey:'dairy',placement:'after'});
   const moved=await read(a);check(moved.document.preferences.ingredientOrderByCategory.dairy,['banana','apple'],'second session moves reviewed anchor');
   // Reproduce the independent review exactly: a real unrelated addition
   // refreshes the mounted component's actual QueryClient. No intercepted reads.
   await page.getByRole('textbox',{name:'Purchase',exact:true}).fill('unrelated reminder');
   await page.getByRole('button',{name:'Add extra or reminder',exact:true}).click();
   await expect(page.getByRole('textbox',{name:'Purchase',exact:true})).toHaveValue('');
   await region.getByRole('status').waitFor();
   const refreshed=await read(a);
   check(await region.getByRole('combobox').nth(0).inputValue(),'dairy','background refresh retains old destination draft');
   check(await region.getByRole('combobox').nth(1).inputValue(),'apple','background refresh retains old anchor draft');
   const rejectedResponse=page.waitForResponse(r=>r.url().endsWith('/api/shopping') &&
     r.request().postDataJSON()?.phase==='execute' && r.request().postDataJSON()?.command?.mutation?.type==='resolvePlacement');
   await region.getByRole('button',{name:'Confirm purchase location',exact:true}).click();
   check((await (await rejectedResponse).json()).status,'Conflict','real server rejects stale confirmation');
   await region.getByRole('alert').waitFor();
   await page.getByRole('button',{name:'Dismiss',exact:true}).click();
   await page.getByRole('button',{name:'Dismiss',exact:true}).waitFor({state:'hidden'});
   const after=await read(a);
   const executed=requests.filter(r=>r.phase==='execute').at(-1);
   check(executed.command.observedRevision,reviewedRevision,'request retains revision actually reviewed');
   check(after,refreshed,'stale confirmation preserves the full refreshed database document');
   check(after.document.preferences.ingredientOrderByCategory.dairy,['banana','apple'],'other session placement survives');
   await page.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-stale-result.png`,fullPage:true});
   await region.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-stale-review.png`});
   // Edits do not clear the rejected review or implicitly adopt a revision.
   await region.getByRole('combobox').nth(1).selectOption('banana');
   await expect(region.getByRole('button',{name:'Confirm purchase location',exact:true})).toBeDisabled();
   await region.getByRole('combobox').nth(1).selectOption('apple');
   await region.getByRole('button',{name:'Review current placement',exact:true}).click();
   await expect(region.getByText('Reviewed saved order (including hidden purchases): banana → apple.',{exact:true})).toBeVisible();
   check(await read(a),after,'explicit review itself makes no write');
   await region.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-renewed.png`});
   await region.getByRole('button',{name:'Confirm purchase location',exact:true}).click();
   await region.waitFor({state:'hidden'});
   const confirmed=await read(a),freshRequest=requests.filter(r=>r.phase==='execute').at(-1);
   check(freshRequest.command.observedRevision,Number(refreshed.content_revision),'explicit fresh confirmation submits reviewed current revision');
   check(Number(confirmed.content_revision),Number(refreshed.content_revision)+1,'fresh confirmation commits once');
   check(confirmed.document.preferences.ingredientOrderByCategory.dairy,['banana','lemon','apple'],'newly reviewed placement persists');
   await page.reload();await page.getByTestId('shopping-category-dairy').waitFor();check(await read(a),confirmed,'reload retains newly reviewed confirmation');
   await page.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-confirmed.png`,fullPage:true});
   evidence[String(viewport.width)]={reviewedRevision,beforeChoice,moved,refreshed,after,executed,freshRequest,confirmed,errors};

   // A stale command with its original revision is rejected, showing the UI
   // rebind is the gap rather than missing SQL revision checking.
   const staleResult=await send(a,cmd({type:'resolvePlacement',purchaseKey:'lemon',categoryKey:'frozen',anchor:null},reviewedRevision));
   check(staleResult.status,'Conflict','original reviewed revision is rejected by trusted boundary');
   check(await read(a),confirmed,'stale command rejection makes no write');

   const hidden=structuredClone(fixture);const entry:any=Object.values(hidden.recipeEntries)[0];hidden.itemOverrides[entry.ingredients[0].aggregateKey]={suppressed:true,checked:true};
   await db`update public.shopping_list set document=${db.json(hidden)},content_revision=content_revision+1 where user_id=${a.id}`;
   await page.reload();await page.getByRole('button',{name:'Review retained locations',exact:true}).click();await region.waitFor();
   check(projectShoppingDocument((await read(a)).document).items.length,0,'all-hidden unresolved purchase has no buy row');
   check(await region.isVisible(),true,'hidden purchase confirmation remains reachable');
   await region.scrollIntoViewIfNeeded();await page.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-hidden-unresolved.png`});
   await region.getByRole('combobox').nth(0).selectOption('produce');await region.getByRole('button',{name:'Confirm purchase location',exact:true}).click();
   await region.waitFor({state:'hidden'});const kept=await read(a);
   check(kept.document.preferences.categoryByIngredient.lemon,'produce','keep current category confirms Produce');
   check(kept.document.itemOverrides,hidden.itemOverrides,'hidden confirmation preserves completion/suppression');
   await page.reload();await page.getByText('Extras, source quantities and legacy amounts',{exact:true}).waitFor();check(await read(a),kept,'hidden confirmed location persists on reload');
   await page.screenshot({path:`../.codex-artifacts/review/binding-${viewport.width}-hidden.png`,fullPage:true});
   check(errors,[],'no browser runtime errors');
  }finally{await context.close();}
 }complete=true;
 }finally{await browser.close();for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end();writeFileSync('../.codex-artifacts/review/binding-browser-results.json',JSON.stringify({checks,complete,evidence},null,2));console.log(JSON.stringify({checks,complete}));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});


