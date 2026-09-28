import { inspectOrganization, moveInverse, organizationInverse, type OrganizationAction } from '../src/lib/shopping-organization';
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
    const a = await owner(), b = await owner();
    await apply(a, { type: 'initialize' }); await apply(b, { type: 'initialize' });
    for (const key of ['apple', 'banana', 'carrot', 'lemon']) await apply(a, extra(randomUUID(), key));
    const organize = async (action: OrganizationAction) => apply(a, inspectOrganization((await read(a)).document, action));
    const inspected = async (action: OrganizationAction) => { const row = await read(a); return command(inspectOrganization(row.document, action), Number(row.content_revision)); };
    const move = (key: string, categoryKey = 'dairy', at: 'start' | 'end' = 'end'): OrganizationAction => ({ kind: 'move', key, destination: { categoryKey, at } });
    const recipe = await insertRecipe(a); await apply(a, { type: 'upsertRecipe', entry: createShoppingRecipeEntry(recipe, 4, { numerator: '1', denominator: '1' }) });
    const before = await read(a);
    const lemonRow = projectShoppingDocument(before.document, []).items.find(r => r.orderingKey === 'lemon')!;
    await send(a, { ...command({ type: 'setChecked', rowRef: lemonRow.rowRef, checked: true }, Number(before.content_revision)), inspectedCoverage: { lemon: { version: 0, basis: shoppingRowCoverage(lemonRow) } } });
    const evidence = (await read(a)).document;
    await organize(move('lemon'));
    let row = await read(a);
    check(projectShoppingDocument(row.document, []).items.find(r => r.orderingKey === 'lemon')?.categoryKey, 'dairy', 'S52/S56 recipe and extra share location');
    check(row.document.acknowledgements, evidence.acknowledgements, 'move preserves completion evidence');
    check(projectShoppingDocument(row.document, []).items.find(r => r.orderingKey === 'lemon')?.checked, true, 'S80 move retains coverage');
    check(row.document.recipeEntries, evidence.recipeEntries, 'move preserves frozen sources');
    // Prepared-plan barrier forces actual SQL CAS replan after the other key commits.
    const pending = await prepared(a, await inspected(move('apple')));
    const independent = await inspected(move('banana'));
    check((await send(a, independent)).result.status, 'Applied', 'S65 independent move wins first');
    check((await pending.commit()).status, 'Replan', 'S65 held production plan loses CAS');
    check((await http(a, pending.ticket)).status, 'Applied', 'S65 same admitted move rebases');
    check((await read(a)).document.preferences.ingredientOrderByCategory.dairy, ['lemon','banana','apple'], 'both moves persisted in commit order');
    check((await http(a, pending.ticket)).status, 'AlreadyApplied', 'duplicate move replays receipt');
    check(Number((await db`select count(*) from private.shopping_admissions where user_id=${a.id} and operation_id=${pending.ticket.operationId} and receipt is not null`)[0].count), 1, 'one persisted receipt');
    const same = await inspected(move('apple', 'frozen'));
    await organize(move('apple', 'misc'));
    const conflict = await send(a, same);
    check(conflict.result.status, 'Conflict', 'S64 stale same-key move rejected');
    const persistedConflict = await read(a);
    check((await http(a, conflict.body)).receipt.outcome, 'Conflict', 'terminal conflict receipt replay');
    check(await read(a), persistedConflict, 'replay does not change persisted state');
    check((await http(b, pending.ticket)).status, 'UnknownAdmission', 'owner cannot execute foreign ticket');
    const anchorState = await read(a);
    const anchored = command(inspectOrganization(anchorState.document, { kind: 'move', key: 'carrot', destination: { categoryKey:'dairy',at:'before',anchor:'banana',anchorVersion:anchorState.document.organizationVersions['purchase:banana'] } }),Number(anchorState.content_revision));
    await organize(move('banana','frozen'));
    check((await send(a, anchored)).result.status,'Conflict','S66 moved anchor conflicts atomically');
    // Clear leaves versions/placements; old owner intent remains valid; content Undo preserves it.
    const dormantMove = await inspected(move('carrot','bakery','start'));
    const cleared = await apply(a,{type:'complete'});
    check((await send(a,dormantMove)).result.status,'Applied','S98 old-trip owner move applies dormant');
    const clearedRow = await read(a);
    check((await send(a,command({type:'undoClear'},cleared.result.receipt.revision))).result.status,'Applied','S103 organization-only Undo succeeds');
    row=await read(a); check(row.document.preferences,clearedRow.document.preferences,'Undo preserves dormant movement');
    check(row.document.recipeEntries,evidence.recipeEntries,'Undo restores same source snapshot');
    // Relative move inverse: later different-key edits survive; same key refuses.
    const inverseBase=await read(a); const inverse=moveInverse(inverseBase.document,'lemon')!;
    await organize(move('lemon','produce'));
    const undoMove=await inspected(inverse);
    await organize(move('carrot','misc'));
    check((await send(a,undoMove)).result.status,'Applied','S67 relative inverse preserves other move');
    await organize(move('lemon','frozen'));
    check((await send(a,undoMove)).result.status,'Conflict','S67 inverse cannot overwrite newer move');
    await organize({kind:'createCategory',id:'market',name:'Market'});
    await organize(move('apple','custom_market')); await organize(move('banana','custom_market'));
    const labelMove=await inspected(move('carrot','custom_market'));
    await organize({kind:'renameCategory',key:'custom_market',name:'Farm stand'});
    check((await send(a,labelMove)).result.status,'Applied','S61 rename leaves destination identity valid');
    await apply(a,{type:'complete'});
    await organize({kind:'deleteCategory',key:'custom_market',fallback:'dairy'});
    row=await read(a);
    check(row.document.preferences.ingredientOrderByCategory.dairy,['apple','banana','carrot'],'S62 deletion transfers entire dormant sequence');
    check(row.document.preferences.ingredientOrderByCategory.custom_market,undefined,'deleted sequence removed');
    const pinned=structuredClone(row.document.placementEvidence.defaults);
    await organize({kind:'reset',keys:['apple'],mode:'position',bulk:false});
    check((await read(a)).document.preferences.ingredientOrderByCategory.dairy,['banana','carrot','apple'],'S94 position reset appends');
    await organize({kind:'reset',keys:['apple'],mode:'category',bulk:false});
    check((await read(a)).document.preferences.categoryByIngredient.apple,undefined,'S95 category reset removes shared override');
    await organize({kind:'reset',keys:Object.keys(pinned),mode:'both',bulk:true});
    row=await read(a); check(row.document.placementEvidence.defaults,pinned,'resets retain pinned records');
    check(row.document.preferences.ingredientOrderByCategory.produce,['apple','banana','carrot','lemon'],'S94 bulk reset sorts full scope');
    const staleReset=await inspected({kind:'reset',keys:Object.keys(pinned),mode:'position',bulk:true});
    await apply(a,extra(randomUUID(),'tomato'));
    check((await send(a,staleReset)).result.status,'Conflict','new appearance invalidates bulk scope');
    const resetBase=await read(a);
    const resetAction: OrganizationAction={kind:'reset',keys:Object.keys(resetBase.document.placementEvidence.defaults),mode:'both',bulk:true};
    const resetInverse=organizationInverse(resetBase.document,resetAction)!;
    await organize(resetAction); await organize(resetInverse);
    check((await read(a)).document.preferences.categoryByIngredient,resetBase.document.preferences.categoryByIngredient,'bulk reset Undo preserves overrides');
    await organize({kind:'createCategory',id:'undo',name:'Undo category'});
    await organize(move('apple','custom_undo'));
    const deletionBase=await read(a);
    const deletion: OrganizationAction={kind:'deleteCategory',key:'custom_undo',fallback:'dairy'};
    const restore=organizationInverse(deletionBase.document,deletion)!;
    await organize(deletion);const restoreCommand=await inspected(restore);
    check((await send(a,restoreCommand)).result.status,'Applied','category deletion inverse committed');
    check((await read(a)).document.preferences,deletionBase.document.preferences,'category deletion Undo restores only organization');
    check((await send(a,restoreCommand)).result.status,'Conflict','new duplicate inverse refuses');
    const settingsBase=await rev(a);
    const setting=(key:string,enabled:boolean,version=0):ShoppingCommand=>({protocol:1,observedRevision:settingsBase,observedSettingVersion:version,mutation:{type:'setExclusion',key,enabled}});
    check((await send(a,setting('cumin',true))).result.status,'Applied','versioned exclusion addition');
    check((await send(a,setting('pepper',true))).result.status,'Applied','disjoint stale exclusion addition');
    check((await send(a,setting('cumin',false,1))).result.status,'Applied','opposite exclusion edit');
    check((await send(a,setting('cumin',true))).result.status,'Conflict','S100 persisted ABA rejects stale setting');
    // Simultaneous duplicate HTTP executions share admission and exactly one effect.
    const duplicate=await admitted(a,await inspected(move('tomato','dairy')));
    const duplicates=await Promise.all([http(a,duplicate),http(a,duplicate)]);
    check(duplicates.map(r=>r.status).sort(),['AlreadyApplied','Applied'],'simultaneous duplicates one result');
    const later=await read(a);
    await organize(move('tomato','misc'));
    check((await http(a,duplicate)).status,'AlreadyApplied','lost historical response replay after later move');
    check((await read(a)).document.preferences.categoryByIngredient.tomato,'misc','historical replay never restores old location');
    check((await http(a,{...duplicate,command:{...duplicate.command,observedRevision:Number(later.content_revision)}})).status,'PayloadMismatch','payload binding remains immutable');
    // Populated upgrade rehearsal: exact before/after row preservation with accepted 027 validator.
    writeFileSync('../.codex-artifacts/slice9/http-state.json',JSON.stringify(await read(a),null,2));
    complete=true;
  } finally {
    for(const id of owners) await admin.auth.admin.deleteUser(id);
    writeFileSync('../.codex-artifacts/slice9/http-results.json',JSON.stringify({checks,complete},null,2));
    await db.end();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
