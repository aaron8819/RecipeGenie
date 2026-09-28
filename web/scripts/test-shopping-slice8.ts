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

async function main() {
  let complete = false;
  try {
    for (const kind of ['manual', 'recipe', 'mixed']) {
      const a = await owner(); await apply(a, { type: 'initialize' });
      const recipe = await insertRecipe(a);
      if (kind !== 'recipe') await apply(a, extra(randomUUID()));
      if (kind !== 'manual') await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
      const original = await read(a);
      const clear = await apply(a, { type: 'complete' });
      check(clear.result.receipt.undoAvailable, true, `${kind} Undo advertised`);
      const cleared = await read(a);
      check(cleared.trip_id !== original.trip_id, true, 'Clear advances trip');
      check(Number(cleared.content_epoch), Number(original.content_epoch) + 1, 'Clear advances epoch');
      check(cleared.document.preferences, original.document.preferences, 'Clear preserves organization');
      await apply(a, { type: 'setExclusion', key: 'cumin', enabled: true });
      const organization = (await read(a)).document.preferences;
      const undoCommand = command({ type: 'undoClear' }, Number(cleared.content_revision));
      const undo = await send(a, undoCommand);
      check(undo.result.status, 'Applied', `${kind} Undo after organization edit`);
      const restored = await read(a);
      check(restored.document.recipeEntries, original.document.recipeEntries, 'restores exact frozen recipe evidence');
      check(restored.document.manualItems, original.document.manualItems, 'restores manual content');
      check(restored.document.preferences, organization, 'latest organization retained');
      check(restored.trip_id !== original.trip_id && restored.trip_id !== cleared.trip_id, true, 'Undo uses fresh generation');
      check(Number(restored.content_epoch), Number(cleared.content_epoch) + 1, 'Undo advances epoch');
      check((await http(a, undo.body)).status, 'AlreadyApplied', 'lost Undo response replay');
      check((await send(a, undoCommand)).result.status, 'UndoUnavailable', 'new Undo cannot reuse inverse');
      check(await read(a), restored, 'duplicate Undo leaves persisted state unchanged');
      const old = { ...command(extra(randomUUID(), 'bread'), Number(original.content_revision)), tripId: original.trip_id };
      check((await send(a, old)).result.status, 'TripEnded', 'old trip content cannot execute');
      check((await http(a, clear.body)).status, 'AlreadyApplied', 'Clear historical receipt precedes trip conditions');
    }

    for (const change of ['add', 'aba']) {
      const a = await owner(); await apply(a, { type: 'initialize' }); await apply(a, extra(randomUUID()));
      const cleared = await apply(a, { type: 'complete' });
      const id = randomUUID(); await apply(a, extra(id, 'bread'));
      if (change === 'aba') await apply(a, { type: 'deleteManualItem', id });
      const before = await read(a);
      check((await send(a, command({ type: 'undoClear' }, cleared.result.receipt.revision))).result.status, 'UndoUnavailable', `${change} refuses stale Undo`);
      check(await read(a), before, 'refused Undo preserves all later content');
    }

    // Frozen planner snapshots are deterministic barriers between the actual
    // authenticated admission/context and service-only atomic commit RPC.
    for (const operation of ['refresh', 'undo'] as const) for (const deletionFirst of [true, false]) {
      const a = await owner(); await apply(a, { type: 'initialize' });
      const recipe = await insertRecipe(a); const entry = createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' });
      await apply(a, { type: 'upsertRecipe', entry });
      if (operation === 'undo') await apply(a, { type: 'complete' });
      const c = command(operation === 'undo' ? { type: 'undoClear' } : { type: 'upsertRecipe', entry }, await rev(a));
      const pending = await prepared(a, c);
      if (deletionFirst) {
        await apply(a, { type: 'deleteRecipe', recipeId: recipe.id });
        check((await pending.commit()).status, 'Replan', `${operation}: deletion wins against prepared write`);
        const rejected = await http(a, pending.ticket);
        check(['SourceUnavailable', 'TargetGone', 'Conflict'].includes(rejected.status), true, `${operation}: stale execution rejects missing source`);
        check((await http(a, pending.ticket)).receipt.outcome, rejected.status, 'source rejection is a terminal receipt');
      } else {
        check(['Applied', 'Unchanged'].includes((await pending.commit()).status), true, `${operation}: content commits first`);
        await apply(a, { type: 'deleteRecipe', recipeId: recipe.id });
        check((await http(a, pending.ticket)).status, 'AlreadyApplied', 'historical result never restores deleted source');
      }
      check((await read(a)).document.recipeEntries, {}, `${operation}: final contribution absent in both orders`);
      check((await db`select count(*)::int as n from public.recipes where user_id=${a.id} and recipe_uuid=${recipe.id}`)[0].n, 0, 'library recipe deleted');
      check((await db`select count(*)::int as n from private.shopping_admissions where user_id=${a.id} and receipt is not null`)[0].n >= 4, true, 'persisted terminal receipts');
    }

    const a = await owner(); await apply(a, { type: 'initialize' });
    const recipe = await insertRecipe(a); await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
    const frozen = (await read(a)).document.recipeEntries;
    const clear = await apply(a, { type: 'complete' });
    const edited = await a.client.from('recipes').update({ name: 'Edited after Clear' }).eq('recipe_uuid', recipe.id);
    check(edited.error, null, 'recipe edit after Clear');
    check((await send(a, command({ type: 'undoClear' }, clear.result.receipt.revision))).result.status, 'Applied', 'edited existing source permits Undo');
    check((await read(a)).document.recipeEntries, frozen, 'Undo does not refresh frozen evidence');

    // Coverage acknowledges the inspected buyable basis, not rounded display.
    const id = randomUUID(); await apply(a, extra(id));
    const state = await read(a);
    const row = projectShoppingDocument(state.document, []).items[0];
    const inspectedCoverage = { [row.orderingKey]: { version: 0, basis: shoppingRowCoverage(row) } };
    const checked = await send(a, { ...command({ type: 'setChecked', rowRef: row.rowRef, checked: true }, Number(state.content_revision)), inspectedCoverage });
    check(checked.result.status, 'Applied', 'HTTP obtains exact basis');
    check(projectShoppingDocument((await read(a)).document, []).items[0].checked, true, 'checked five');
    await apply(a, { type: 'editManualItem', id, changes: { quantity: { amount: 1, unit: 'count' } } });
    check(projectShoppingDocument((await read(a)).document, []).items[0].checked, true, 'covered decrease stays checked');
    await apply(a, { type: 'editManualItem', id, changes: { quantity: { amount: 6, unit: 'count' } } });
    check(projectShoppingDocument((await read(a)).document, []).items[0].requirementChanged, true, 'increase reopens without rewriting acknowledgement');
    const before = await read(a);
    check((await send(a, { ...command({ type: 'setChecked', rowRef: row.rowRef, checked: false }, await rev(a)), inspectedCoverage })).result.status, 'Conflict', 'stale uncheck cannot erase newer acknowledgement');
    check(await read(a), before, 'rejected uncheck leaves state unchanged');
    const b = await owner();
    check((await http(b, checked.body)).status, 'UnknownAdmission', 'foreign owner cannot replay acknowledgement');
    check((await http(a, { ...checked.body, command: { ...checked.body.command, observedRevision: 0 } })).status, 'PayloadMismatch', 'payload binding retained');

    for (const amount of [1, 8]) {
      const actor = await owner(); await apply(actor, { type: 'initialize' });
      const manualId = randomUUID(); await apply(actor, extra(manualId, 'lemon', 5));
      const snapshot = await read(actor); const inspected = projectShoppingDocument(snapshot.document, []).items[0];
      const attempt = await prepared(actor, { ...command({ type: 'setChecked', rowRef: inspected.rowRef, checked: true }, Number(snapshot.content_revision)),
        inspectedCoverage: { lemon: { version: 0, basis: shoppingRowCoverage(inspected) } } });
      await apply(actor, { type: 'editManualItem', id: manualId, changes: { quantity: { amount, unit: 'count' } } });
      check((await attempt.commit()).status, 'Replan', 'coverage commit revalidates concurrent demand');
      check((await http(actor, attempt.ticket)).status, amount > 5 ? 'RequirementChanged' : 'Applied', 'S88 covered decrease succeeds, increase refuses');
      check(projectShoppingDocument((await read(actor)).document, []).items[0].checked, amount < 5, 'persisted acknowledgement projects truthfully');
    }
    const expiry = await owner(); await apply(expiry, { type: 'initialize' }); await apply(expiry, extra(randomUUID()));
    const expiringClear = await apply(expiry, { type: 'complete' });
    await db`update private.shopping_protocol set clear_expires_at=clock_timestamp()-interval '1 second' where user_id=${expiry.id}`;
    const expiredState = await read(expiry);
    check((await send(expiry, command({ type: 'undoClear' }, expiringClear.result.receipt.revision))).result.status, 'UndoUnavailable', 'expired inverse refuses');
    check((await http(expiry, expiringClear.body)).status, 'AlreadyApplied', 'Clear receipt outlives inverse expiry');
    check(await read(expiry), expiredState, 'expiry never mutates content');
    const stale = await admitted(expiry, command(extra(randomUUID(), 'bread'), await rev(expiry)));
    await db`update private.shopping_admissions set expires_at=clock_timestamp()-interval '1 second' where user_id=${expiry.id}`;
    check((await http(expiry, stale)).status, 'RetryExpired', 'expired uncommitted attempt cannot become a new write');
    check(await read(expiry), expiredState, 'expired ticket leaves content unchanged');

    // Undo request is compact even when the stored inverse reaches 1 MiB.
    const big = await owner(); await apply(big, { type: 'initialize' }); await apply(big, extra(randomUUID()));
    const bigDocument = (await read(big)).document;
    bigDocument.manualItems[0].identity.conversion = { id: 'size', version: 0, kind: 'legacyIndependent', raw: { padding: '' },
      displayName: 'lemon', quantity: null, categoryEvidence: [], orderEvidence: [], sourceHistory: null,
      previousChecked: false, unresolvedReasons: ['original meaning unavailable'] };
    const size = Number((await db`select octet_length(private.shopping_content(${json(bigDocument)})::text) as n`)[0].n);
    bigDocument.manualItems[0].identity.conversion.raw.padding = 'x'.repeat(1048576 - size);
    await db`update public.shopping_list set document=${json(bigDocument)},content_revision=content_revision+1 where user_id=${big.id}`;
    const bigClear = await apply(big, { type: 'complete' });
    check(bigClear.result.receipt.undoAvailable, true, 'exact 1 MiB inverse advertised');
    check(Number((await db`select octet_length(clear_inverse::text) as n from private.shopping_protocol where user_id=${big.id}`)[0].n), 1048576, 'exact database byte bound');
    const bigUndo = await send(big, command({ type: 'undoClear' }, bigClear.result.receipt.revision));
    check(bigUndo.result.status, 'Applied', 'maximum inverse restores over authenticated HTTP');
    check((await read(big)).document, bigDocument, 'maximum inverse complete, never partial');
    check(JSON.stringify(bigUndo.body).length < 512, true, 'Undo never sends inverse in request');
    bigDocument.manualItems[0].identity.conversion.raw.padding += 'x';
    await db`update public.shopping_list set document=${json(bigDocument)},content_revision=content_revision+1 where user_id=${big.id}`;
    const oversized = await apply(big, { type: 'complete' });
    check(oversized.result.receipt.undoAvailable, false, 'one byte above bound honestly unavailable');
    check((await send(big, command({ type: 'undoClear' }, oversized.result.receipt.revision))).result.status, 'UndoUnavailable', 'oversized Clear cannot restore partial content');
    complete = true;
  } finally {
    for (const id of owners) { const result = await admin.auth.admin.deleteUser(id); assert.equal(result.error, null); }
    await db.end();
    writeFileSync('../.codex-artifacts/slice8/http-results.json', JSON.stringify({ checks, complete }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
