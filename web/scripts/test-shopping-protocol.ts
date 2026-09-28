import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { planShoppingCommand, type ShoppingCommandContext } from '../src/lib/shopping-command-planner';
import { canonicalShoppingPayload, type ShoppingCommand } from '../src/lib/shopping-command';
import { shoppingCompatibilityFixture, legacyIndependentFixture } from '../src/test/shopping-compatibility-fixtures';
import { isLegacyIndependentNeed } from '../src/lib/shopping-target-legacy';
import { createShoppingRecipeEntry, validateShoppingDocumentV3 } from '../src/lib/shopping-document';
import { mapRecipeRows } from '../src/lib/recipe-identity';

// Task-owned Supabase stack only. No ambient URL, linked project, or shared port.
const db = postgres({ host: '127.0.0.1', port: process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 57322 : 56322, database: 'postgres',
  user: 'postgres', password: 'postgres', max: 8, onnotice: () => {} });
const owners: string[] = [];
let checks = 0;
function check(value: unknown, expected: unknown, label: string) {
  assert.deepEqual(value, expected, label); checks++; console.log(`PASS ${label}`);
}
async function owner() {
  const id = randomUUID(); owners.push(id);
  await db`insert into auth.users(id, email) values(${id}, ${`${id}@example.test`})`;
  return id;
}
async function rpc(name: string, args: unknown[]) {
  assert.ok(['shopping_admit', 'shopping_command_context', 'shopping_commit'].includes(name));
  return db.begin(async (sql) => {
    await sql`set local role service_role`;
    const params = args.map((_, i) => `$${i + 1}`).join(',');
    const [row] = await sql.unsafe(`select public.${name}(${params}) as result`, args as never[]);
    return row.result;
  });
}
function command(mutation: ShoppingCommand['mutation'], revision = 0): ShoppingCommand {
  return { protocol: 1, observedRevision: revision, mutation };
}
function hash(c: ShoppingCommand) { return createHash('sha256').update(canonicalShoppingPayload(c)).digest('hex'); }
async function admit(id: string, c: ShoppingCommand, operation = randomUUID(), recover = false) {
  const result = await rpc('shopping_admit', [id, operation, hash(c), recover]);
  return { ...result, operation, hash: hash(c), owner: id };
}
async function context(ticket: Awaited<ReturnType<typeof admit>>) {
  return rpc('shopping_command_context', [ticket.owner, ticket.sequence, ticket.operation, ticket.hash]);
}
async function commit(ticket: Awaited<ReturnType<typeof admit>>, c: ShoppingCommand, snapshot?: ShoppingCommandContext) {
  const current = snapshot ?? await context(ticket);
  if (current.status !== 'Pending') return current;
  const plan = planShoppingCommand(current, c);
  const action = ['complete', 'restoreContent', 'pantry', 'deleteRecipe'].includes(c.mutation.type) ? c.mutation.type : 'mutation';
  return rpc('shopping_commit', [ticket.owner, ticket.sequence, ticket.operation, ticket.hash,
    current.row?.content_revision ?? null, current.dependencyRevision, plan.document,
    plan.outcome, action, plan.pantryItem, c.mutation.type === 'deleteRecipe' ? c.mutation.recipeId : null]);
}
async function revision(id: string) {
  const [row] = await db`select content_revision from public.shopping_list where user_id = ${id}`;
  return Number(row?.content_revision ?? 0);
}

async function main() {
try {
  const [identity] = await db`select inet_server_port() as port, current_database() as database`;
  check(identity, { port: 5432, database: 'postgres' }, 'isolated container database identity');
  if (process.argv.includes('--apply')) {
    const [existing] = await db`select to_regclass('private.shopping_protocol') as relation`;
    assert.equal(existing.relation, null, 'refuse reapplying protocol over unknown state');
    const id = await owner();
    const representative = shoppingCompatibilityFixture().document;
    await db`update public.shopping_list set document = ${db.json(JSON.parse(JSON.stringify(representative)))}, content_revision = content_revision + 1 where user_id = ${id}`;
    const before = await db`select document, content_revision from public.shopping_list where user_id = ${id}`;
    const migrationConnection = await db.reserve();
    try { await migrationConnection.unsafe(readFileSync('../supabase/migrations/022_shopping_authoritative_commands.sql', 'utf8')); } finally { migrationConnection.release(); }
    check(await db`select document, content_revision from public.shopping_list where user_id = ${id}`, before,
      'migration preserves representative existing document');
  }
  const id = await owner();
  const rev = await revision(id);
  const c = command({ type: 'setExclusion', key: 'cumin', enabled: true }, rev);
  const ticket = await admit(id, c);
  const recovered = await admit(id, c, ticket.operation, true);
  check(recovered.sequence, ticket.sequence, 'lost admission response recovers original sequence');
  check(recovered.expiresAt, ticket.expiresAt, 'repeated admission does not extend expiry');
  check((await admit(id, command({ type: 'complete' }), ticket.operation, true)).status, 'PayloadMismatch', 'UUID payload binding');
  const snapshot = await context(ticket);
  // Both transactions have the same pre-commit snapshot. Owner lock determines
  // the winner; no sleeps or races dependent on machine timing.
  const concurrent = await Promise.all([commit(ticket, c, snapshot), commit(ticket, c, snapshot)]);
  check(concurrent.map((r) => r.status).sort(), ['AlreadyApplied', 'Applied'], 'concurrent same-ticket execution applies exactly once');
  check(await revision(id), rev + 1, 'one mutation revision');
  const second = command({ type: 'setExclusion', key: 'pepper', enabled: true }, rev + 1);
  await commit(await admit(id, second), second);
  const replay = await commit(ticket, c);
  check(replay.status, 'AlreadyApplied', 'lost execution response replay after later edit');
  check(replay.receipt.revision, rev + 1, 'receipt is historical, not current document');
  const noOp = command({ type: 'setExclusion', key: 'cumin', enabled: true }, await revision(id));
  const noOpTicket = await admit(id, noOp);
  check((await commit(noOpTicket, noOp)).status, 'Unchanged', 'no-op has a terminal receipt');
  check((await context(noOpTicket)).receipt.outcome, 'Unchanged', 'no-op replay');
  const stale = command({ type: 'updatePreferences', preferences: { excludeSaltVariants: true } }, 0);
  const staleTicket = await admit(id, stale);
  check((await commit(staleTicket, stale)).status, 'Conflict', 'stale intent terminal conflict');
  check((await context(staleTicket)).receipt.outcome, 'Conflict', 'conflict replay');
  const other = await owner();
  check((await context({ ...ticket, owner: other })).status, 'UnknownAdmission', 'cross-owner ticket hides results');
  for (const role of ['anon', 'authenticated']) {
    for (const sqlText of [
      `update public.shopping_list set document = document, content_revision = content_revision + 1 where user_id = '${id}'`,
      `select public.shopping_admit('${id}', '${randomUUID()}', '${hash(c)}', false)`,
      'select * from private.shopping_admissions',
      'select public.move_shopping_document_item_to_pantry(0, null, null, null, null)',
    ]) {
      await assert.rejects(db.begin(async (sql) => {
        await sql.unsafe(`set local role ${role}`);
        await sql`select set_config('request.jwt.claim.sub', ${id}, true)`;
        await sql.unsafe(sqlText);
      }), /permission denied/);
      checks++;
    }
  }
  console.log('PASS realistic application roles reject legacy/protocol/private writes');
  await db.begin(async (sql) => {
    await sql`set local role authenticated`;
    await sql`select set_config('request.jwt.claim.sub', ${other}, true)`;
    check((await sql`select * from public.shopping_list where user_id = ${id}`).length, 0, 'RLS hides another owner document');
  });
  await assert.rejects(db.begin(async (sql) => {
    await sql`set local role authenticated`;
    await sql`select public.delete_recipe(${randomUUID()})`;
  }), /Refresh the application/);
  checks++;
  const fixtures = [shoppingCompatibilityFixture().document, {}, null, { schemaVersion: 99 }];
  for (const fixture of fixtures) {
    const [validation] = await db`select private.is_shopping_command_document(${db.json(JSON.parse(JSON.stringify(fixture)))}, 3) as valid`;
    check(validation.valid, validateShoppingDocumentV3(fixture).ok, 'TS/SQL V3 structural parity');
  }
  for (const fixture of [legacyIndependentFixture, { ...legacyIndependentFixture, quantity: null },
    { ...legacyIndependentFixture, previousChecked: 'yes' }, { ...legacyIndependentFixture, sourceHistory: {} }]) {
    const [validation] = await db`select private.is_shopping_legacy_envelope(${db.json(JSON.parse(JSON.stringify(fixture)))}) as valid`;
    check(validation.valid, isLegacyIndependentNeed(fixture), 'TS/SQL preserved legacy envelope parity');
  }
  const sourceOwner = await owner();
  const [sourceRow] = await db`select * from public.recipes where user_id = ${sourceOwner} limit 1`;
  const source = mapRecipeRows([sourceRow] as never)[0];
  const sourceCommand = command({ type: 'upsertRecipe', entry: createShoppingRecipeEntry(source, source.servings, { numerator: '1', denominator: '1' }) }, await revision(sourceOwner));
  const sourceTicket = await admit(sourceOwner, sourceCommand);
  const sourceSnapshot = await context(sourceTicket);
  await db`update public.recipes set name = name || ' edited' where recipe_uuid = ${source.id}`;
  check((await commit(sourceTicket, sourceCommand, sourceSnapshot)).status, 'Replan', 'source mutation invalidates stale dependency snapshot');
  check((await commit(sourceTicket, sourceCommand)).status, 'Conflict', 'changed source evidence cannot be committed');
  const deletedCommand = command({ type: 'deleteRecipe', recipeId: source.id });
  const deleteTicket = await admit(sourceOwner, deletedCommand);
  check((await commit(deleteTicket, deletedCommand)).status, 'Applied', 'recipe deletion uses atomic receipt boundary');
  check((await db`select * from public.recipes where recipe_uuid = ${source.id}`).length, 0, 'recipe deleted');
  check((await context(deleteTicket)).status, 'AlreadyApplied', 'recipe deletion retry returns history');
  const capacityOwner = await owner();
  for (let i = 0; i < 255; i++) await admit(capacityOwner, c);
  const capacity = await Promise.all([admit(capacityOwner, c), admit(capacityOwner, c)]);
  check(capacity.map((r) => r.status).sort(), ['Admitted', 'RetryCapacity'], 'concurrent admissions at capacity');
  const [count] = await db`select count(*)::integer as count from private.shopping_admissions where user_id = ${capacityOwner}`;
  check(count.count, 256, 'unexpired capacity never exceeds 256');
  // Test-only administrator time control: no time parameter or production RPC.
  await db`update private.shopping_admissions set expires_at = clock_timestamp() - interval '1 second' where user_id = ${id}`;
  check((await context(ticket)).status, 'RetryExpired', 'expired tickets cannot execute');
  check((await admit(id, c, ticket.operation, true)).status, 'OutcomeUnknown', 'lost admission outside window is unknown');
  const [floor] = await db`select admission_floor, next_sequence from private.shopping_protocol where user_id = ${id}`;
  check(floor.admission_floor, floor.next_sequence, 'cleanup advances persistent admission floor');
  check((await context({ ...ticket, sequence: '99999999' })).status, 'UnknownAdmission', 'unissued sequence cannot execute');
  // Real rollback: fail after the document UPDATE, at the receipt UPDATE.
  await db.unsafe(`create function private.fail_slice6_receipt() returns trigger language plpgsql as $$
    begin if new.receipt is not null then raise exception 'injected receipt failure'; end if; return new; end $$;
    create trigger slice6_fail_receipt before update on private.shopping_admissions
    for each row execute function private.fail_slice6_receipt();`);
  const failureCommand = command({ type: 'setExclusion', key: 'failure', enabled: true }, await revision(other));
  const failureTicket = await admit(other, failureCommand);
  const beforeFailure = await revision(other);
  await assert.rejects(commit(failureTicket, failureCommand), /injected receipt failure/);
  check(await revision(other), beforeFailure, 'receipt failure rolls back state mutation');
  check((await context(failureTicket)).status, 'Pending', 'receipt failure leaves only Pending admission');
  await db.unsafe('drop trigger slice6_fail_receipt on private.shopping_admissions; drop function private.fail_slice6_receipt()');
  const bridgeOwner = await owner();
  const bridgeItem = { id: randomUUID(), displayName: 'milk', quantity: null, categoryKey: 'dairy', bucket: 'items', checked: false };
  const addBridge = command({ type: 'addManualItem', item: bridgeItem as never }, await revision(bridgeOwner));
  await commit(await admit(bridgeOwner, addBridge), addBridge);
  const bridge = command({ type: 'pantry', rowRef: `manual:${bridgeItem.id}` }, await revision(bridgeOwner));
  const bridgeTicket = await admit(bridgeOwner, bridge);
  const bridgeSnapshot = await context(bridgeTicket);
  await db`insert into public.pantry_items(user_id, item) values(${bridgeOwner}, 'rice')`;
  check((await commit(bridgeTicket, bridge, bridgeSnapshot)).status, 'Replan', 'Pantry mutation invalidates stale dependency snapshot');
  const bridgeResult = await commit(bridgeTicket, bridge);
  check(bridgeResult.status, 'Applied', 'bridge commits receipt and Shopping transition');
  check((await db`select * from public.pantry_items where user_id = ${bridgeOwner} and item = 'milk'`).length, 1, 'bridge commits Pantry availability');
  const clear = command({ type: 'complete' }, await revision(bridgeOwner));
  const clearTicket = await admit(bridgeOwner, clear);
  const beforeClear = await context(clearTicket);
  const clearResult = await commit(clearTicket, clear);
  check(clearResult.receipt.undoAvailable, true, 'manual Clear stores bounded inverse outside receipt');
  const undo = command({ type: 'restoreContent', content: {
    recipeEntries: beforeClear.row.document.recipeEntries, manualItems: beforeClear.row.document.manualItems,
    itemOverrides: beforeClear.row.document.itemOverrides,
  } }, await revision(bridgeOwner));
  check((await commit(await admit(bridgeOwner, undo), undo)).status, 'Applied', 'manual-only conditional Undo');
  check((await commit(await admit(bridgeOwner, undo), undo)).status, 'UndoUnavailable', 'a new operation cannot reuse consumed Undo');
  // Invalid pre-existing document fixture, isolated stack only. Re-add the
  // original constraint NOT VALID so all subsequent writes remain checked.
  const invalidOwner = await owner();
  const [validRow] = await db`select document from public.shopping_list where user_id = ${invalidOwner}`;
  const slice7 = process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1';
  await db.unsafe(slice7 ? 'alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check' : 'alter table public.shopping_list drop constraint shopping_list_document_v3_compatibility_check');
  await db`update public.shopping_list set document = ${db.json({ schemaVersion: 99, evidence: 'preserved' })}, content_revision = content_revision + 1 where user_id = ${invalidOwner}`;
  await db.unsafe(slice7 ? 'alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)) not valid' : 'alter table public.shopping_list add constraint shopping_list_document_v3_compatibility_check check (public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document)) not valid');
  const invalidCommand = command({ type: 'complete' }, await revision(invalidOwner));
  check((await commit(await admit(invalidOwner, invalidCommand), invalidCommand)).status, 'UnsupportedDocument', 'unsupported persisted document gets terminal refusal');
  const [preserved] = await db`select document from public.shopping_list where user_id = ${invalidOwner}`;
  check(preserved.document, { schemaVersion: 99, evidence: 'preserved' }, 'unsupported document never becomes empty');
  await db`update public.shopping_list set document = ${db.json(validRow.document)}, content_revision = content_revision + 1 where user_id = ${invalidOwner}`;
  await db.unsafe(slice7 ? 'alter table public.shopping_list validate constraint shopping_list_document_v4_compatibility_check' : 'alter table public.shopping_list validate constraint shopping_list_document_v3_compatibility_check');
  // Concurrent initialization: remove only this disposable owner document.
  const absent = await owner();
  await db`delete from public.shopping_list where user_id = ${absent}`;
  const ca = { ...command({ type: 'setExclusion', key: 'a', enabled: true }), observedSetting: false };
  const cb = { ...command({ type: 'setExclusion', key: 'b', enabled: true }), observedSetting: false };
  const ta = await admit(absent, ca), tb = await admit(absent, cb);
  const sa = await context(ta), sb = await context(tb);
  const initial = await Promise.all([commit(ta, ca, sa), commit(tb, cb, sb)]);
  for (const [index, r] of initial.entries()) if (r.status === 'Replan') await commit(index ? tb : ta, index ? cb : ca);
  const [created] = await db`select document from public.shopping_list where user_id = ${absent}`;
  check(created.document.preferences.excludedIngredientKeys.sort(), ['a', 'b'], 'concurrent independent initialization preserves both');
  console.log(`PASS ${checks} database assertions`);
} finally {
  for (const id of owners) await db`delete from auth.users where id = ${id}`;
  await db.end();
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
