import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { createEmptyShoppingDocument, validateShoppingDocumentV3 } from '../src/lib/shopping-document';
import { initializeShoppingDocument, readInitializedDocument } from '../src/lib/shopping-initialization';

async function main() {
  const env = parse(readFileSync('.env.local'));
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:57321');
  const db = postgres({ host: '127.0.0.1', port: 57322, database: 'postgres', user: 'postgres', password: 'postgres', max: 1, onnotice: () => {} });
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const user = await admin.auth.admin.createUser({ email: `${randomUUID()}@example.test`, password: randomUUID(), email_confirm: true });
  assert.equal(user.error, null); const id = user.data.user!.id;
  try {
    const old = createEmptyShoppingDocument();
    old.manualItems.push({ id: 'manual', displayName: 'lemon', quantity: null, bucket: 'items', categoryKey: 'produce', checked: false });
    const document = initializeShoppingDocument(old, []);
    await db`update public.shopping_list set document=${db.json(document as never)}, content_revision=content_revision+1 where user_id=${id}`;
    const before = await db`select * from public.shopping_list where user_id=${id}`;
    await db.unsafe(readFileSync('../supabase/migrations/029_shopping_manual_field_versions.sql', 'utf8'));
    assert.deepEqual(await db`select * from public.shopping_list where user_id=${id}`, before);
    console.log('PASS populated upgrade preserves document and all row metadata');
    let checks = 0;
    for (const versions of [undefined, { displayName: 0, quantity: 1, guard: 2 }, {}, null,
      { displayName: 0, quantity: -1, guard: 0 }, { displayName: 0, quantity: 0.5, guard: 0 },
      { displayName: 0, quantity: 0, guard: 0, extra: 0 }, { displayName: 0, quantity: Number.MAX_SAFE_INTEGER + 1, guard: 0 }]) {
      const candidate = structuredClone(document);
      if (versions !== undefined) Object.assign(candidate.manualItems[0].identity!, { fieldVersions: versions });
      const expected = versions === undefined || (versions !== null && 'quantity' in versions && versions.quantity === 1);
      assert.equal(Boolean(readInitializedDocument(candidate, validateShoppingDocumentV3)), expected);
      const [row] = await db`select public.is_shopping_document_v4(${db.json(candidate as never)}) as valid`;
      assert.equal(row.valid, expected); checks++;
    }
    console.log(`PASS ${checks} shared TypeScript/SQL validator cases`);
  } finally { assert.equal((await admin.auth.admin.deleteUser(id)).error, null); await db.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
