import { inspectOrganization, moveInverse, type OrganizationAction } from '../src/lib/shopping-organization';
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

const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
const db = postgres({ host: '127.0.0.1', port: 57322, database: 'postgres', user: 'postgres', password: 'postgres', max: 1, onnotice: () => {} });
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

async function main() {
 try {
  check(Number((await db`select count(*) from auth.users`)[0].count),0,'task database has no fixture owners before upgrade');
  check((await db`select public.is_shopping_document_v4(${json({schemaVersion:4})}) as valid`)[0].valid,false,'027 validator present');
  const a=await owner();
  const old=JSON.parse(readFileSync('../.codex-artifacts/slice9/http-state.json','utf8')).document;
  delete old.organizationVersions;
  await db`update public.shopping_list set document=${json(old)},content_revision=content_revision+1 where user_id=${a.id}`;
  const before=await read(a);
  await db.unsafe(readFileSync('../supabase/migrations/028_shopping_organization_versions.sql','utf8'));
  check(await read(a),before,'populated 027 to 028 preserves exact document/revision/trip/epoch');
  check((await db`select public.is_shopping_document_v4(${json({...old,organizationVersions:{'purchase:apple':1}})}) as valid`)[0].valid,true,'028 admits valid version metadata');
  for(const value of [-1,1.5,'1',null,9007199254740992]) check((await db`select public.is_shopping_document_v4(${json({...old,organizationVersions:{'purchase:apple':value}})}) as valid`)[0].valid,false,'028 rejects malformed history');
  writeFileSync('../.codex-artifacts/slice9/upgrade-results.json',JSON.stringify({checks,before,after:await read(a)},null,2));
 } finally {for(const id of owners) await admin.auth.admin.deleteUser(id);await db.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
