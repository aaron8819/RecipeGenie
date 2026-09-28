import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, createShoppingRecipeEntry, projectShoppingDocument, type ShoppingDocumentV3 } from '../src/lib/shopping-document';
import { initializeShoppingDocument } from '../src/lib/shopping-initialization';
import { readShoppingCompatibility } from '../src/lib/shopping-compatibility';
import { canonicalShoppingPayload, type ShoppingCommand } from '../src/lib/shopping-command';
import { planShoppingCommand, type ShoppingCommandContext } from '../src/lib/shopping-command-planner';
import { shoppingCompatibilityFixture, ONE } from '../src/test/shopping-compatibility-fixtures';
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

async function main() {
  try {
    check((await db`select current_database() as database, inet_server_port() as port`)[0], { database: 'postgres', port: 5432 }, 'task database identity');
    if (process.argv.includes('--apply')) {
      check((await db`select to_regprocedure('public.is_shopping_document_v4(jsonb)') as f`)[0].f, null, 'upgrade starts at accepted Slice 6 schema');
      const a = await owner(); const original = shoppingCompatibilityFixture().document;
      await db`update public.shopping_list set document=${json(original)},content_revision=content_revision+1 where user_id=${a.id}`;
      const before = await read(a);
      const connection = await db.reserve();
      try { await connection.unsafe(readFileSync('../supabase/migrations/024_shopping_identity_extras.sql', 'utf8')); }
      finally { await connection.unsafe('rollback'); connection.release(); }
      check(await read(a), before, 'upgrade preserves existing document, numeric data and revision exactly');
    }
    const a = await owner(), b = await owner();
    const before = await read(a);
    check((await a.client.from('shopping_list').select('document,content_revision').single()).data, { document: before.document, content_revision: Number(before.content_revision) }, 'authenticated HTTP read does not initialize');
    await apply(a, { type: 'initialize' });
    const initialized = (await read(a)).document as ShoppingDocumentV3;
    check(initialized.schemaVersion, 4, 'explicit conversion persists schema 4');
    check((await send(a, command({ type: 'initialize' }, await rev(a)))).result.status, 'Unchanged', 'repeated initialization is a validated no-op');
    const original = shoppingCompatibilityFixture();
    const recipeId = randomUUID();
    const inserted = await a.client.from('recipes').insert({ user_id: a.id, recipe_uuid: recipeId, name: 'Slice Seven Lemons', category: 'Dinner', servings: 4,
      tags: [], ingredient_sections: [{ label: 'Sauce', ingredients: original.recipes[0].ingredientSections[0].ingredients }], instruction_sections: [{ label: null, steps: ['Mix.'] }] }).select('*').single();
    assert.equal(inserted.error, null);
    const recipe = mapRecipeRows([inserted.data] as never)[0];
    const entry = createShoppingRecipeEntry(recipe, 4, ONE);
    await apply(a, { type: 'upsertRecipe', entry });
    const addition = await apply(a, extra('extra-a'));
    let saved = (await read(a)).document as ShoppingDocumentV3;
    check(projectShoppingDocument(saved).items.find(row => row.orderingKey === 'lemon')?.quantity?.amount, 5, 'real persisted recipe 2 + extra 3 = 5');
    check(saved.recipeEntries[recipeId].sourceEvidence?.occurrences[0].section, 'Sauce', 'new source section captured');
    check(saved.recipeEntries[recipeId].sourceEvidence?.occurrences[0].raw, recipe.ingredientSections[0].ingredients[0], 'original source quantity/text captured');
    await apply(a, { type: 'editManualItem', id: 'extra-a', changes: { quantity: { amount: 7, unit: 'count' } } });
    const afterEdit = await read(a);
    check((await http(a, addition.body)).status, 'AlreadyApplied', 'lost response retry returns historical receipt');
    check(await read(a), afterEdit, 'historical replay never restores earlier amount');
    check((await http(b, addition.body)).status, 'UnknownAdmission', 'cross-owner ticket cannot execute or disclose history');
    check((await http(a, { ...addition.body, command: command(extra('forged'), 1) })).status, 'PayloadMismatch', 'ticket payload binding survives V4 activation');
    const firstRevision = await rev(a);
    const c = command(extra('banana', 'banana'), firstRevision), d = command(extra('apple', 'apple'), firstRevision);
    // Both commands are admitted and prepared against the same committed state
    // before either execution is released. Actual receipt revisions define order.
    const [ct, dt] = await Promise.all([admitted(a, c), admitted(a, d)]);
    const responses = await Promise.all([http(a, ct), http(a, dt)]);
    check(responses.map(r => r.status), ['Applied', 'Applied'], 'concurrent independent batches both commit via HTTP');
    const order = responses[0].receipt.revision < responses[1].receipt.revision ? ['banana', 'apple'] : ['apple', 'banana'];
    saved = (await read(a)).document as ShoppingDocumentV3;
    check(saved.preferences.ingredientOrderByCategory.produce, ['lemon', ...order], 'append order equals database commit order');
    const stale = command({ type: 'editManualItem', id: 'extra-a', changes: { quantity: { amount: 99, unit: 'count' } } }, firstRevision);
    stale.observedManual = initialized.manualItems[0];
    check((await send(a, stale)).result.status, 'Conflict', 'stale conflicting edit refuses');
    const scaleTwo = createShoppingRecipeEntry(recipe, 8, { numerator: '2', denominator: '1' });
    await apply(a, { type: 'upsertRecipe', entry: scaleTwo });
    check((await send(a, command({ type: 'upsertRecipe', entry: scaleTwo }, await rev(a)))).result.status, 'Unchanged', 'set-to-two repeated does not double');
    check(projectShoppingDocument((await read(a)).document).items.find(row => row.orderingKey === 'lemon')?.quantity?.amount, 11, 'recipe yield replacement plus unchanged extra persisted');

    // Actual source mutation after trusted planning invalidates dependency CAS.
    const sourceCommand = command({ type: 'upsertRecipe', entry }, await rev(a));
    const sourceTicket = await admitted(a, sourceCommand);
    const hash = createHash('sha256').update(canonicalShoppingPayload(sourceCommand)).digest('hex');
    const ticketArgs = { p_owner: a.id, p_sequence: sourceTicket.sequence, p_operation: sourceTicket.operationId, p_hash: hash };
    const snapshot = (await admin.rpc('shopping_command_context', ticketArgs)).data as ShoppingCommandContext;
    const plan = planShoppingCommand(snapshot, sourceCommand);
    assert.equal((await a.client.from('recipes').update({ name: 'Changed source' }).eq('recipe_uuid', recipeId)).error, null);
    const commit = await admin.rpc('shopping_commit', { ...ticketArgs, p_revision: snapshot.row!.content_revision,
      p_dependency: snapshot.dependencyRevision, p_document: plan.document, p_outcome: plan.outcome,
      p_action: 'mutation', p_pantry_item: null, p_recipe: null });
    check(commit.error, null, 'trusted commit RPC remains callable by service');
    check(commit.data.status, 'Replan', 'source mutation invalidates the planned dependency snapshot');
    check((await http(a, sourceTicket)).status, 'Conflict', 'HTTP replanning refuses stale source evidence');

    const legacy = shoppingCompatibilityFixture().document;
    await db`update public.shopping_list set document=${json(legacy)},content_revision=content_revision+1 where user_id=${b.id}`;
    await apply(b, { type: 'initialize' });
    await apply(b, { type: 'editManualItem', id: 'manual-extra', changes: { quantity: { amount: 4, unit: 'count' }, checked: true } });
    const mixed = (await read(b)).document as ShoppingDocumentV3;
    check(mixed.manualItems[0].identity?.meaning, 'legacyIndependent', 'legacy amount edit does not imply extra');
    check(mixed.manualItems[0].identity?.legacy?.raw, legacy.manualItems[0], 'legacy raw evidence immutable after edits');
    await apply(b, extra('unrelated', 'milk'));
    await apply(b, { type: 'resolveLegacy', id: 'manual-extra', expectedVersion: 1, choice: 'extra',
      quantity: { amount: 4, unit: 'count' }, purchaseName: 'lemons', categoryKey: 'produce', anchor: null });
    check(((await read(b)).document as ShoppingDocumentV3).manualItems[0].identity?.conversion?.raw, legacy.manualItems[0], 'explicit resolution retains original provenance');
    check(projectShoppingDocument((await read(b)).document).items.find(row => row.orderingKey === 'lemon')?.quantity?.amount, 7, 'resolved extra joins recipe total');

    const fixtures: unknown[] = [initializeShoppingDocument(legacy, []), initialized, null, {}, { ...initialized, schemaVersion: 5 },
      { ...initialized, placementEvidence: null }, { ...initialized, extraField: true }];
    for (const mutate of [
      (d: Record<string, any>) => { d.manualItems[0].identity.version = '0'; },
      (d: Record<string, any>) => { Object.values(d.recipeEntries).forEach((e: any) => { e.sourceEvidence.version = '0'; }); },
      (d: Record<string, any>) => { Object.values(d.recipeEntries).forEach((e: any) => { if (e.sourceEvidence.occurrences[0]) e.sourceEvidence.occurrences[0].ordinal = '0'; }); },
      (d: Record<string, any>) => { d.placementEvidence.unresolved.bad = { categories: ['misc'], sequences: { misc: [1] } }; },
      (d: Record<string, any>) => { d.preferences.categoryByIngredient.orphan = 'produce'; },
    ]) {
      const invalid = initializeShoppingDocument(legacy, []); mutate(invalid); fixtures.push(invalid);
    }
    for (const fixture of fixtures) {
      const sql = (await db`select public.is_shopping_document_v4(${json(fixture)}) as valid`)[0].valid;
      check(sql, readShoppingCompatibility(fixture, 1).status === 'Supported', 'SQL/TypeScript structural parity');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      check((await db`select has_table_privilege(${role},'public.recipes','TRUNCATE') as allowed`)[0].allowed, false, `${role} TRUNCATE fence remains closed`);
    }
    const denied = await a.client.from('shopping_list').update({ document: json(initialized) as never }).eq('user_id', a.id);
    check(denied.error?.code, '42501', 'authenticated REST document replacement denied');
    const recipeDelete = await apply(a, { type: 'deleteRecipe', recipeId });
    check(recipeDelete.result.receipt.outcome, 'Applied', 'coordinated deletion receipt');
    check(((await read(a)).document as ShoppingDocumentV3).recipeEntries[recipeId], undefined, 'coordinated deletion removes V4 source evidence with selection');
    saved = (await read(a)).document as ShoppingDocumentV3;
    const inverse = { recipeEntries: saved.recipeEntries, manualItems: saved.manualItems, itemOverrides: saved.itemOverrides };
    const clearCommand = { ...command({ type: 'complete' }, await rev(a)), clearUndoRequired: true };
    const cleared = await send(a, clearCommand);
    check(cleared.result.status, 'Applied', 'manual-only V4 Clear commits');
    check(cleared.result.receipt.undoAvailable, true, 'actual bounded V4 inverse supports compact Undo');
    await apply(a, { type: 'undoClear' });
    saved = (await read(a)).document as ShoppingDocumentV3;
    check({ recipeEntries: saved.recipeEntries, manualItems: saved.manualItems, itemOverrides: saved.itemOverrides }, inverse, 'Undo restores all nested evidence exactly');
    check(readShoppingCompatibility(saved, await rev(a)).status, 'Supported', 'restored V4 remains supported');
    console.log(JSON.stringify({ passed: checks, total: checks, failed: 0, skipped: 0, mode: process.argv.includes('--apply') ? 'upgrade-023-to-024' : 'fresh-024' }));
  } finally {
    for (const id of owners) { const deleted = await admin.auth.admin.deleteUser(id); assert.equal(deleted.error, null); }
    await db.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
