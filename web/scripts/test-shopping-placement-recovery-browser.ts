import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument } from '../src/lib/shopping-document';
import { mapRecipeRows } from '../src/lib/recipe-identity';
import { canonicalShoppingPayload } from '../src/lib/shopping-command';

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

async function main(){const browser=await chromium.launch();try{for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
 const a=await owner();await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
 const ins=await a.client.from('recipes').insert({user_id:a.id,recipe_uuid:randomUUID(),name:'Retained category',category:'Dinner',servings:4,tags:[],ingredient_sections:[{label:'Main',ingredients:[{item:'lemon',amount:2,unit:'count'}]}],instruction_sections:[{label:null,steps:['Mix']}]}).select('*').single();assert.equal(ins.error,null);
 const recipe=mapRecipeRows([ins.data] as any)[0],legacy=createEmptyShoppingDocument(),entry=createShoppingRecipeEntry(recipe,4,{numerator:'1',denominator:'1'});
 entry.ingredients.forEach(i=>{i.defaultCategoryKey='dairy'});legacy.recipeEntries[recipe.id]=entry;
 await db`update public.shopping_list set document=${db.json(legacy as any)},content_revision=1 where user_id=${a.id}`;
 const context=await browser.newContext({viewport});const page=await context.newPage();
 try{
  await page.goto('http://127.0.0.1:3117/shopping');await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor();await page.goto('http://127.0.0.1:3117/shopping');
  await page.getByTestId('shopping-category-dairy').waitFor();await page.screenshot({path:`../.codex-artifacts/review/category-${viewport.width}-legacy-dairy.png`,fullPage:true});
  await page.getByRole('button',{name:'Update this shopping list',exact:true}).click();await page.getByText('Extras, source quantities and legacy amounts',{exact:true}).waitFor();await page.getByTestId('shopping-category-dairy').waitFor();
  const fresh=await read(a);check(projectShoppingDocument(fresh.document).items[0].categoryKey,'dairy','fresh correction preserves original Dairy category');
  const oldFixture=JSON.parse(readFileSync('src/test/fixtures/shopping-defective-v4.json','utf8')).originalV4;
  const oldId=Object.keys(oldFixture.recipeEntries)[0];
  // Actual pre-edit old-initializer output; only remap its fixture selection ID.
  const originalV4=JSON.parse(JSON.stringify(oldFixture).replaceAll(oldId,recipe.id));
  await db`update public.shopping_list set document=${db.json(originalV4 as any)},content_revision=content_revision+1 where user_id=${a.id}`;
  await page.reload();await page.getByTestId('shopping-category-produce').waitFor();
  check(await page.getByTestId('shopping-category-dairy').count(),0,'confirmed upgrade defect: actual Dairy section disappears');
  const before=await read(a);check(before.document.recipeEntries[recipe.id].ingredients[0].defaultCategoryKey,'dairy','historical source category remains retained');
  await page.getByRole('button',{name:'Review retained locations',exact:true}).click();
  const resolution=page.getByRole('region',{name:'Resolve location for lemon',exact:true});
  await resolution.waitFor();
  const pending=await read(a);check(pending.document.placementEvidence.unresolved.lemon.categories,['produce','dairy'],'both retained histories exposed');
  await page.screenshot({path:`../.codex-artifacts/review/recovery-${viewport.width}-choice.png`,fullPage:true});
  await resolution.getByRole('combobox').first().selectOption('dairy');
  await resolution.getByRole('button',{name:'Confirm purchase location',exact:true}).click();
  await page.getByTestId('shopping-category-dairy').waitFor();
  check(projectShoppingDocument((await read(a)).document).items[0].categoryKey,'dairy','persisted resolution renders Dairy');
  await page.reload();await page.getByTestId('shopping-category-dairy').waitFor();
  check(await page.getByRole('button',{name:'Review retained locations',exact:true}).count(),0,'reload has no repeated recovery prompt');
  const after=await read(a);check(after.document.recipeEntries,before.document.recipeEntries,'source snapshots unchanged by upgrade');
  check((await send(a,cmd({type:'initialize'},Number(after.content_revision)))).status,'Unchanged','repeat upgrade harmless');
  await page.screenshot({path:`../.codex-artifacts/review/recovery-${viewport.width}-dairy.png`,fullPage:true});
  // Old server commit with a real initialization receipt: the browser should
  // recover automatically, without asking the owner to choose a known history.
  await db`update public.shopping_list set document=${db.json(legacy as any)},content_revision=content_revision+1 where user_id=${a.id}`;
  const oldCommand=cmd({type:'initialize'},Number((await read(a)).content_revision));
  const ticket=await admit(a,oldCommand);
  const args={p_owner:a.id,p_sequence:ticket.sequence,p_operation:ticket.operationId,p_hash:createHash('sha256').update(canonicalShoppingPayload(oldCommand)).digest('hex')};
  const ctx=await admin.rpc('shopping_command_context',args);assert.equal(ctx.error,null);
  const committed=await admin.rpc('shopping_commit',{...args,p_revision:ctx.data.row.content_revision,p_dependency:ctx.data.dependencyRevision,
    p_document:originalV4,p_outcome:'Applied',p_action:'mutation'});assert.equal(committed.error,null);
  await page.reload();await page.getByTestId('shopping-category-produce').waitFor();
  await page.getByRole('button',{name:'Review retained locations',exact:true}).click();
  await page.getByTestId('shopping-category-dairy').waitFor();
  check(projectShoppingDocument((await read(a)).document).items[0].categoryKey,'dairy','receipt-proven upgrade persists and renders Dairy automatically');
  check(await page.getByRole('region',{name:'Resolve location for lemon',exact:true}).count(),0,'proven recovery needs no ambiguous choice');
  await page.reload();await page.getByTestId('shopping-category-dairy').waitFor();
  await page.screenshot({path:`../.codex-artifacts/review/recovery-${viewport.width}-automatic.png`,fullPage:true});
  evidence[String(viewport.width)]={legacy,fresh,oldV4:before,projected:projectShoppingDocument(before.document)};
 }finally{await context.close();}
}complete=true;}finally{await browser.close();for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end();writeFileSync('../.codex-artifacts/review/recovery-browser-results.json',JSON.stringify({checks,complete,evidence,verdict:complete?'resolution verified':'incomplete'},null,2));console.log(JSON.stringify({checks,complete,verdict:complete?'resolution verified':'incomplete'}));}}
main().catch(e=>{console.error(e);process.exitCode=1;});
