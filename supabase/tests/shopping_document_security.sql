begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

insert into auth.users(id, email) values
  ('31000000-0000-4000-8000-000000000001', 'shopping-a@example.test'),
  ('32000000-0000-4000-8000-000000000002', 'shopping-b@example.test');

select extensions.has_column('public', 'shopping_list', 'document', 'Shopping has one canonical document column');
select extensions.has_column('public', 'shopping_list', 'content_revision', 'Shopping has one CAS revision column');
select extensions.ok(to_regclass('public.shopping_recipe_contributions') is null
  and to_regclass('public.shopping_contribution_commands') is null, 'legacy contribution tables are gone');
select extensions.ok(to_regprocedure('public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)') is null
  and to_regprocedure('public.move_shopping_item_to_pantry(text,numeric,text)') is null, 'legacy Shopping RPCs are gone');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::integer from public.shopping_list), 1, 'RLS exposes only the owned document');
select extensions.is((select content_revision from public.shopping_list), 0::bigint, 'new documents start at revision zero');
select extensions.lives_ok($$
  update public.shopping_list set
    document = jsonb_set(document, '{manualItems}', '[{"id":"manual-a","displayName":"apples","quantity":null,"categoryKey":"produce","bucket":"items","checked":false}]'::jsonb),
    content_revision = 1
  where user_id = auth.uid() and content_revision = 0
$$, 'an owned exact-revision write succeeds');
select extensions.is((select content_revision from public.shopping_list), 1::bigint, 'a write advances the revision once');
select extensions.throws_ok($$ update public.shopping_list set content_revision = 3 where user_id = auth.uid() $$,
  '40001', 'Shopping content revision must advance exactly once', 'skipped revisions reject');
select extensions.throws_ok($$ update public.shopping_list set document = '{"schemaVersion":2}'::jsonb, content_revision = 2 where user_id = auth.uid() $$,
  '23514', null, 'malformed documents reject');
select extensions.lives_ok($$
  update public.shopping_list set content_revision = 1
  where user_id = '32000000-0000-4000-8000-000000000002'
$$, 'a cross-owner update is safely filtered by RLS');
select extensions.lives_ok($$
  select * from public.move_shopping_document_item_to_pantry(1,
    (select document from public.shopping_list where user_id = auth.uid()), 'Apples', 2, 'count')
$$, 'the Pantry move accepts the current revision');
select extensions.ok((select content_revision = 2 from public.shopping_list)
  and exists (select 1 from public.pantry_items where user_id = auth.uid() and item = 'apples'),
  'the Pantry move advances Shopping and inserts Pantry atomically');
select extensions.throws_ok($$
  select * from public.move_shopping_document_item_to_pantry(1,
    (select document from public.shopping_list where user_id = auth.uid()), 'bananas', 1, 'count')
$$, '40001', 'Shopping content revision conflict', 'a stale Pantry move fails closed');
select extensions.ok(not exists (select 1 from public.pantry_items where user_id = auth.uid() and item = 'bananas'),
  'a conflicted Pantry move has no partial write');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$ select count(*) from public.shopping_list $$,
  '42501', 'permission denied for table shopping_list', 'anonymous reads are not granted');
select extensions.throws_ok($$ select * from public.move_shopping_document_item_to_pantry(0, '{}'::jsonb, 'onion', 1, 'count') $$,
  '42501', 'permission denied for function move_shopping_document_item_to_pantry', 'anonymous Pantry moves are not executable');

select * from extensions.finish();
rollback;
