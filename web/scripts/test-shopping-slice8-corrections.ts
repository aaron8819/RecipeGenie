import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, type ShoppingDocumentV3 } from '../src/lib/shopping-document';
import { canonicalShoppingPayload, type ShoppingCommand } from '../src/lib/shopping-command';
import { planShoppingCommand, type ShoppingCommandContext } from '../src/lib/shopping-command-planner';
import { shoppingRowCoverage } from '../src/lib/shopping-coverage-runtime';
import { writeFileSync } from 'node:fs';
import { mapRecipeRows } from '../src/lib/recipe-identity';
import {parseQuantityV1} from '../src/lib/recipe-quantity';

const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const db = postgres({ host: '127.0.0.1', port: 57322, database: 'postgres', user: 'postgres', password: 'postgres', max: 5, onnotice: () => {} });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const owners: string[] = [];
let checks = 0;
function check(actual: unknown, expected: unknown, label: string) { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`); }
const json = (value: unknown) => db.json(JSON.parse(JSON.stringify(value)));
async function owner() {
  const email = `${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(created.error, null); const id = created.data.user!.id; owners.push(id);
  const jar = new Map<string, string>();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(c => jar.set(c.name, c.value)) },
  });
  const login = await client.auth.signInWithPassword({ email, password }); assert.equal(login.error, null);
  return { id, client, token: login.data.session!.access_token, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const read = async (a: Owner) => (await db`select document,content_revision,trip_id,content_epoch from public.shopping_list where user_id=${a.id}`)[0];
const rev = async (a: Owner) => Number((await read(a)).content_revision);
const command = (mutation: ShoppingCommand['mutation'], observedRevision: number): ShoppingCommand => ({ protocol: 1, observedRevision, mutation });
async function http(a: Owner, body: unknown) {
  const result = await fetch('http://127.0.0.1:3117/api/shopping', { method: 'POST',
    headers: { Origin: 'http://127.0.0.1:3117', Cookie: a.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return result.json();
}
async function admitted(a: Owner, c: ShoppingCommand) {
  const operationId = randomUUID();
  const ticket = await http(a, { phase: 'admit', operationId, command: c });
  assert.equal(ticket.status, 'Admitted');
  return { phase: 'execute', operationId, sequence: ticket.sequence as string, command: c };
}
async function send(a: Owner, c: ShoppingCommand) { const body = await admitted(a, c); return { result: await http(a, body), body }; }
async function apply(a: Owner, mutation: ShoppingCommand['mutation']) {
  const sent = await send(a, command(mutation, await rev(a))); check(sent.result.status, 'Applied', `HTTP ${mutation.type} applied`); return sent;
}
const extra = (id: string, name = 'lemon', amount = 3): ShoppingCommand['mutation'] => ({ type: 'addManualItem', item: {
  id, displayName: name, quantity: { amount, unit: 'count' }, categoryKey: 'dairy', bucket: 'items', checked: false,
} });

async function insertRecipe(a: Owner, name = 'Duplicate title', item = 'lemon') {
  const inserted = await a.client.from('recipes').insert({ user_id: a.id, recipe_uuid: randomUUID(), name,
    category: 'Dinner', servings: 4, tags: [], ingredient_sections: [{ label: 'Sauce', ingredients: [{ item, amount: 2, unit: 'count' }] }],
    instruction_sections: [{ label: null, steps: ['Mix'] }] }).select('*').single();
  assert.equal(inserted.error, null); return mapRecipeRows([inserted.data] as never)[0];
}

// Hold a real prepared plan across a competing transaction. The production
// commit must return Replan; execute then reuses the exact admitted payload.
async function prepared(a: Owner, c: ShoppingCommand) {
  const ticket = await admitted(a, c);
  const args = { p_owner: a.id, p_sequence: ticket.sequence, p_operation: ticket.operationId,
    p_hash: createHash('sha256').update(canonicalShoppingPayload(c)).digest('hex') };
  const ctx = await admin.rpc('shopping_command_context', args); assert.equal(ctx.error, null);
  const snapshot = ctx.data as ShoppingCommandContext;
  const plan = planShoppingCommand(snapshot, c);
  return { ticket, commit: async () => {
    const result = await admin.rpc('shopping_commit', { ...args, p_revision: snapshot.row!.content_revision,
      p_dependency: snapshot.dependencyRevision, p_document: plan.document, p_outcome: plan.outcome,
      p_action: c.mutation.type === 'undoClear' ? 'restoreContent' : ['complete', 'deleteRecipe', 'pantry'].includes(c.mutation.type) ? c.mutation.type : 'mutation', p_pantry_item: plan.pantryItem, p_recipe: c.mutation.type === 'deleteRecipe' ? c.mutation.recipeId : null });
    assert.equal(result.error, null); return result.data;
  } };
}

const findings: unknown[] = [];
async function observe(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'PASS' : 'FINDING'} ${label}: ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
  check(actual, expected, label);
}
async function acknowledge(a: Owner) {
  const s = await read(a); const row = projectShoppingDocument(s.document, []).items[0];
  const c = { ...command({ type:'setChecked', rowRef:row.rowRef, checked:true }, Number(s.content_revision)),
    inspectedCoverage: { [row.orderingKey]: { version:s.document.acknowledgements?.[row.orderingKey]?.version ?? 0, basis:shoppingRowCoverage(row) } } };
  const r = await send(a,c); check(r.result.status,'Applied','acknowledgement'); return c;
}

async function alternatives() {
  for (const path of ['refresh', 're-add', 'yield'] as const) {
    for (const equivalent of [false, true]) {
      const a = await owner(); await apply(a, { type: 'initialize' });
      const r = await insertRecipe(a, 'Alternative coverage', 'yogurt');
      async function update(choices: string[]) {
        const response = await a.client.from('recipes').update({ ingredient_sections: [{ label: null,
          ingredients: [{ item: 'yogurt', amount: 2, unit: 'cup', alternatives: choices }] }] })
          .eq('recipe_uuid', r.id).select('*').single();
        assert.equal(response.error, null); return mapRecipeRows([response.data] as never)[0];
      }
      let recipe = await update(path === 'refresh' && !equivalent ? ['sour cream'] : ['sour cream', 'cream cheese']);
      await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
      await acknowledge(a);
      const previous = await read(a);
      if (path === 're-add') await apply(a, { type: 'removeRecipe', recipeId: r.id });
      recipe = await update(equivalent ? ['cream cheese', 'sour cream'] : []);
      const response = await apply(a, { type: path === 'yield' ? 'rescaleRecipe' : 'upsertRecipe',
        entry: createShoppingRecipeEntry(recipe, path === 'yield' ? 2 : 4,
          { numerator: '1', denominator: path === 'yield' ? '2' : '1' }) });
      const saved = await read(a);
      check(projectShoppingDocument(saved.document, []).items[0].checked, equivalent, `alternatives ${path} equivalent=${equivalent}`);
      check(saved.document.acknowledgements, previous.document.acknowledgements, 'saved acknowledgement evidence retained');
      const receipt = (await db`select receipt from private.shopping_admissions where user_id=${a.id} and sequence=${response.body.sequence}`)[0].receipt;
      check(receipt.outcome, 'Applied', 'source receipt persisted');
      check((await http(a, response.body)).status, 'AlreadyApplied', 'source receipt replay');
      if (!equivalent) {
        const row = projectShoppingDocument(saved.document, []).items[0];
        const stale = await send(a, { ...command({ type: 'setChecked', rowRef: row.rowRef, checked: true }, Number(saved.content_revision)),
          inspectedCoverage: { [row.orderingKey]: previous.document.acknowledgements[row.orderingKey] } });
        check(stale.result.receipt.outcome, 'RequirementChanged', 'stale material check refused by authority');
        check(await read(a), saved, 'refusal preserves persisted state');
      }
    }
  }
}

async function main(){try{
 await alternatives();
 const compatibilityOwner = await owner(); await apply(compatibilityOwner, { type: 'initialize' });
 for (const name of ['tomato', 'lemon']) {
   await apply(compatibilityOwner, extra(randomUUID(), name));
   const state = await read(compatibilityOwner);
   const row = projectShoppingDocument(state.document, []).items.find(row => row.orderingKey === name)!;
   await send(compatibilityOwner, { ...command({ type: 'setChecked', rowRef: row.rowRef, checked: true }, Number(state.content_revision)),
     inspectedCoverage: { [name]: { version: 0, basis: shoppingRowCoverage(row) } } });
 }
 // Task-owned persisted V1 fixture alongside unrelated corrected coverage.
 await db`update public.shopping_list set document=jsonb_set(document,
   '{acknowledgements,tomato,basis,comparisonVersion}','1'::jsonb),content_revision=content_revision+1 where user_id=${compatibilityOwner.id}`;
 const retained = (await read(compatibilityOwner)).document.acknowledgements;
 const cleared = await apply(compatibilityOwner, { type: 'complete' });
 const restored = await send(compatibilityOwner, command({ type: 'undoClear' }, cleared.result.receipt.revision));
 check(restored.result.receipt.outcome, 'Applied', 'Undo restores retained mixed-version evidence');
 const restoredState = await read(compatibilityOwner);
 check(restoredState.document.acknowledgements, retained, 'Clear and Undo never reinterpret old evidence');
 const restoredRows = projectShoppingDocument(restoredState.document, []).items;
 check(restoredRows.find(row => row.orderingKey === 'tomato')?.coverageNeedsRecheck, true, 'old inverse evidence still requires recheck');
 check(restoredRows.find(row => row.orderingKey === 'lemon')?.checked, true, 'unrelated V2 completion stays checked through Clear and Undo');
 const q=(n:number,unit='count')=>({amount:n,unit});
 const exact=(s:string,unit='')=>({amount:null,unit,exactQuantityV1:parseQuantityV1(s)});
 const pack=(n:string,size:string)=>({...exact(n,'can'),exactPackageV1:{version:1,count:parseQuantityV1(n),type:'can',authoredType:'can',size:{value:{numerator:size,denominator:'1'},lexeme:size,unit:'g',authoredUnit:'g'}}});
 const cases:any[]=[
  ['scalar increase',[q(2)],[q(5)],false],['scalar decrease',[q(5)],[q(3)],true],
  ['equivalent units',[q(1,'cup')],[q(48,'tsp')],true],['unrounded increase',[q(1.1)],[q(1.9)],false],
  ['range removal',[exact('1-2'),exact('1-2')],[exact('1-2')],true],['range changed',[exact('1-3')],[exact('1-2')],false],
  ['unknown token removal',[q(2,'cup'),exact('as needed')],[q(2,'cup')],true],
  ['unknown multiplicity',[exact('as needed')],[exact('as needed'),exact('as needed')],false],
  ['mixed covered',[q(2),q(100,'g')],[q(1),q(100,'g')],true],['mixed incompatible',[q(2),q(100,'g')],[q(150,'g')],false],
  ['known package decrease',[pack('2','400')],[pack('1','400')],true],['different package',[pack('2','400')],[pack('1','800')],false],
  ['unknown package count change',[q(2,'can')],[q(1,'can')],false],
  ['unknown package unchanged',[q(2,'can')],[q(2,'cans')],true],
  ['unknown package increase',[q(2,'can')],[q(3,'can')],false],
  ['unknown package descriptor',[q(2,'can')],[q(2,'jar')],false],
  ['unknown package occurrence removed',[q(2,'can'),q(2,'can')],[q(2,'can')],true],
  ['unknown package to known',[q(2,'can')],[pack('2','400')],false],
  ['known package to unknown',[pack('2','400')],[q(2,'can')],false],
  ['unknown package with manual scalar extra',[q(2,'can'),q(3,'cup')],[q(2,'can'),q(2,'cup')],true],
 ];
 for(const [label,old,next,expected] of cases){
  const a=await owner();await apply(a,{type:'initialize'}); const ids:string[]=[];
  for(const quantity of old){const id=randomUUID();ids.push(id);await apply(a,{type:'addManualItem',item:{id,displayName:'tomato',quantity,categoryKey:'produce',bucket:'items',checked:false}});}
  await acknowledge(a);
  for(let i=0;i<Math.max(old.length,next.length);i++){
   if(i>=next.length)await apply(a,{type:'deleteManualItem',id:ids[i]});
   else if(i>=old.length)await apply(a,{type:'addManualItem',item:{id:randomUUID(),displayName:'tomato',quantity:next[i],categoryKey:'produce',bucket:'items',checked:false}});
   else {const r=await send(a,command({type:'editManualItem',id:ids[i],changes:{quantity:next[i]}},await rev(a)));check(['Applied','Unchanged'].includes(r.result.status),true,label+' edit');}
  }
  const saved=await read(a);await observe(label,projectShoppingDocument(saved.document,[]).items[0].checked,expected);
  if (!expected) {
    const row = projectShoppingDocument(saved.document, []).items[0];
    const refused = await send(a, { ...command({ type: 'setChecked', rowRef: row.rowRef, checked: true }, Number(saved.content_revision)),
      inspectedCoverage: { [row.orderingKey]: saved.document.acknowledgements[row.orderingKey] } });
    check(refused.result.receipt.outcome, 'RequirementChanged', `${label}: authoritative stale check refuses`);
    const receipt = (await db`select receipt from private.shopping_admissions where user_id=${a.id} and sequence=${refused.body.sequence}`)[0].receipt;
    check(receipt.outcome, 'RequirementChanged', `${label}: refusal receipt persisted`);
    check(await read(a), saved, `${label}: refusal preserves state`);
  }
  if(label==='unknown package count change')writeFileSync('../.codex-artifacts/review/corrected-unknown-package-state.json',JSON.stringify(saved,null,2));
 }
}finally{for(const id of owners)assert.equal((await admin.auth.admin.deleteUser(id)).error,null);await db.end();writeFileSync('../.codex-artifacts/review/corrections-http-results.json',JSON.stringify({checks,findings},null,2));}}
main().catch(e=>{console.error(e);process.exitCode=1;});
