import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { createEmptyShoppingDocument, type ShoppingDocumentV3 } from '../src/lib/shopping-document';
import { canUndoShoppingClear, shoppingContent, shoppingInverseBytes, SHOPPING_INVERSE_BYTES } from '../src/lib/shopping-clear';
import { readShoppingCommand, type ShoppingCommand } from '../src/lib/shopping-command';

// Disposable correction project only: no ambient production or shared URL.
const env = parse(readFileSync('.env.local'));
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, (process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:57321' : 'http://127.0.0.1:56321'));
const db = postgres({ host: '127.0.0.1', port: process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 57322 : 56322, database: 'postgres',
  user: 'postgres', password: 'postgres', max: 4, onnotice: () => {} });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
const owners: string[] = [];
let checks = 0;
function check(actual: unknown, expected: unknown, label: string) {
  assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`);
}
async function owner() {
  const email = `${randomUUID()}@example.test`, password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.equal(error, null); const id = data.user!.id; owners.push(id);
  const jar = new Map<string, string>();
  const auth = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const login = await auth.auth.signInWithPassword({ email, password });
  assert.equal(login.error, null);
  return { id, token: login.data.session!.access_token, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
}
type Owner = Awaited<ReturnType<typeof owner>>;
const read = async (id: string) => (await db`select document,content_revision from public.shopping_list where user_id=${id}`)[0];
const revision = async (id: string) => Number((await read(id)).content_revision);
const command = (mutation: ShoppingCommand['mutation'], observedRevision: number, clearUndoRequired?: boolean): ShoppingCommand =>
  ({ protocol: 1, observedRevision, mutation, ...(clearUndoRequired === undefined ? {} : { clearUndoRequired }) });
async function http(a: Owner, body: unknown) {
  const response = await fetch((process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:3117/api/shopping' : 'http://127.0.0.1:3116/api/shopping'), {
    method: 'POST', headers: { Origin: (process.env.RECIPE_GENIE_SLICE7_REHEARSAL === '1' ? 'http://127.0.0.1:3117' : 'http://127.0.0.1:3116'), Cookie: a.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}
async function send(a: Owner, c: ShoppingCommand) {
  const operationId = randomUUID();
  const admitted = await http(a, { phase: 'admit', operationId, command: c });
  assert.equal(admitted.status, 'Admitted');
  const body = { phase: 'execute', operationId, command: c, sequence: admitted.sequence };
  return { result: await http(a, body), body };
}
async function seed(a: Owner, document: ShoppingDocumentV3) {
  await db`update public.shopping_list set document=${db.json(JSON.parse(JSON.stringify(document)))},content_revision=content_revision+1 where user_id=${a.id}`;
}
const manualDocument = (count: number): ShoppingDocumentV3 => ({ ...createEmptyShoppingDocument(),
  manualItems: Array.from({ length: count }, (_, i) => ({ id: `manual-${i}`, displayName: `Item ${i}`,
    quantity: null, categoryKey: 'misc', bucket: 'items' as const, checked: false })) });

async function main() {
  try {
    check((await db`select inet_server_port() port,current_database() database`)[0],
      { port: 5432, database: 'postgres' }, 'disposable database identity');
    const a = await owner();
    await seed(a, manualDocument(2));
    if (process.argv.includes('--apply')) {
      assert.equal((await db`select has_table_privilege('anon','public.recipes','TRUNCATE') allowed`)[0].allowed, true);
      const before = await read(a.id);
      const connection = await db.reserve();
      try { await connection.unsafe(readFileSync('../supabase/migrations/023_shopping_slice6_corrections.sql', 'utf8')); }
      finally { connection.release(); }
      check(await read(a.id), before, 'F1 original Slice 6 upgrade preserves complete document/revision');
    }
    const catalog = await db`select rolname, has_table_privilege(oid,'public.recipes','TRUNCATE') truncate,
      has_table_privilege(oid,'public.recipes','SELECT') select,
      has_table_privilege(oid,'public.recipes','INSERT') insert,
      has_table_privilege(oid,'public.recipes','UPDATE') update
      from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname`;
    console.log(JSON.stringify({ F1: { effective: catalog,
      directAndPublic: await db`select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end grantee,
        a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid='public.recipes'::regclass`,
      inheritedRoles: await db`select r.rolname application_role, parent.rolname inherited_role
        from pg_roles r cross join pg_roles parent where r.rolname in ('anon','authenticated','service_role')
        and r.oid<>parent.oid and pg_has_role(r.oid,parent.oid,'USAGE')` } }));
    check(catalog.every((r) => !r.truncate && r.select && r.insert && r.update), true, 'F1 effective fence preserves supported recipe grants');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const suffix of ['', ' cascade']) {
        const before = await read(a.id);
        const recipes = await db`select recipe_uuid from public.recipes order by recipe_uuid`;
        await assert.rejects(db.begin(async (sql) => {
          await sql.unsafe(`set local role ${role}`);
          await sql`select set_config('request.jwt.claim.sub',${a.id},true)`;
          await sql.unsafe(`truncate public.recipes${suffix}`);
        }), (error: unknown) => (error as { code: string }).code === '42501');
        checks++; console.log(`PASS F1 ${role} TRUNCATE${suffix} denied 42501`);
        check(await read(a.id), before, 'F1 Shopping unchanged after denied statement');
        check(await db`select recipe_uuid from public.recipes order by recipe_uuid`, recipes, 'F1 recipes unchanged after denied statement');
      }
    }
    // SQL serialization parity, including exponent expansion, UTF-8 and escapes.
    for (const value of [{ a: [1e-7, 1e21, -1e-20, 1.25, null, true], b: 'é🥕"\\\n' }, shoppingContent(manualDocument(6000))]) {
      check(shoppingInverseBytes(value), (await db`select octet_length(${db.json(JSON.parse(JSON.stringify(value)))}::jsonb::text)::int bytes`)[0].bytes,
        'F3 exact PostgreSQL/TypeScript UTF-8 inverse byte parity');
    }
    for (const count of [1, 5100, 6000]) {
      const document = manualDocument(count); await seed(a, document);
      const cleared = await send(a, command({ type: 'complete' }, await revision(a.id), true));
      check(cleared.result.receipt.undoAvailable, true, `F3 ${count} items Clear advertises Undo`);
      const undo = command({ type: 'undoClear' }, cleared.result.receipt.revision);
      const envelope = { phase: 'execute', operationId: randomUUID(), sequence: '9'.repeat(18), command: undo };
      check(Buffer.byteLength(JSON.stringify(envelope)) < 256 && !!readShoppingCommand(undo), true, 'F3 compact envelope includes sequence/UUID overhead');
      if (count === 6000) {
        console.log(JSON.stringify({ F3: { items: count, inverseBytes: shoppingInverseBytes(shoppingContent(document)),
          compactEnvelopeBytes: Buffer.byteLength(JSON.stringify(envelope)) } }));
        check(readShoppingCommand(command({ type: 'restoreContent', content: shoppingContent(document) }, undo.observedRevision)), null,
          'F3 original 40000-node reproduction remains bounded; supported transport sends a reference');
      }
      const restored = await send(a, undo);
      check(restored.result.status, 'Applied', 'F3 actual HTTP Undo executes');
      check((await read(a.id)).document, document, 'F3 exact persisted preimage restored');
      check((await http(a, restored.body)).status, 'AlreadyApplied', 'F3 Undo receipt replay');
      check((await http(a, cleared.body)).receipt.undoAvailable, true, 'F3 Clear receipt retains historical outcome');
      check((await read(a.id)).document, document, 'F3 historical Clear cannot clear restored content');
    }
    // Exact storage boundary, beyond the old per-string command bound. The
    // multibyte/escaped prefix makes JS character-count checks insufficient.
    for (const delta of [-1, 0, 1]) {
      const document = manualDocument(1);
      document.manualItems[0].displayName = '🥕é"\\\n';
      const padding = SHOPPING_INVERSE_BYTES + delta - shoppingInverseBytes(shoppingContent(document));
      document.manualItems[0].displayName += 'x'.repeat(padding);
      check(shoppingInverseBytes(shoppingContent(document)), SHOPPING_INVERSE_BYTES + delta, 'F3 exact storage-bound fixture');
      check(canUndoShoppingClear(document), delta <= 0, 'F3 preview eligibility matches storage boundary');
      await seed(a, document); const before = await read(a.id);
      const cleared = await send(a, command({ type: 'complete' }, await revision(a.id), true));
      if (delta > 0) {
        check(cleared.result.status, 'Conflict', 'F3 oversized promised Undo refuses Clear');
        check(await read(a.id), before, 'F3 refused Clear preserves oversized data');
        const confirmed = await send(a, command({ type: 'complete' }, await revision(a.id), false));
        check(confirmed.result.receipt.undoAvailable, false, 'F3 explicit non-undoable confirmation has no advertised Undo');
      } else {
        check(cleared.result.receipt.undoAvailable, true, 'F3 boundary Clear offers valid Undo');
        check((await send(a, command({ type: 'undoClear' }, await revision(a.id)))).result.status, 'Applied', 'F3 boundary compact Undo passes HTTP validators');
        check((await read(a.id)).document, document, 'F3 boundary persistence restored');
      }
    }
    await seed(a, manualDocument(2));
    const confirmedRevision = await revision(a.id);
    await send(a, command({ type: 'setExclusion', key: 'later', enabled: true }, confirmedRevision));
    const changed = await read(a.id);
    const stale = await send(a, command({ type: 'complete' }, confirmedRevision, true));
    check(stale.result.status, 'Conflict', 'F3 concurrent confirmation change requires another confirmation');
    check(await read(a.id), changed, 'F3 concurrent change remains intact');
    check((await http(a, stale.body)).receipt.outcome, 'Conflict', 'F3 refused Clear receipt retry stays refused');
    const clear = await send(a, command({ type: 'complete' }, await revision(a.id), true));
    await send(a, command({ type: 'setExclusion', key: 'after-clear', enabled: true }, await revision(a.id)));
    const later = await read(a.id);
    check((await send(a, command({ type: 'undoClear' }, clear.result.receipt.revision))).result.status, 'Conflict', 'F3 old-revision Undo refuses later write');
    check((await send(a, command({ type: 'undoClear' }, await revision(a.id)))).result.status, 'UndoUnavailable', 'F3 current revision cannot repoint the old inverse');
    check(await read(a.id), later, 'F3 later writes survive both refused Undos');
    // Numeric scale survives in JSONB but not JSON.parse. The database
    // computed field, not an estimate from JS numbers, owns eligibility.
    const scaled = manualDocument(1);
    scaled.manualItems[0].quantity = { amount: 1, unit: 'cup' };
    scaled.manualItems[0].displayName += 'x'.repeat(SHOPPING_INVERSE_BYTES - shoppingInverseBytes(shoppingContent(scaled)));
    await seed(a, scaled);
    await db`update public.shopping_list set document=jsonb_set(document,'{manualItems,0,quantity,amount}','1.00'::jsonb),
      content_revision=content_revision+1 where user_id=${a.id}`;
    const capability = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/shopping_list?select=shopping_clear_undo_available&user_id=eq.${a.id}`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${a.token}` },
    });
    check(capability.status, 200, 'F3 authenticated computed capability is readable');
    check(await capability.json(), [{ shopping_clear_undo_available: false }], 'F3 numeric scale over boundary is disclosed before Clear');
    const scaledBefore = await read(a.id);
    check((await send(a, command({ type: 'complete' }, await revision(a.id), true))).result.status, 'Conflict',
      'F3 actual preimage rejects an underestimated client promise');
    check(await read(a.id), scaledBefore, 'F3 numeric-scale refusal leaves data intact');
    for (const delta of [-1, 0, 1]) {
      const document = manualDocument(1);
      document.preferences.categoryOrder = [''];
      document.preferences.categoryOrder[0] = 'x'.repeat(4194304 + delta - shoppingInverseBytes(document));
      await seed(a, document);
      const before = await read(a.id);
      const cleared = await send(a, command({ type: 'complete' }, await revision(a.id), delta <= 0));
      check(cleared.result.status, 'Applied', 'F3 large-preferences Clear is within resulting-document limit');
      check(cleared.result.receipt.undoAvailable, delta <= 0, 'F3 Undo eligibility includes the full restored 4 MiB document bound');
      if (delta <= 0) {
        check((await send(a, command({ type: 'undoClear' }, await revision(a.id)))).result.status, 'Applied',
          'F3 full-document boundary Undo executes');
        check((await read(a.id)).document, before.document, 'F3 full-document boundary persistence');
      }
    }
    const b = await owner();
    check((await send(b, command({ type: 'undoClear' }, await revision(b.id)))).result.status, 'UndoUnavailable', 'F3 inverse remains owner bound');
    console.log(JSON.stringify({ checks, passed: checks, failed: 0, skipped: 0, mode: process.argv.includes('--apply') ? 'upgrade-022' : 'fresh-023' }));
  } finally {
    for (const id of owners) await db`delete from auth.users where id=${id}`;
    await db.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
