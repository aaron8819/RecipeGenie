begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(68);

insert into auth.users (id, email)
values
  ('61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test'),
  ('62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test');

select extensions.is(
  (select count(*)::integer from public.recipes where user_id = '61000000-0000-0000-0000-000000000001'),
  3,
  'trusted signup trigger still seeds default recipes through the shopping UUID trigger'
);

select extensions.is(
  (select count(*)::integer from public.shopping_list where user_id = '61000000-0000-0000-0000-000000000001'),
  1,
  'trusted signup trigger still creates the default shopping row'
);

delete from public.recipes
where user_id in (
  '61000000-0000-0000-0000-000000000001',
  '62000000-0000-0000-0000-000000000002'
);

insert into public.recipes (id, recipe_uuid, user_id, name, category, servings, ingredients, instructions)
values
  ('stage2a-a-1', '61110000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 'Owner A One', 'test', 4, '[]', '{}'),
  ('stage2a-a-2', '61220000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000001', 'Owner A Two', 'test', 4, '[]', '{}'),
  ('stage2a-b-1', '62330000-0000-0000-0000-000000000003', '62000000-0000-0000-0000-000000000002', 'Owner B One', 'test', 4, '[]', '{}');

insert into public.recipe_shares (
  id, sender_user_id, sender_email, recipient_user_id, recipient_email,
  source_recipe_id, source_recipe_snapshot, status, accepted_recipe_id
)
values (
  '63000000-0000-0000-0000-000000000003',
  '61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test',
  '62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test',
  'deleted-historical-source', '{"name":"historical"}'::jsonb,
  'accepted', 'deleted-historical-copy'
);

select extensions.ok(
  (select source_recipe_uuid is null and accepted_recipe_uuid is null
   from public.recipe_shares where id = '63000000-0000-0000-0000-000000000003'),
  'migration-owner historical share setup preserves nullable unresolved linkages'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-0000-0000-000000000001', true);

select extensions.lives_ok(
  $$
    insert into public.weekly_plans (
      user_id, week_date, recipe_ids, day_assignments, made_recipe_ids
    ) values (
      '61000000-0000-0000-0000-000000000001', '2026-07-13',
      array['stage2a-a-2', 'stage2a-a-1'],
      '{"stage2a-a-1":["monday"],"stage2a-a-2":{"day":"friday","slot":2}}'::jsonb,
      array['stage2a-a-1']
    )
  $$,
  'authenticated owner weekly-plan legacy write succeeds'
);

select extensions.is(
  (select recipe_ids from public.weekly_plans where week_date = '2026-07-13'),
  array['stage2a-a-2', 'stage2a-a-1']::text[],
  'weekly legacy membership remains unchanged and ordered'
);

select extensions.is(
  (select recipe_uuids from public.weekly_plans where week_date = '2026-07-13'),
  array[
    (select recipe_uuid from public.recipes where id = 'stage2a-a-2'),
    (select recipe_uuid from public.recipes where id = 'stage2a-a-1')
  ]::uuid[],
  'weekly UUID membership synchronizes in legacy order'
);

select extensions.is(
  (select day_assignment_recipe_uuids -> (select recipe_uuid::text from public.recipes where id = 'stage2a-a-2')
   from public.weekly_plans where week_date = '2026-07-13'),
  '{"day":"friday","slot":2}'::jsonb,
  'weekly assignment values survive UUID key synchronization'
);

select extensions.is(
  (select made_recipe_uuids from public.weekly_plans where week_date = '2026-07-13'),
  array[(select recipe_uuid from public.recipes where id = 'stage2a-a-1')]::uuid[],
  'weekly made-state synchronizes'
);

select extensions.throws_ok(
  $$ update public.weekly_plans set recipe_ids = array['stage2a-b-1'] where week_date = '2026-07-13' $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'weekly cross-owner legacy reference is rejected'
);

select extensions.throws_ok(
  $$ update public.weekly_plans set recipe_ids = array['missing-active'] where week_date = '2026-07-13' $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'weekly unresolved active reference is rejected'
);

select extensions.lives_ok(
  format(
    'update public.weekly_plans set recipe_uuids = array[%L]::uuid[] where week_date = %L',
    (select recipe_uuid from public.recipes where id = 'stage2a-a-1'),
    '2026-07-13'
  ),
  'weekly UUID-first update derives its legacy compatibility mirror'
);

select extensions.throws_ok(
  $$ update public.weekly_plans set recipe_ids = array['stage2a-a-1', 'stage2a-a-1'] where week_date = '2026-07-13' $$,
  '23505', 'active recipe references contain a duplicate canonical identity',
  'weekly duplicate canonical identity is rejected'
);

select extensions.lives_ok(
  $$
    insert into public.plan_templates (id, user_id, name, recipe_ids, day_assignments)
    values (
      '64000000-0000-0000-0000-000000000004',
      '61000000-0000-0000-0000-000000000001', 'Owner template',
      array['stage2a-a-1', 'stage2a-a-2'], '{"stage2a-a-2":["sunday"]}'::jsonb
    )
  $$,
  'authenticated owner template legacy write succeeds'
);

select extensions.is(
  (select recipe_uuids from public.plan_templates where id = '64000000-0000-0000-0000-000000000004'),
  array[
    (select recipe_uuid from public.recipes where id = 'stage2a-a-1'),
    (select recipe_uuid from public.recipes where id = 'stage2a-a-2')
  ]::uuid[],
  'template UUID membership synchronizes in legacy order'
);

select extensions.is(
  (select day_assignment_recipe_uuids -> (select recipe_uuid::text from public.recipes where id = 'stage2a-a-2')
   from public.plan_templates where id = '64000000-0000-0000-0000-000000000004'),
  '["sunday"]'::jsonb,
  'template assignment values survive synchronization'
);

select extensions.throws_ok(
  $$ update public.plan_templates set recipe_ids = array['stage2a-b-1'] where id = '64000000-0000-0000-0000-000000000004' $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'template cross-owner reference is rejected'
);

select extensions.throws_ok(
  $$ update public.plan_templates set recipe_ids = array['missing-active'] where id = '64000000-0000-0000-0000-000000000004' $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'template unresolved active reference is rejected'
);

select extensions.lives_ok(
  format(
    'update public.plan_templates set recipe_uuids = array[%L]::uuid[] where id = %L',
    (select recipe_uuid from public.recipes where id = 'stage2a-a-2'),
    '64000000-0000-0000-0000-000000000004'
  ),
  'template UUID-first update derives its legacy compatibility mirror'
);

select extensions.lives_ok(
  $$ insert into public.recipe_history (user_id, recipe_id) values ('61000000-0000-0000-0000-000000000001', 'stage2a-a-1') $$,
  'authenticated resolvable history legacy write succeeds'
);

select extensions.is(
  (select recipe_uuid from public.recipe_history where recipe_id = 'stage2a-a-1'),
  (select recipe_uuid from public.recipes where id = 'stage2a-a-1'),
  'history canonical linkage synchronizes'
);

select extensions.is(
  (select recipe_id from public.recipe_history where recipe_id = 'stage2a-a-1'),
  'stage2a-a-1',
  'history legacy evidence remains unchanged'
);

select extensions.lives_ok(
  $$ insert into public.recipe_history (user_id, recipe_id) values ('61000000-0000-0000-0000-000000000001', 'deleted-history-evidence') $$,
  'authenticated historical unresolved history remains preservable'
);

select extensions.ok(
  (select recipe_uuid is null and recipe_id = 'deleted-history-evidence'
   from public.recipe_history where recipe_id = 'deleted-history-evidence'),
  'historical unresolved history remains nullable with legacy evidence'
);

select extensions.throws_ok(
  format(
    'insert into public.recipe_history (user_id, recipe_id, recipe_uuid) values (%L, %L, %L)',
    '61000000-0000-0000-0000-000000000001', 'stage2a-a-1',
    '62330000-0000-0000-0000-000000000003'::uuid
  ),
  '23503', 'recipe UUID is unresolved or belongs to another user',
  'history cross-owner UUID linkage is rejected'
);

select extensions.throws_ok(
  $$
    insert into public.recipe_history (user_id, recipe_id, recipe_uuid)
    values ('61000000-0000-0000-0000-000000000001', 'stage2a-a-1', gen_random_uuid())
  $$,
  '23503', 'recipe UUID is unresolved or belongs to another user',
  'history malformed active identity pairing is rejected'
);

select extensions.lives_ok(
  $$
    insert into public.recipe_shares (
      id, sender_user_id, sender_email, recipient_user_id, recipient_email,
      source_recipe_id, source_recipe_snapshot
    ) values (
      '65000000-0000-0000-0000-000000000005',
      '61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test',
      '62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test',
      'stage2a-a-1', '{"name":"shared"}'::jsonb
    )
  $$,
  'authenticated sender legacy share write succeeds'
);

select extensions.is(
  (select source_recipe_uuid from public.recipe_shares where id = '65000000-0000-0000-0000-000000000005'),
  (select recipe_uuid from public.recipes where id = 'stage2a-a-1'),
  'share sender-owned UUID linkage synchronizes'
);

select extensions.throws_ok(
  $$
    insert into public.recipe_shares (
      sender_user_id, sender_email, recipient_user_id, recipient_email,
      source_recipe_id, source_recipe_snapshot
    ) values (
      '61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test',
      '62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test',
      'stage2a-b-1', '{}'::jsonb
    )
  $$,
  '23503', 'pending share source is unresolved or belongs to another user',
  'share cross-owner source reference is rejected'
);

select extensions.lives_ok(
  $$
    insert into public.recipe_shares (
      id, sender_user_id, sender_email, recipient_user_id, recipient_email,
      source_recipe_id, source_recipe_snapshot
    ) values (
      '66000000-0000-0000-0000-000000000006',
      '61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test',
      '62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test',
      'stage2a-a-2', '{"name":"shared two"}'::jsonb
    )
  $$,
  'second authenticated sender share fixture succeeds'
);

select extensions.lives_ok(
  $$
    update public.shopping_list
    set source_recipes = array['stage2a-a-2', 'stage2a-a-1'],
        items = '[
          {"rowId":"first","sources":[{"recipeId":"stage2a-a-2","recipeName":"display"}]},
          {"rowId":"second","sources":[{"recipeId":"deleted-shopping-evidence","recipeName":"historical"}]}
        ]'::jsonb,
        already_have = '[]'::jsonb,
        excluded = '[]'::jsonb
    where user_id = '61000000-0000-0000-0000-000000000001'
  $$,
  'authenticated owner legacy shopping write succeeds'
);

select extensions.is(
  (select source_recipe_uuids from public.shopping_list),
  array[
    (select recipe_uuid from public.recipes where id = 'stage2a-a-2'),
    (select recipe_uuid from public.recipes where id = 'stage2a-a-1')
  ]::uuid[],
  'shopping source UUID membership synchronizes in order'
);

select extensions.is(
  (select items #>> '{0,sources,0,recipeUuid}' from public.shopping_list),
  (select recipe_uuid::text from public.recipes where id = 'stage2a-a-2'),
  'shopping resolvable provenance receives UUID metadata'
);

select extensions.ok(
  (select items #>> '{0,sources,0,recipeId}' = 'stage2a-a-2'
      and items #>> '{0,sources,0,recipeName}' = 'display'
      and items #>> '{0,rowId}' = 'first'
   from public.shopping_list),
  'shopping display and legacy provenance remain unchanged'
);

select extensions.ok(
  (select items #>> '{1,sources,0,legacyRecipeId}' = 'deleted-shopping-evidence'
      and items #> '{1,sources,0,recipeUuid}' is null
   from public.shopping_list),
  'shopping unresolved historical provenance remains preserved'
);

select extensions.throws_ok(
  $$ update public.shopping_list set source_recipes = array['stage2a-b-1'] $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'shopping cross-owner active source is rejected'
);

select extensions.throws_ok(
  $$ update public.shopping_list set source_recipes = array['missing-active'] $$,
  '23503', 'active recipe reference is unresolved or belongs to another user',
  'shopping unresolved active source is rejected'
);

select extensions.lives_ok(
  format(
    'update public.shopping_list set source_recipe_uuids = array[%L]::uuid[]',
    (select recipe_uuid from public.recipes where id = 'stage2a-a-1')
  ),
  'shopping UUID-first update derives its legacy compatibility mirror'
);

select extensions.throws_ok(
  $$ update public.shopping_list set items = '[{"sources":[{"recipeId":"stage2a-a-1","recipeUuid":"not-a-uuid"}]}]'::jsonb $$,
  '22023', 'shopping recipe source UUID is malformed',
  'shopping malformed UUID metadata is rejected'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      2,
      '[{"recipe_id":"stage2a-a-1","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Owner A One","items":[{"bucket":"items","item":"milk","amount":1,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"stage2a-a-1","recipeName":"Owner A One"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[{"rowId":"milk","item":"milk","amount":1,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"stage2a-a-1","recipeName":"Owner A One"}]}],"already_have":[],"excluded":[],"source_recipes":["stage2a-a-1"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
      '{}'::jsonb, 'stage2a-add', 'add_or_replace'
    )
  $$,
  'authenticated legacy contribution add command succeeds'
);

select extensions.is(
  (select recipe_uuid from public.shopping_recipe_contributions where recipe_id = 'stage2a-a-1'),
  (select recipe_uuid from public.recipes where id = 'stage2a-a-1'),
  'contribution recipe UUID synchronizes'
);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions),
  1,
  'contribution add creates one logical contribution'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      3,
      '[{"recipe_id":"stage2a-a-1","servings":8,"scale":2,"normalization_version":1,"snapshot":{"recipeName":"Owner A One","items":[]}}]'::jsonb,
      '{}'::text[],
      '{"items":[],"already_have":[],"excluded":[],"source_recipes":["stage2a-a-1"],"scale":2,"total_servings":8,"custom_order":false}'::jsonb,
      '{}'::jsonb, 'stage2a-replace', 'add_or_replace'
    )
  $$,
  'authenticated legacy contribution replace command succeeds'
);

select extensions.ok(
  (select count(*) = 1 and max(servings) = 8 from public.shopping_recipe_contributions),
  'contribution replace retains one logical contribution'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      4, '[]'::jsonb, array['stage2a-a-1'],
      '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
      '{}'::jsonb, 'stage2a-remove', 'remove'
    )
  $$,
  'authenticated legacy contribution remove command succeeds'
);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions),
  0,
  'contribution remove leaves no duplicate logical contribution'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      5, '[{"recipe_id":"stage2a-b-1","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
      '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
      '{}'::jsonb, 'stage2a-cross-owner', 'add_or_replace'
    )
  $$,
  '42501', 'recipe is not owned by authenticated user',
  'contribution cross-owner recipe is rejected'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      5, '[{"recipe_id":"missing-active","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
      '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
      '{}'::jsonb, 'stage2a-unresolved', 'add_or_replace'
    )
  $$,
  '42501', 'recipe is not owned by authenticated user',
  'contribution unresolved recipe is rejected'
);

select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopping_recipe_contributions'::regclass
      and conname = 'shopping_recipe_contributions_user_recipe_uuid_key'
      and contype = 'u'
  ),
  'duplicate contribution UUID identity is constrained per owner'
);

select extensions.lives_ok(
  $$
    insert into public.recipes (id, user_id, name, category)
    values ('stage2a-created', '61000000-0000-0000-0000-000000000001', 'Created', 'test')
  $$,
  'current authenticated legacy recipe creation succeeds'
);

select extensions.ok(
  (select recipe_uuid is not null from public.recipes where id = 'stage2a-created'),
  'legacy recipe creation receives a database-generated UUID'
);

select extensions.ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated has no private schema usage'
);

select extensions.throws_ok(
  $$ select private.resolve_owned_recipe_uuid_array('61000000-0000-0000-0000-000000000001', array['stage2a-a-1']) $$,
  '42501', null,
  'authenticated direct private helper execution is denied'
);

select extensions.throws_ok(
  $$ select private.sync_weekly_plan_recipe_uuids() $$,
  '42501', null,
  'authenticated direct trigger-wrapper execution is denied'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-0000-0000-000000000002', true);

select extensions.lives_ok(
  $$ select public.accept_recipe_share('65000000-0000-0000-0000-000000000005') $$,
  'authenticated recipient share acceptance succeeds through UUID trigger'
);

select extensions.ok(
  (
    select share.accepted_recipe_uuid = recipe.recipe_uuid
      and recipe.user_id = share.recipient_user_id
    from public.recipe_shares as share
    join public.recipes as recipe on recipe.id = share.accepted_recipe_id
    where share.id = '65000000-0000-0000-0000-000000000005'
  ),
  'accepted-copy UUID links to the recipient-owned recipe'
);

select extensions.ok(
  (select source_recipe_uuid <> accepted_recipe_uuid
   from public.recipe_shares where id = '65000000-0000-0000-0000-000000000005'),
  'share sender and recipient UUID identities remain distinct'
);

select extensions.throws_ok(
  $$
    update public.recipe_shares
    set status = 'accepted', accepted_recipe_id = 'stage2a-a-1', responded_at = pg_catalog.now()
    where id = '66000000-0000-0000-0000-000000000006'
  $$,
  '23503', 'accepted share copy is unresolved or belongs to another user',
  'cross-owner accepted-copy legacy reference is rejected'
);

select extensions.throws_ok(
  format(
    'update public.recipe_shares set status = %L, accepted_recipe_id = %L, accepted_recipe_uuid = %L, responded_at = pg_catalog.now() where id = %L',
    'accepted', 'stage2a-b-1',
    '61220000-0000-0000-0000-000000000002'::uuid,
    '66000000-0000-0000-0000-000000000006'
  ),
  '23503', 'recipe UUID is unresolved or belongs to another user',
  'sender and recipient UUID conflation is rejected'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.throws_ok(
  $$ insert into public.weekly_plans (user_id, week_date) values ('61000000-0000-0000-0000-000000000001', '2026-07-20') $$,
  '42501', null, 'anonymous weekly-plan write is rejected'
);

select extensions.throws_ok(
  $$ insert into public.plan_templates (user_id, name) values ('61000000-0000-0000-0000-000000000001', 'anonymous') $$,
  '42501', null, 'anonymous template write is rejected'
);

select extensions.throws_ok(
  $$ insert into public.recipe_history (user_id, recipe_id) values ('61000000-0000-0000-0000-000000000001', 'stage2a-a-1') $$,
  '42501', null, 'anonymous history write is rejected'
);

select extensions.throws_ok(
  $$
    insert into public.recipe_shares (
      sender_user_id, sender_email, recipient_user_id, recipient_email,
      source_recipe_id, source_recipe_snapshot
    ) values (
      '61000000-0000-0000-0000-000000000001', 'stage2a-owner-a@example.test',
      '62000000-0000-0000-0000-000000000002', 'stage2a-owner-b@example.test',
      'stage2a-a-1', '{}'::jsonb
    )
  $$,
  '42501', null, 'anonymous share write is rejected'
);

select extensions.is_empty(
  $$ update public.shopping_list set source_recipes = '{}'::text[] where user_id = '61000000-0000-0000-0000-000000000001' returning 1 $$,
  'anonymous shopping write is rejected by RLS'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      0, '[]'::jsonb, '{}'::text[],
      '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
      '{}'::jsonb, 'anonymous-stage2a', 'remove'
    )
  $$,
  '42501', null, 'anonymous contribution execution is rejected'
);

select extensions.ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anonymous has no private schema usage'
);

select extensions.throws_ok(
  $$ select private.resolve_owned_recipe_uuid_array('61000000-0000-0000-0000-000000000001', array['stage2a-a-1']) $$,
  '42501', null,
  'anonymous direct private helper execution is denied'
);

reset role;

select extensions.ok(
  not has_function_privilege('service_role', 'private.sync_weekly_plan_recipe_uuids()', 'EXECUTE'),
  'service role has no direct trigger-wrapper execution grant'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.validate_recipe_source_items(uuid,jsonb)', 'EXECUTE'),
  'authenticated has no direct validation-helper execution grant'
);

select * from extensions.finish();

rollback;
