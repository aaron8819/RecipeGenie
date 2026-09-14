import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { projectShoppingDocument } from '../src/lib/shopping-document';
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

// Actual 21c73d8 initializer output, generated during the pre-edit reproduction.
const fixture = JSON.parse(readFileSync('src/test/fixtures/shopping-defective-v4.json', 'utf8'));
const projection = (row: any) => projectShoppingDocument(row.document).items.map(r => r.categoryKey);
const initialize = { type: 'initialize' } as const;
const move = (category: string): ShoppingCommand['mutation'] => ({ type: 'updateCategoryPreferences', preferences: { categoryByIngredient: { lemon: category } } });
const resolve = { type: 'resolvePlacement', purchaseKey: 'lemon', categoryKey: 'dairy', anchor: null } as const;
const evidence: unknown[] = [];

// Rehearse the old server: normal authenticated admission, actual service-only
// commit of the OLD initializer's output. This creates a genuine bound receipt,
// not an invented audit row. Current server/planner executes all later commands.
async function oldInitialization(a: Owner, doc = fixture.originalV4) {
  await db`update public.shopping_list set document=${json(fixture.legacy)},content_revision=content_revision+1 where user_id=${a.id}`;
  const c = command(initialize, await rev(a)), ticket = await admitted(a, c);
  const args = { p_owner: a.id, p_sequence: ticket.sequence, p_operation: ticket.operationId,
    p_hash: createHash('sha256').update(canonicalShoppingPayload(c)).digest('hex') };
  const ctx = await admin.rpc('shopping_command_context', args); assert.equal(ctx.error, null);
  const snapshot = ctx.data as ShoppingCommandContext;
  const commit = await admin.rpc('shopping_commit', { ...args, p_revision: snapshot.row!.content_revision,
    p_dependency: snapshot.dependencyRevision, p_document: doc, p_outcome: 'Applied', p_action: 'mutation' });
  assert.equal(commit.error, null); check(commit.data.status, 'Applied', 'actual old V4 output committed with hash-bound receipt');
  return ticket;
}
async function proof(a: Owner) {
  const c = command(initialize, await rev(a)), ticket = await admitted(a, c);
  const r = await admin.rpc('shopping_command_context', { p_owner: a.id, p_sequence: ticket.sequence, p_operation: ticket.operationId,
    p_hash: createHash('sha256').update(canonicalShoppingPayload(c)).digest('hex') });
  assert.equal(r.error, null); return r.data.lastWriteWasInitialization;
}
async function main() {
  let complete = false;
  try {
    // Apply/reapply is read-only with respect to documents and revisions.
    const exact = await owner();
    await db`update public.shopping_list set document=${json(fixture.originalV4)},content_revision=1 where user_id=${exact.id}`;
    const preMigration = await read(exact);
    const migrationConnection = await db.reserve();
    try { await migrationConnection.unsafe(readFileSync('../supabase/migrations/025_shopping_placement_recovery.sql', 'utf8')); }
    finally { migrationConnection.release(); }
    check(await read(exact), preMigration, 'migration leaves affected preimage and revision unchanged');
    check(projection(preMigration), ['produce'], 'exact original PostgreSQL defect present before explicit upgrade');
    check(await proof(exact), false, 'direct persisted review fixture has no initialization proof');
    await apply(exact, initialize);
    const ambiguous = await read(exact);
    check(ambiguous.document.placementEvidence.unresolved.lemon.categories, ['produce', 'dairy'], 'exact fixture exposes both histories');
    await apply(exact, resolve);
    check(projection(await read(exact)), ['dairy'], 'previously failing PostgreSQL assertion passes after explicit resolution');

    const a = await owner(), oldTicket = await oldInitialization(a);
    check(await proof(a), true, 'SQL proves actual latest initialization revision');
    const before = await read(a);
    const staleMove = await admitted(a, command(move('frozen'), await rev(a)));
    const recovered = await apply(a, initialize);
    const after = await read(a);
    check(projection(after), ['dairy'], 'proven old initialization recovers automatically');
    check(after.document.recipeEntries, before.document.recipeEntries, 'frozen snapshots quantities and selection identities preserved');
    check(after.document.manualItems, before.document.manualItems, 'manual intent preserved');
    check(after.document.itemOverrides, before.document.itemOverrides, 'completion/bucket overrides preserved');
    const strip = (d: any) => { const { categoryByIngredient, ingredientOrderByCategory, ...settings } = d.preferences; return settings; };
    check(strip(after.document), strip(before.document), 'unrelated settings preserved');
    check((await http(a, staleMove)).status, 'Conflict', 'stale organization command cannot overwrite repair');
    check((await http(a, oldTicket)).status, 'AlreadyApplied', 'old initialization receipt returns history');
    check(await read(a), after, 'historical receipt cannot resurrect defective placement');
    check((await send(a, command(initialize, await rev(a)))).result.status, 'Unchanged', 'repeat recovery harmless');
    await apply(a, move('frozen'));
    const moved = await read(a);
    check((await http(a, recovered.body)).status, 'AlreadyApplied', 'lost recovery response retries by receipt');
    check((await send(a, command(initialize, await rev(a)))).result.status, 'Unchanged', 'recovery after later user move harmless');
    check(await read(a), moved, 'later move persists after all replay paths');

    for (const mode of ['category', 'reorder', 'between', 'reset', 'partial', 'conflicting', 'hidden', 'missing', 'fresh']) {
      const ownerA = await owner();
      const doc = structuredClone(fixture.originalV4);
      const entry: any = Object.values(doc.recipeEntries)[0];
      if (mode === 'partial') delete entry.sourceEvidence.originalEntry;
      if (mode === 'conflicting') entry.sourceEvidence.originalEntry.ingredients[0].defaultCategoryKey = 'frozen';
      if (mode === 'missing') {
        entry.ingredients[0].defaultCategoryKey = 'produce'; delete entry.sourceEvidence.originalEntry;
        entry.sourceEvidence.occurrences[0].raw = entry.ingredients[0];
      }
      if (mode === 'hidden') doc.itemOverrides[entry.ingredients[0].aggregateKey] = { suppressed: true, checked: true };
      if (mode === 'reorder' || mode === 'between') {
        const target = mode === 'reorder' ? 'produce' : 'dairy';
        doc.placementEvidence.defaults.anchor = { categoryKey: target, policyVersion: 'test' };
        (doc.preferences.ingredientOrderByCategory[target] ??= []).push('anchor');
      }
      if (mode === 'fresh') {
        await db`update public.shopping_list set document=${json(fixture.legacy)},content_revision=content_revision+1 where user_id=${ownerA.id}`;
        await apply(ownerA, initialize);
      } else await oldInitialization(ownerA, doc);
      if (mode === 'category' || mode === 'reset') await apply(ownerA, move('frozen'));
      if (mode === 'reset') await apply(ownerA, { type: 'updateCategoryPreferences', preferences: { categoryByIngredient: {} } });
      if (mode === 'reorder' || mode === 'between') await apply(ownerA, { type: 'learnOrder', draggedRowRef: 'derived:lemon', draggedOrderingKey: 'lemon',
        sourceCategoryKey: 'produce', targetRowRef: 'derived:anchor', targetOrderingKey: 'anchor', targetCategoryKey: mode === 'reorder' ? 'produce' : 'dairy', placement: 'after' });
      const pre = await read(ownerA);
      const outcome = (await send(ownerA, command(initialize, await rev(ownerA)))).result;
      const post = await read(ownerA);
      if (['category', 'reorder', 'between', 'missing', 'fresh'].includes(mode)) {
        check(outcome.status, 'Unchanged', mode + ' is not eligible'); check(post, pre, mode + ' entire document preserved');
      } else if (mode === 'hidden') {
        check(outcome.status, 'Applied', 'hidden recoverable purchase corrected');
        check(post.document.itemOverrides, pre.document.itemOverrides, 'hidden and checked state unchanged');
        check(post.document.preferences.ingredientOrderByCategory.dairy, ['lemon'], 'hidden purchase remembers Dairy');
        const hiddenKey = projectShoppingDocument(post.document).rows[0].rowRef.slice(8);
        await apply(ownerA, { type: 'setSuppressed', aggregateKey: hiddenKey, suppressed: false });
        check(projection(await read(ownerA)), ['dairy'], 'returning hidden purchase renders in Dairy');
      } else {
        check(outcome.status, 'Applied', mode + ' becomes unresolved');
        check(Boolean(post.document.placementEvidence.unresolved.lemon), true, mode + ' cannot be marked repaired');
      }
      evidence.push({ mode, before: pre, after: post });
    }

    // Both transaction orders: recovery prepared first and organization first.
    for (const recoveryFirst of [true, false]) {
      const c = await owner(); await oldInitialization(c);
      const pending = await prepared(c, command(recoveryFirst ? initialize : move('frozen'), await rev(c)));
      await apply(c, recoveryFirst ? move('frozen') : initialize);
      const winner = await read(c);
      check((await pending.commit()).status, 'Replan', 'competing commit rejects stale prepared document');
      check((await http(c, pending.ticket)).status, 'Conflict', 'replanned command retains its observed revision');
      check(await read(c), winner, 'concurrent winner preserved');
    }
    complete = true;
  } finally {
    for (const id of owners) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
    await db.end();
    const { writeFileSync } = await import('node:fs');
    writeFileSync('../.codex-artifacts/review/recovery-database-results.json', JSON.stringify({ checks, complete, evidence }, null, 2));
    console.log(JSON.stringify({ passed: checks, failed: complete ? 0 : 1, complete }));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
