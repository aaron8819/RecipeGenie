import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';
const status=JSON.parse(readFileSync('../.codex-artifacts/dashboard-backend/status.json','utf8'));
assert.equal(status.API_URL,'http://127.0.0.1:55321');
const db=postgres({host:'127.0.0.1',port:55322,user:'postgres',password:'postgres',database:'postgres',max:5,onnotice:()=>{}});
assert.equal((await db`select max(version) as version from supabase_migrations.schema_migrations`)[0].version,'031');
const owner=randomUUID(),old=randomUUID(),replacement=randomUUID();
const assignments={[old]:1};
let unblock,inserted;const gate=new Promise(r=>unblock=r),ready=new Promise(r=>inserted=r);
try{
 await db`insert into auth.users(id,email) values(${owner},${`history-race-${owner}@example.test`})`;
 await db`insert into public.recipes(id,recipe_uuid,user_id,name,category,servings,ingredient_sections,instruction_sections) values
  (${old},${old},${owner},'Race old','Dinner',4,'[{"label":null,"ingredients":[{"item":"milk","amount":1,"unit":"cup"}]}]','[{"label":null,"steps":["Cook"]}]'),
  (${replacement},${replacement},${owner},'Race new','Dinner',4,'[{"label":null,"ingredients":[{"item":"milk","amount":1,"unit":"cup"}]}]','[{"label":null,"steps":["Cook"]}]')`;
 await db`insert into public.weekly_plans(user_id,week_date,recipe_uuids,day_assignment_recipe_uuids,scale) values(${owner},'2026-09-28',${[old]},${db.json(assignments)},1.5)`;
 const before=(await db`select * from public.weekly_plans where user_id=${owner}`)[0];
 const history=db.begin(async sql=>{
  await sql`set local role authenticated`;await sql`select set_config('request.jwt.claim.sub',${owner},true)`;
  await sql`insert into public.recipe_history(user_id,recipe_uuid,date_made) values(${owner},${old},'2026-10-01T12:00:00-05:00')`;
  inserted();await gate;
 });
 await ready;
 const swap=db.begin(async sql=>{
  await sql`set local role authenticated`;await sql`select set_config('request.jwt.claim.sub',${owner},true)`;
  return sql`select public.replace_planned_recipe('2026-09-28',${old},${replacement},4,1,${[old]}::uuid[],'{}'::uuid[],${sql.json(assignments)},'America/Chicago')`;
 }).then(()=>({success:true}),error=>({success:false,message:error.message}));
 let waiting=false;const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  const rows=await db`select count(*)::int as n from pg_stat_activity where wait_event_type='Lock' and query like '%replace_planned_recipe%'`;
  if(rows[0].n>0){waiting=true;break;}
  await new Promise(r=>setTimeout(r,50));
 }
 assert.equal(waiting,true,'swap must wait for the uncommitted history source lock');unblock();await history;
 assert.deepEqual(await swap,{success:false,message:'A cooked meal cannot be swapped.'});
 assert.deepEqual((await db`select * from public.weekly_plans where user_id=${owner}`)[0],before);
 assert.equal((await db`select count(*)::int as n from public.recipe_history where user_id=${owner}`)[0].n,1);
 console.log('PASS real two-transaction history insertion race: waiting swap rejected; plan, history and scale preserved');
}finally{unblock?.();await db`delete from auth.users where id=${owner}`;await db.end();}
