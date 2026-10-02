import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import postgres from 'postgres';

// Explicitly bound to the newly authorized disposable backend, never ambient DB.
const status = JSON.parse(readFileSync('../.codex-artifacts/dashboard-final-backend/status.json', 'utf8'));
assert.equal(status.API_URL, 'http://127.0.0.1:62421');
const baseline = process.argv.includes('--expect-baseline');
const db = postgres({host:'127.0.0.1',port:62422,user:'postgres',password:'postgres',database:'postgres',max:6,onnotice:()=>{}});
assert.equal((await db`select max(version) v from supabase_migrations.schema_migrations`)[0].v, baseline ? '031' : '032');
const owner = randomUUID(), old = randomUUID(), next = randomUUID();
const assignments = {[old]:1};
const auth = async (sql, role = 'authenticated') => {
  await sql`select set_config('request.jwt.claim.sub',${owner},true)`;
  await sql`set local statement_timeout = '8s'`;
  await sql`set local lock_timeout = '6s'`;
  if (role === 'authenticated') await sql`set local role authenticated`;
};
const lockOwner = sql => sql`select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe-genie/planner/' || ${owner}::text, 0))`;
const swap = sql => sql`select public.replace_planned_recipe('2026-09-28',${old},${next},4,1,${[old]}::uuid[],'{}'::uuid[],${sql.json(assignments)},'America/Chicago')`;
const cook = sql => sql`select public.toggle_weekly_recipe_made(${old},'2026-09-28',true,'2026-10-01T12:00:00-05:00')`;
const remove = sql => sql`select private.shopping_delete_recipe_internal(${old})`;
const history = sql => sql`insert into public.recipe_history(user_id,recipe_uuid,date_made) values(${owner},${old},'2026-10-01T12:00:00-05:00')`;
const updateHistory = sql => sql`update public.recipe_history set date_made='2026-10-01T12:00:00-05:00' where user_id=${owner}`;
const outcome = promise => promise.then(() => ({ok:true}), e => ({ok:false,code:e.code,message:e.message}));
const waitLock = async pid => {
  const deadline = Date.now()+4000;
  while (Date.now()<deadline) {
    if ((await db`select wait_event_type from pg_stat_activity where pid=${pid}`)[0]?.wait_event_type === 'Lock') return;
    await new Promise(r => setTimeout(r,25));
  }
  throw Error('Second transaction did not reach the expected lock wait');
};
async function seed(withHistory = false) {
  await db`delete from public.recipe_history where user_id=${owner}`;
  await db`delete from public.weekly_plans where user_id=${owner}`;
  await db`insert into public.recipes(id,recipe_uuid,user_id,name,category,servings,ingredient_sections,instruction_sections)
    values(${old},${old},${owner},'Lock old','Dinner',4,'[]','[]'),(${next},${next},${owner},'Lock next','Dinner',4,'[]','[]') on conflict(recipe_uuid) do nothing`;
  await db`insert into public.weekly_plans(user_id,week_date,recipe_uuids,day_assignment_recipe_uuids,scale)
    values(${owner},'2026-09-28',${[old]},${db.json(assignments)},1.5)`;
  if (withHistory) await db`insert into public.recipe_history(user_id,recipe_uuid,date_made) values(${owner},${old},'2026-09-01T12:00:00-05:00')`;
}
// Probe deletion immediately after its source lock, just as the independent
// report did. On 032, acquire its actual new owner lock BEFORE the source lock.
// No retries; both sessions have hard time bounds and recorded SQL outcomes.
async function race(label, firstAction, secondAction, {deletionFirst=false, secondDelete=false} = {}) {
  let release, ready, started, secondPid;
  const gate = new Promise(r=>release=r), firstReady = new Promise(r=>ready=r);
  const secondStarted = new Promise(r=>started=r);
  const first = outcome(db.begin(async sql => {
    await auth(sql, deletionFirst ? 'postgres' : 'authenticated');
    if (deletionFirst) {
      if (!baseline) await lockOwner(sql);
      await sql`select 1 from public.recipes where recipe_uuid=${old} for update`;
    } else await firstAction(sql);
    ready(); await gate;
    if (deletionFirst) await remove(sql);
  }));
  try {
    await firstReady;
    const second = outcome(db.begin(async sql => {
      await auth(sql, secondDelete ? 'postgres' : 'authenticated');
      secondPid = (await sql`select pg_backend_pid() pid`)[0].pid; started();
      await secondAction(sql);
    }));
    await secondStarted; await waitLock(secondPid); release();
    const results = await Promise.all([first,second]);
    assert(!results.some(r=>['57014','55P03'].includes(r.code)), 'bounded operation timed out');
    console.log(label, JSON.stringify(results));
    return results;
  } finally { release(); await first; }
}
async function plan() {return (await db`select * from public.weekly_plans where user_id=${owner}`)[0];}
try {
  await db`insert into auth.users(id,email) values(${owner},${`dashboard-lock-${owner}@example.test`})`;
  await seed();
  let result = await race('deletion-first / swap', remove, swap, {deletionFirst:true});
  if (baseline) {
    assert(result.some(r=>r.code==='40P01'));
    console.log('REPRODUCED original 031 deletion/swap deadlock');
  } else {
    assert.equal(result[0].ok,true); assert.match(result[1].message,/no longer in the plan/);
    assert.deepEqual((await plan()).recipe_uuids,[]);
    await seed();
    result = await race('swap-first / deletion',swap,remove,{secondDelete:true});
    assert(result.every(r=>r.ok)); assert.deepEqual((await plan()).recipe_uuids,[next]);
    assert.equal((await plan()).day_assignment_recipe_uuids[next],4);
    for (const [name,action] of [['weekly-cooking',cook],['history-insert',history],['history-update',updateHistory]]) {
      await seed(name==='history-update');
      result=await race(`deletion-first / ${name}`,remove,action,{deletionFirst:true});
      assert.equal(result[0].ok,true);
      // Historical rows survive recipe deletion by design. Date edits still
      // work; new history/cooking reject the now-unresolved recipe.
      assert.equal(result[1].ok,name==='history-update');
      assert.deepEqual((await plan()).recipe_uuids,[]);
      assert.equal((await db`select count(*)::int n from public.recipe_history where user_id=${owner}`)[0].n,name==='history-update'?1:0);
      await seed(name==='history-update');
      result=await race(`${name}-first / deletion`,action,remove,{secondDelete:true});
      assert(result.every(r=>r.ok)); assert.deepEqual((await plan()).recipe_uuids,[]);
      assert.equal((await db`select count(*)::int n from public.recipe_history where user_id=${owner}`)[0].n,1);
    }
    for (const [name,action] of [['weekly-cooking',cook],['history-insert',history],['history-update',updateHistory]]) {
      await seed(name==='history-update');
      result=await race(`${name}-first / swap`,action,swap);
      assert.equal(result[0].ok,true); assert.match(result[1].message,/cooked|plan changed/);
      assert.deepEqual((await plan()).recipe_uuids,[old]);
      await seed(name==='history-update');
      result=await race(`swap-first / ${name}`,swap,action);
      assert(result.every(r=>r.ok)); assert.deepEqual((await plan()).recipe_uuids,[next]);
      assert.equal((await plan()).day_assignment_recipe_uuids[next],4);
      assert.equal((await db`select count(*)::int n from public.recipe_history where user_id=${owner}`)[0].n,1);
    }
    assert.equal(Number((await plan()).scale),1.5);
    console.log('PASS 14 bounded concurrency schedules: no deadlocks/retries; membership/day/scale/history outcomes verified');
  }
} finally {await db`delete from auth.users where id=${owner}`; await db.end();}
