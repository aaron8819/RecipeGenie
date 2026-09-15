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
const read=async(a:Owner)=>(await db`select document,content_revision,trip_id,content_epoch from public.shopping_list where user_id=${a.id}`)[0];

const command = (row:any, mutation:any) => ({ protocol:1, observedRevision:Number(row.content_revision), tripId:row.trip_id,
 mutation, ...(mutation.type==='editManualItem'?{observedManual:row.document.manualItems.find((i:any)=>i.id===mutation.id)}:{}) });
async function http(a:Owner,body:any){const response=await fetch('http://127.0.0.1:3117/api/shopping',{
 method:'POST',headers:{Origin:'http://127.0.0.1:3117',Cookie:a.cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});return response.json();}
async function admit(a:Owner,c:any){const operationId=randomUUID();const r=await http(a,{phase:'admit',operationId,command:c});
 check(r.status,'Admitted','admission');return {phase:'execute',operationId,sequence:r.sequence,command:c};}
async function send(a:Owner,mutation:any){return http(a,await admit(a,command(await read(a),mutation)));}
async function setup(){const a=await owner(); await send(a,{type:'initialize'});const id=randomUUID();
 check((await send(a,{type:'addManualItem',item:{id,displayName:'lemon',quantity:{amount:3,unit:'count'},categoryKey:'produce',bucket:'items',checked:false}})).status,'Applied','add');
 return {a,id};}

async function main(){const browser=await chromium.launch();try{
 // HTTP is the real authenticated authority; retain the exact command for replay.
 for(const reverse of [false,true]){
  const {a,id}=await setup();const original=await read(a);
  const wording=await admit(a,command(original,{type:'editManualItem',id,changes:{displayName:'lemons'}}));
  const amount=await admit(a,command(original,{type:'editManualItem',id,changes:{quantity:{amount:4,unit:'count'}}}));
  const first=reverse?amount:wording,second=reverse?wording:amount;
  check((await http(a,first)).status,'Applied','first disjoint edit');
  const result=await http(a,second);check(result.status,'Applied','second disjoint edit');
  const combined=await read(a);const item=combined.document.manualItems[0];
  check(item.displayName,'lemons','persisted wording');check(item.quantity.amount,4,'persisted quantity');
  check(item.identity.fieldVersions,{displayName:1,quantity:1,guard:0},'separate field versions');
  check(item.identity.version,2,'whole-item version retained');check(Number(combined.content_revision),Number(original.content_revision)+2,'two revisions');
  const replay=await http(a,second);check(replay.status,'AlreadyApplied','lost-response replay');check(replay.receipt,result.receipt,'historical receipt');
  check(await read(a),combined,'replay does not write');
  check(combined.document.preferences,original.document.preferences,'placement retained');
  evidence[`http-${reverse}`]={original,combined,result,replay};
 }
 for(const field of ['displayName','quantity']){
  const {a,id}=await setup();const original=await read(a);
  const changes=field==='displayName'?{displayName:'lemons'}:{quantity:{amount:4,unit:'count'}};
  const stale=await admit(a,command(original,{type:'editManualItem',id,changes}));
  check((await send(a,{type:'editManualItem',id,changes})).status,'Applied','competing winner');
  const before=await read(a);check((await http(a,stale)).status,'Conflict','same-field conflict');check(await read(a),before,'refusal preserves state');
  const aba=await admit(a,command(original,{type:'editManualItem',id,changes}));
  check((await send(a,{type:'editManualItem',id,changes:{[field]:original.document.manualItems[0][field]}})).status,'Applied','return to original');
  const returned=await read(a);check((await http(a,aba)).status,'Conflict','ABA conflict');check(await read(a),returned,'ABA refusal preserves state');
 }
 {
  const {a,id}=await setup();const c=await admit(a,command(await read(a),{type:'editManualItem',id,changes:{displayName:'lemons'}}));
  const outcomes=await Promise.all([http(a,c),http(a,c)]);check(outcomes.map(r=>r.status).sort(),['AlreadyApplied','Applied'],'concurrent duplicate has one commit');
  check((await read(a)).document.manualItems[0].identity.version,1,'duplicate one version');
 }
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]) for(const reverse of [false,true]){
  const {a,id}=await setup(); await db`update public.user_config set onboarding_completed_at=now() where user_id=${a.id}`;
  const contexts=await Promise.all([browser.newContext({viewport}),browser.newContext({viewport})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));const errors:string[]=[];
  try{
   for(const [index,context] of contexts.entries()){
    await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
    const page=pages[index];page.on('pageerror',e=>errors.push(String(e)));
    const response=await page.goto('http://127.0.0.1:3117/shopping');const policy=response!.headers()['content-security-policy'];
    check(policy.includes('http://127.0.0.1:57321'),true,'exact loopback CSP');check(policy.includes('http://127.0.0.1:*'),false,'no wildcard CSP');
    await page.getByLabel('Email',{exact:true}).fill(a.email);await page.getByLabel('Password',{exact:true}).fill(a.password);
    await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('link',{name:'Go to Planner',exact:true}).waitFor();
    await page.goto('http://127.0.0.1:3117/shopping');await page.getByTestId(`need-${id}`).locator('summary').click();
   }
   // Both actual forms retain the same old item. No refresh/retry changes their binding.
   await pages[0].getByLabel('Name for lemon',{exact:true}).fill('lemons');
   await pages[1].getByLabel('Amount for lemon',{exact:true}).fill('2');
   const original=await read(a); const row=projectShoppingDocument(original.document,[]).items[0];
   // Cover the old 3; decreasing to 2 and cosmetic wording must preserve coverage.
   const {shoppingRowCoverage}=await import('../src/lib/shopping-coverage-runtime');
   const checkCommand={...command(original,{type:'setChecked',rowRef:row.rowRef,checked:true}),inspectedCoverage:{[row.orderingKey]:{version:0,basis:shoppingRowCoverage(row)}}};
   check((await http(a,await admit(a,checkCommand))).status,'Applied','check inspected three');
   const submitted:any[]=[];
   for(const index of reverse?[1,0]:[0,1]){
    const page=pages[index];const response=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
    await page.getByRole('button',{name:'Save extra or reminder',exact:true}).click();const r=await response;
    const payload=r.request().postDataJSON();submitted.push(payload.command);check((await r.json()).status,'Applied','stale actual form applied');
    check(Object.keys(payload.command.mutation.changes),[index===0?'displayName':'quantity'],'form submits only intended field');
    await page.getByRole('button',{name:'Save extra or reminder',exact:true}).waitFor({state:'visible'});
   }
   const after=await read(a);check(after.document.manualItems[0].displayName,'lemons','browser persisted name');check(after.document.manualItems[0].quantity.amount,2,'browser persisted amount');
   check(projectShoppingDocument(after.document,[]).items[0].checked,true,'completion retained');
   check(after.document.preferences,original.document.preferences,'browser placement retained');
   for(const page of pages){await page.reload();await page.getByTestId(`need-${id}`).locator('summary').click();
    check(await page.getByLabel('Name for lemons',{exact:true}).inputValue(),'lemons','reload wording');
    check(await page.getByLabel('Amount for lemons',{exact:true}).inputValue(),'2','reload amount');
    check(await page.getByTestId(`need-${id}`).getByRole('alert').count(),0,'no conflict feedback');}
   await pages[1].screenshot({path:`../.codex-artifacts/slice10/manual-${viewport.width}-${reverse}.png`,fullPage:true});
   await pages[0].getByLabel('Amount for lemons',{exact:true}).fill('4');
   await pages[1].getByLabel('Amount for lemons',{exact:true}).fill('5');
   for(const index of [0,1]){
    const page=pages[index];const response=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
    await page.getByRole('button',{name:'Save extra or reminder',exact:true}).click();
    check((await(await response).json()).status,index===0?'Applied':'Conflict','competing actual form outcome');
   }
   await pages[1].getByTestId(`need-${id}`).getByRole('alert').waitFor();
   check(await pages[1].getByLabel('Amount for lemons',{exact:true}).inputValue(),'5','conflict preserves draft');
   check((await read(a)).document.manualItems[0].quantity.amount,4,'conflict preserves winner');
   // Hold the committed response so typing during reconciliation is deterministic.
   const page=pages[0];await page.reload();await page.getByTestId(`need-${id}`).locator('summary').click();
   await page.getByLabel('Amount for lemons',{exact:true}).fill('6');
   let release!:()=>void, entered!:()=>void;
   const held=new Promise<void>(resolve=>{release=resolve;});const arrived=new Promise<void>(resolve=>{entered=resolve;});
   await page.route('**/api/shopping',async route=>{
    if(route.request().postDataJSON()?.phase!=='execute')return route.continue();
    const response=await route.fetch();entered();await held;await route.fulfill({response});
   });
   await page.getByRole('button',{name:'Save extra or reminder',exact:true}).click();await arrived;
   await page.getByLabel('Amount for lemons',{exact:true}).fill('7');release();
   await expect(page.getByRole('button',{name:'Save extra or reminder',exact:true})).toBeEnabled();
   check(await page.getByLabel('Amount for lemons',{exact:true}).inputValue(),'7','typing during held response survives reconciliation');
   await page.unroute('**/api/shopping');
   const nextResponse=page.waitForResponse(r=>r.url().endsWith('/api/shopping')&&r.request().postDataJSON()?.phase==='execute');
   await page.getByRole('button',{name:'Save extra or reminder',exact:true}).click();
   check((await(await nextResponse).json()).status,'Applied','next draft applies against confirmed field history');
   check((await read(a)).document.manualItems[0].quantity.amount,7,'new typing persists');
   check(errors,[],'no page errors');evidence[`browser-${viewport.width}-${reverse}`]={submitted,after};
  }finally{for(const c of contexts)await c.close();}
 }
 complete=true;
}finally{await browser.close();for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end({timeout:1});
 writeFileSync('../.codex-artifacts/slice10/manual-regression-results.json',JSON.stringify({complete,checks,evidence},null,2));}
 console.log(`PASS ${checks} checks; complete=${complete}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
