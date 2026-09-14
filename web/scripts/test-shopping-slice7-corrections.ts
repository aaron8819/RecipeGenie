import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, type ShoppingDocumentV3 } from '../src/lib/shopping-document';
import { initializeShoppingDocument } from '../src/lib/shopping-initialization';
import { canonicalShoppingPayload, type ShoppingCommand } from '../src/lib/shopping-command';
import { planShoppingCommand, type ShoppingCommandContext } from '../src/lib/shopping-command-planner';
import { ONE } from '../src/test/shopping-compatibility-fixtures';
import { mapRecipeRows } from '../src/lib/recipe-identity';

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
const read = async (a: Owner) => (await db`select document,content_revision from public.shopping_list where user_id=${a.id}`)[0];
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
      p_action: c.mutation.type === 'pantry' ? 'pantry' : 'mutation', p_pantry_item: plan.pantryItem, p_recipe: null });
    assert.equal(result.error, null); return result.data;
  } };
}

async function main() {
  let complete = false;
  try {
    check((await db`select current_database() as database, inet_server_port() as port`)[0], { database: 'postgres', port: 5432 }, 'loopback database');
    for (const replacementYield of [4, 12]) {
      const a = await owner(); await apply(a, { type: 'initialize' });
      const recipe = await insertRecipe(a);
      const select = (n: number): ShoppingCommand['mutation'] => ({ type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, n, { numerator: String(n / 4), denominator: '1' }) });
      await apply(a, select(4));
      if (process.argv.includes('--upgrade-fixtures')) {
        const original = (await read(a)).document;
        original.recipeEntries[recipe.id].sourceEvidence.version = 0; // Original Slice 7 persisted token.
        await db`update public.shopping_list set document=${json(original)},content_revision=content_revision+1 where user_id=${a.id}`;
        const before = await read(a);
        await a.client.from('shopping_list').select('document').single();
        check(await read(a), before, 'old V4 read preserves snapshot, token, yield and organization');
      }
      const observed = await read(a), version = observed.document.recipeEntries[recipe.id].sourceEvidence.version;
      const c = { ...command(select(8), Number(observed.content_revision)), observedSelections: { [recipe.id]: version } };
      const pending = await prepared(a, c);
      const removal = await admitted(a, { ...command({ type: 'removeRecipe', recipeId: recipe.id }, await rev(a)), observedSelections: { [recipe.id]: version } });
      await apply(a, { type: 'removeRecipe', recipeId: recipe.id }); await apply(a, select(replacementYield));
      const replacement = await read(a);
      check(replacement.document.recipeEntries[recipe.id].sourceEvidence.version > version, true, 'F1 replacement token never reused');
      check((await pending.commit()).status, 'Replan', 'F1 prepared plan cannot commit across replacement');
      check((await http(a, pending.ticket)).status, 'Conflict', 'F1 original intent conflicts after replan');
      check((await http(a, pending.ticket)).receipt.outcome, 'Conflict', 'F1 receipt replay retains conflict');
      check((await http(a, removal)).status, 'Conflict', 'F3 stale removal cannot remove replacement');
      check(await read(a), replacement, 'F1/F3 preserve entire replacement document, snapshot, identity and yield');
      const committed = await apply(a, select(8)); // Simulate lost execution response, keep ticket.
      await apply(a, { type: 'removeRecipe', recipeId: recipe.id }); await apply(a, select(12));
      const later = await read(a);
      check((await http(a, committed.body)).status, 'AlreadyApplied', 'F1 lost-response retry replays committed operation');
      check(await read(a), later, 'F1 committed retry never retargets replacement');
    }
    for (const variant of ['full', 'partial', 'category', 'conflicting']) {
      const partial = variant === 'partial';
      const a = await owner(), legacy = createEmptyShoppingDocument();
      legacy.manualItems = ['zucchini', 'banana', 'apple', 'hidden'].map((displayName, i) => ({ id: String(i), displayName,
        quantity: { amount: i + 1, unit: 'count' }, categoryKey: 'produce', bucket: i === 3 ? 'already_have' : 'items', checked: false }));
      legacy.preferences.ingredientOrderByCategory = { produce: partial ? ['zucchini', 'hidden'] : ['zucchini', 'hidden', 'banana', 'apple'] };
      if (variant === 'category') {
        legacy.manualItems.forEach(i => { i.categoryKey = 'dairy'; });
        legacy.preferences.ingredientOrderByCategory = { dairy: legacy.preferences.ingredientOrderByCategory.produce };
        legacy.preferences.categoryByIngredient = { banana: 'dairy' };
      }
      if (variant === 'conflicting') {
        legacy.manualItems.push({ ...legacy.manualItems[1], id: 'duplicate', categoryKey: 'dairy' });
        legacy.preferences.categoryByIngredient = { banana: 'dairy' };
      }
      await db`update public.shopping_list set document=${json(legacy)},content_revision=1 where user_id=${a.id}`;
      const before = projectShoppingDocument(legacy); await apply(a, { type: 'initialize' });
      const after = await read(a);
      check(projectShoppingDocument(after.document).rows.map(r => [r.rowRef, r.categoryKey, r.displayName]), before.rows.map(r => [r.rowRef, r.categoryKey, r.displayName]), 'F2 legacy displayed order and categories preserved');
      check(after.document.manualItems.map((i: { identity: { legacy: { raw: unknown } } }) => i.identity.legacy.raw), legacy.manualItems, 'F2 original quantities/category/hidden evidence retained');
      if (variant === 'conflicting') check(after.document.placementEvidence.unresolved.banana.sequences, legacy.preferences.ingredientOrderByCategory, 'F2 all conflicting placement evidence retained');
      check((await send(a, command({ type: 'initialize' }, await rev(a)))).result.status, 'Unchanged', 'F2 repeated initialization');
      check(await read(a), after, 'F2 repeated initialization does not reset organization');
      await apply(a, { type: 'editManualItem', id: '3', changes: { bucket: 'items' } });
      check((await read(a)).document.preferences, after.document.preferences, 'F2 returning hidden manual keeps placement');
    }
    {
      const a = await owner(); await apply(a, { type: 'initialize' }); const recipe = await insertRecipe(a);
      await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, ONE) });
      const row = projectShoppingDocument((await read(a)).document).items[0];
      await apply(a, { type: 'setSuppressed', aggregateKey: row.rowRef.slice('derived:'.length), suppressed: true });
      const before = await read(a);
      const changed = await a.client.from('recipes').update({ ingredient_sections: [{ label: 'Changed', ingredients: [{ item: 'apple', amount: 1, unit: 'count' }] }] }).eq('recipe_uuid', recipe.id).select('*').single();
      assert.equal(changed.error, null);
      await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(mapRecipeRows([changed.data] as never)[0], 4, ONE) });
      const after = await read(a);
      check(after.document.itemOverrides, {}, 'F3 changed-ingredient refresh retires old orphan override');
      check(after.document.preferences.ingredientOrderByCategory.produce, [...before.document.preferences.ingredientOrderByCategory.produce, 'apple'], 'F3 refresh retains dormant source placement');
      check(after.document.recipeEntries[recipe.id].sourceEvidence.version > before.document.recipeEntries[recipe.id].sourceEvidence.version, true, 'F1 source refresh advances token');
    }
    for (const bucket of ['excluded', 'already_have'] as const) {
      const a = await owner(); await apply(a, { type: 'initialize' });
      const r1 = await insertRecipe(a), r2 = await insertRecipe(a);
      for (const r of [r1, r2]) await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(r, 4, ONE) });
      await apply(a, extra('extra'));
      const key = projectShoppingDocument((await read(a)).document).items[0].rowRef.slice('derived:'.length);
      await apply(a, { type: 'setBucketOverride', aggregateKey: key, bucket });
      const before = await read(a);
      await apply(a, { type: 'removeRecipe', recipeId: r1.id });
      const remaining = await read(a);
      check(Object.keys(remaining.document.recipeEntries), [r2.id], 'F3 duplicate title removes only UUID selection');
      check(remaining.document.itemOverrides, before.document.itemOverrides, 'F3 shared hidden purchase retains override');
      check(remaining.document.manualItems, before.document.manualItems, 'F3 manual extra survives');
      await apply(a, { type: 'removeRecipe', recipeId: r2.id });
      const empty = await read(a);
      check(empty.document.itemOverrides, {}, 'F3 last hidden source removes orphan override');
      check(empty.document.preferences, before.document.preferences, 'F3 all dormant placement survives');
    }
    const a = await owner(); await apply(a, { type: 'initialize' }); await apply(a, extra('manual'));
    const rebind = command({ type: 'rebindManualItem', id: 'manual', expectedVersion: 0, displayName: 'apple', quantity: { amount: 3, unit: 'count' } }, await rev(a));
    const pending = await prepared(a, rebind);
    await apply(a, { type: 'pantry', rowRef: projectShoppingDocument((await read(a)).document).items[0].rowRef });
    const hidden = await read(a);
    check((await pending.commit()).status, 'Replan', 'F4 bridge between validation and commit fences plan');
    check((await http(a, pending.ticket)).status, 'Conflict', 'F4 stale rebind conflicts');
    check(await read(a), hidden, 'F4 stale rebind preserves manual quantity, identity and organization');
    await apply(a, { type: 'editManualItem', id: 'manual', changes: { bucket: 'items' } });
    check((await send(a, rebind)).result.status, 'Conflict', 'F4 bucket ABA does not restore old token');
    // Ordinary availability cannot hide manual extras. Add/edit/remove and ABA
    // affect dependencyRevision but not the inspected manual quantity/bucket.
    for (const transition of ['add', 'edit', 'remove', 'aba']) {
      const before = await read(a), item = before.document.manualItems[0];
      const c = command({ type: 'rebindManualItem', id: 'manual', expectedVersion: item.identity.version,
        displayName: item.identity.purchaseKey === 'apple' ? 'lemon' : 'apple', quantity: item.quantity }, await rev(a));
      const plan = await prepared(a, c);
      const pantry = await a.client.from('pantry_items').select('*'); assert.equal(pantry.error, null);
      if (transition === 'add') assert.equal((await a.client.from('pantry_items').insert({ user_id: a.id, item: 'apple' })).error, null);
      if (transition === 'edit') assert.equal((await a.client.from('pantry_items').update({ item: 'pear' }).eq('id', pantry.data![0].id)).error, null);
      if (transition === 'remove') assert.equal((await a.client.from('pantry_items').delete().eq('id', pantry.data![0].id)).error, null);
      if (transition === 'aba') {
        const inserted = await a.client.from('pantry_items').insert({ user_id: a.id, item: 'temporary' }).select('*').single(); assert.equal(inserted.error, null);
        assert.equal((await a.client.from('pantry_items').delete().eq('id', inserted.data!.id)).error, null);
      }
      check((await plan.commit()).status, 'Replan', `F4 ${transition} serialized at commit`);
      check((await http(a, plan.ticket)).status, 'Applied', `F4 ${transition} permits still-valid manual intent`);
      check((await read(a)).document.manualItems[0].quantity, item.quantity, 'F4 current rebind preserves quantity');
      const result = await read(a); check((await http(a, plan.ticket)).status, 'AlreadyApplied', 'F4 retry deduplicated'); check(await read(a), result, 'F4 retry preserves persisted result');
    }
    complete = true;
  } finally {
    for (const id of owners) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
    await db.end();
    console.log(JSON.stringify({ passed: checks, total: checks + (complete ? 0 : 1), failed: complete ? 0 : 1, skipped: 0, complete }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
