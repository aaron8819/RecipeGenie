import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const db = postgres({ host:'127.0.0.1', port:57322, database:'postgres', user:'postgres', password:'postgres', max:5, onnotice:()=>{} });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
const owners:string[]=[];
let checks=0; let complete=false;
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

async function main(){try{
 const container='supabase_db_Recipe_Genie_Slice10';
 const inspected=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
 assert.equal(inspected.Name,'/'+container);
 assert.equal(inspected.NetworkSettings.Ports['5432/tcp'][0].HostPort,'57322');
 const a=await owner();await apply(a,{type:'initialize'});
 const body=await admit(a,cmd(extra(randomUUID(),'lemon',3),Number((await read(a)).content_revision)));
 check((await http(a,body)).status,'Applied','command committed before restart');
 const before=await read(a);
 execFileSync('docker',['restart',container],{stdio:'pipe'});
 const deadline=Date.now()+30000;
 while(true){try{await db`select 1`;break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,200));}}
 check(await read(a),before,'database restart preserves exact content and organization');
 let replay=await http(a,body);
 const readinessOutcomes:string[]=[];
 while(replay.status==='DependencyUnavailable'&&Date.now()<deadline){
  readinessOutcomes.push(replay.status);
  check(await read(a),before,'dependency recovery never changes persisted state');
  await new Promise(resolve=>setTimeout(resolve,200));
  replay=await http(a,body);
 }
 check(replay.status,'AlreadyApplied','lost-response replay after database restart returns original receipt');
 console.log(JSON.stringify({readinessOutcomes}));
 check(await read(a),before,'restart replay never executes twice');
 complete=true;
}catch(error){console.error(error);throw error;}finally{
 for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);
 await db.end({timeout:1});writeFileSync('../.codex-artifacts/slice10/restart-results.json',JSON.stringify({checks,complete},null,2));
}}
main().catch(error=>{console.error(error);process.exitCode=1;});
