begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(59);

insert into auth.users(id, email) values
  ('61000000-0000-4000-8000-000000000001', 'stage2c-a@example.test'),
  ('62000000-0000-4000-8000-000000000002', 'stage2c-b@example.test');

delete from public.recipes where user_id in (
  '61000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000002'
);

insert into public.recipes(
  id, recipe_uuid, user_id, name, category, servings, ingredients, instructions
) values
  ('stage2c-a-1', '61111111-1111-4111-8111-111111111111', '61000000-0000-4000-8000-000000000001', 'Stage 2C A1', 'test', 4, '[]', '{}'),
  ('stage2c-a-2', '61222222-2222-4222-8222-222222222222', '61000000-0000-4000-8000-000000000001', 'Stage 2C A2', 'test', 4, '[]', '{}'),
  ('stage2c-b-1', '62333333-3333-4333-8333-333333333333', '62000000-0000-4000-8000-000000000002', 'Stage 2C B1', 'test', 4, '[]', '{}');

-- Historical migration-owner evidence remains nullable and unresolved.
insert into public.recipe_history(user_id, recipe_id, date_made)
values ('61000000-0000-4000-8000-000000000001', 'deleted-history-evidence', now());

insert into public.recipe_shares(
  id, sender_user_id, sender_email, recipient_user_id, recipient_email,
  source_recipe_id, accepted_recipe_id, source_recipe_snapshot, status, responded_at
) values (
  '63000000-0000-4000-8000-000000000003',
  '61000000-0000-4000-8000-000000000001', 'stage2c-a@example.test',
  '62000000-0000-4000-8000-000000000002', 'stage2c-b@example.test',
  'deleted-share-source', 'deleted-share-copy', '{}'::jsonb, 'accepted', now()
);

update public.shopping_list
set items = '[{"item":"historical","sources":[{"recipeId":"deleted-shopping-source"}]}]'::jsonb
where user_id = '61000000-0000-4000-8000-000000000001';

select extensions.ok(
  (select recipe_uuid is null from public.recipe_history where recipe_id = 'deleted-history-evidence'),
  'unresolved historical history remains stored without UUID linkage'
);
select extensions.ok(
  (select source_recipe_uuid is null and accepted_recipe_uuid is null
   from public.recipe_shares where id = '63000000-0000-4000-8000-000000000003'),
  'unresolved historical share identities remain stored without UUID linkage'
);
select extensions.is(
  (select items #>> '{0,sources,0,recipeId}' from public.shopping_list
   where user_id = '61000000-0000-4000-8000-000000000001'),
  'deleted-shopping-source', 'unresolved historical shopping provenance remains stored'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok($$
  insert into public.recipes(recipe_uuid, user_id, name, category, servings, ingredients, instructions)
  values ('61444444-4444-4444-8444-444444444444', auth.uid(), 'UUID only', 'test', 4, '[]', '{}')
$$, 'UUID-only recipe creation succeeds');
select extensions.is(
  (select id from public.recipes where recipe_uuid = '61444444-4444-4444-8444-444444444444'),
  '61444444-4444-4444-8444-444444444444',
  'recipe creation derives the temporary legacy mirror'
);
select extensions.throws_ok($$
  insert into public.recipes(id, user_id, name, category)
  values ('legacy-only-create', auth.uid(), 'Legacy only', 'test')
$$, '22023', 'recipe UUID is required', 'legacy-only recipe creation rejects');
select extensions.throws_ok($$
  insert into public.recipes(id, recipe_uuid, user_id, name, category)
  values ('mismatched-create', '61555555-5555-4555-8555-555555555555', auth.uid(), 'Mismatch', 'test')
$$, '23503', 'recipe UUID and legacy identity disagree', 'mismatched recipe identity pair rejects');

select extensions.lives_ok($$
  insert into public.weekly_plans(
    user_id, week_date, recipe_uuids, day_assignment_recipe_uuids, made_recipe_uuids
  ) values (
    auth.uid(), date '2026-07-20',
    array['61111111-1111-4111-8111-111111111111'::uuid, '61222222-2222-4222-8222-222222222222'::uuid],
    '{"61111111-1111-4111-8111-111111111111":2}'::jsonb,
    array['61111111-1111-4111-8111-111111111111'::uuid]
  )
$$, 'UUID-only planner membership, assignment, and made-state succeed');
select extensions.is(
  (select recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['stage2c-a-1','stage2c-a-2']::text[], 'planner membership mirror is derived'
);
select extensions.is(
  (select day_assignments from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  '{"stage2c-a-1":2}'::jsonb, 'planner assignment mirror is derived'
);
select extensions.is(
  (select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['stage2c-a-1']::text[], 'planner made-state mirror is derived'
);
select extensions.throws_ok($$
  update public.weekly_plans set recipe_ids = array['stage2c-a-1']
  where user_id = auth.uid() and week_date = date '2026-07-20'
$$, '22023', 'weekly plan recipe UUIDs are required', 'legacy-only planner update rejects');
select extensions.throws_ok($$
  update public.weekly_plans
  set recipe_ids = array['stage2c-a-1'],
      recipe_uuids = array['61222222-2222-4222-8222-222222222222'::uuid]
  where user_id = auth.uid() and week_date = date '2026-07-20'
$$, '23503', 'weekly plan legacy and UUID memberships disagree', 'mismatched planner pair rejects');
select extensions.throws_ok($$
  update public.weekly_plans
  set recipe_uuids = array['61999999-9999-4999-8999-999999999999'::uuid]
  where user_id = auth.uid() and week_date = date '2026-07-20'
$$, '23503', 'active recipe UUID is unresolved or belongs to another user', 'unresolved planner UUID rejects');
select extensions.throws_ok($$
  update public.weekly_plans
  set recipe_uuids = array['62333333-3333-4333-8333-333333333333'::uuid]
  where user_id = auth.uid() and week_date = date '2026-07-20'
$$, '23503', 'active recipe UUID is unresolved or belongs to another user', 'cross-owner planner UUID rejects');
select extensions.throws_ok($$
  update public.weekly_plans set day_assignment_recipe_uuids = '{"not-a-uuid":1}'::jsonb
  where user_id = auth.uid() and week_date = date '2026-07-20'
$$, '22023', 'recipe assignment key must be a UUID', 'malformed planner assignment UUID rejects');

select extensions.lives_ok($$
  insert into public.plan_templates(user_id, name, recipe_uuids, day_assignment_recipe_uuids)
  values (auth.uid(), 'UUID template', array['61111111-1111-4111-8111-111111111111'::uuid],
    '{"61111111-1111-4111-8111-111111111111":4}'::jsonb)
$$, 'UUID-only template write succeeds');
select extensions.ok(
  (select recipe_ids = array['stage2c-a-1']::text[] and day_assignments = '{"stage2c-a-1":4}'::jsonb
   from public.plan_templates where user_id = auth.uid()),
  'template compatibility mirrors are derived'
);
select extensions.throws_ok($$
  update public.plan_templates set recipe_ids = array['stage2c-a-2'] where user_id = auth.uid()
$$, '22023', 'template recipe UUIDs are required', 'legacy-only template write rejects');

select extensions.lives_ok($$
  insert into public.recipe_history(user_id, recipe_uuid, date_made)
  values (auth.uid(), '61111111-1111-4111-8111-111111111111', now())
$$, 'UUID-only live history write succeeds');
select extensions.is(
  (select recipe_id from public.recipe_history
   where user_id = auth.uid() and recipe_uuid = '61111111-1111-4111-8111-111111111111'
   order by id desc limit 1),
  'stage2c-a-1', 'live history derives legacy evidence'
);
select extensions.throws_ok($$
  insert into public.recipe_history(user_id, recipe_id, date_made)
  values (auth.uid(), 'stage2c-a-1', now())
$$, '22023', 'active recipe history UUID is required', 'legacy-only live history rejects');

select extensions.lives_ok($$
  insert into public.recipe_shares(
    id, sender_user_id, sender_email, recipient_user_id, recipient_email,
    source_recipe_uuid, source_recipe_snapshot, status
  ) values (
    '63111111-1111-4111-8111-111111111111', auth.uid(), 'stage2c-a@example.test',
    '62000000-0000-4000-8000-000000000002', 'stage2c-b@example.test',
    '61111111-1111-4111-8111-111111111111', '{}'::jsonb, 'pending'
  )
$$, 'UUID-only share creation succeeds');
select extensions.is(
  (select source_recipe_id from public.recipe_shares where id = '63111111-1111-4111-8111-111111111111'),
  'stage2c-a-1', 'share source legacy mirror is derived'
);
select extensions.throws_ok($$
  insert into public.recipe_shares(
    sender_user_id, sender_email, recipient_user_id, recipient_email,
    source_recipe_id, source_recipe_snapshot, status
  ) values (
    auth.uid(), 'stage2c-a@example.test', '62000000-0000-4000-8000-000000000002',
    'stage2c-b@example.test', 'stage2c-a-2', '{}'::jsonb, 'pending'
  )
$$, '22023', 'active share source UUID is required', 'legacy-only active share rejects');
select extensions.throws_ok($$
  insert into public.recipe_shares(
    sender_user_id, sender_email, recipient_user_id, recipient_email,
    source_recipe_id, source_recipe_uuid, source_recipe_snapshot, status
  ) values (
    auth.uid(), 'stage2c-a@example.test', '62000000-0000-4000-8000-000000000002',
    'stage2c-b@example.test', 'stage2c-a-2', '61111111-1111-4111-8111-111111111111', '{}'::jsonb, 'pending'
  )
$$, '23503', 'share source identities disagree', 'mismatched share source pair rejects');

select extensions.lives_ok($$
  update public.shopping_list
  set source_recipe_uuids = array['61111111-1111-4111-8111-111111111111'::uuid],
      items = '[{"item":"active","sources":[{"recipeUuid":"61111111-1111-4111-8111-111111111111"}]}]'::jsonb
  where user_id = auth.uid()
$$, 'UUID-only shopping provenance write succeeds');
select extensions.is(
  (select source_recipes from public.shopping_list where user_id = auth.uid()),
  array['stage2c-a-1']::text[], 'shopping source mirror is derived'
);
select extensions.ok(
  (select items #>> '{0,sources,0,recipeUuid}' = '61111111-1111-4111-8111-111111111111'
      and items #>> '{0,sources,0,recipeId}' = 'stage2c-a-1'
   from public.shopping_list where user_id = auth.uid()),
  'shopping source pair is derived and validated'
);
select extensions.throws_ok($$
  update public.shopping_list set source_recipes = array['stage2c-a-2'] where user_id = auth.uid()
$$, '22023', 'shopping source recipe UUIDs are required', 'legacy-only shopping source array rejects');
select extensions.throws_ok($$
  update public.shopping_list
  set items = '[{"item":"legacy-active","sources":[{"recipeId":"stage2c-a-1"}]}]'::jsonb
  where user_id = auth.uid()
$$, '22023', 'shopping recipe UUID metadata is required', 'legacy-only live shopping JSON provenance rejects');

select extensions.lives_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    (select contribution_revision from public.shopping_list where user_id = auth.uid()),
    '[{"recipe_uuid":"61111111-1111-4111-8111-111111111111","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":["61111111-1111-4111-8111-111111111111"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'stage2c-add-0001', 'add_or_replace'
  )
$$, 'UUID-only shopping contribution command succeeds');
select extensions.is(
  (select recipe_uuid from public.shopping_recipe_contributions where user_id = auth.uid()),
  '61111111-1111-4111-8111-111111111111'::uuid, 'contribution persists canonical UUID'
);
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_command(
    0, '[]'::jsonb, '{}'::text[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
    '{}'::jsonb, 'legacy-command-1', 'remove'
  )
$$, '42501', 'permission denied for function apply_recipe_shopping_contribution_command',
  'legacy shopping contribution command is not executable');
select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'public.apply_recipe_shopping_contribution_command(bigint,jsonb,text[],jsonb,jsonb,text,text)',
    'EXECUTE'
  ), 'legacy shopping command grant is absent'
);

select extensions.lives_ok($$
  select public.toggle_weekly_recipe_made(
    '61222222-2222-4222-8222-222222222222'::uuid, date '2026-07-20', true, now()
  )
$$, 'UUID made-state command succeeds');
select extensions.ok(
  (select '61222222-2222-4222-8222-222222222222'::uuid = any(made_recipe_uuids)
   from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  'UUID made-state command updates canonical state'
);
select extensions.ok(
  to_regprocedure('public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)') is null,
  'legacy made-state overload is absent from the catalog'
);

select extensions.is(
  public.resolve_recipe_identity('61111111-1111-4111-8111-111111111111', null),
  '61111111-1111-4111-8111-111111111111'::uuid, 'UUID resolver input resolves same-owner identity'
);
select extensions.is(
  public.get_recipe_identity_compat_usage()::integer,
  0, 'UUID-only resolver input does not increment compatibility usage'
);
select extensions.is(
  public.resolve_recipe_identity(null, 'stage2c-a-1'),
  '61111111-1111-4111-8111-111111111111'::uuid, 'same-owner legacy alias resolves explicitly'
);
select extensions.is(
  public.get_recipe_identity_compat_usage()::integer,
  1, 'legacy compatibility lookup increments the aggregate counter'
);
select extensions.is(
  public.resolve_recipe_identity('61111111-1111-4111-8111-111111111111', 'stage2c-a-1'),
  '61111111-1111-4111-8111-111111111111'::uuid, 'matching compatibility pair resolves'
);
select extensions.throws_ok($$
  select public.resolve_recipe_identity('61111111-1111-4111-8111-111111111111', 'stage2c-a-2')
$$, '23503', 'recipe UUID and legacy identity disagree', 'mismatched resolver pair rejects');
select extensions.throws_ok($$
  select public.resolve_recipe_identity(null, 'stage2c-b-1')
$$, '23503', 'legacy recipe identity is unresolved or belongs to another user',
  'cross-owner alias lookup does not leak');
select extensions.throws_ok($$
  select public.resolve_recipe_identity(null, 'unknown-stage2c-alias')
$$, '23503', 'legacy recipe identity is unresolved or belongs to another user',
  'unknown alias returns the same not-found category');
select extensions.is(
  public.get_recipe_identity_compat_usage()::integer,
  2, 'normal UUID active commands never invoke the compatibility resolver'
);

select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok($$
  select public.accept_recipe_share('63111111-1111-4111-8111-111111111111')
$$, 'UUID share acceptance creates a recipient-owned copy');
select extensions.ok(
  (select accepted_recipe_uuid is not null and accepted_recipe_uuid <> source_recipe_uuid
   from public.recipe_shares where id = '63111111-1111-4111-8111-111111111111'),
  'accepted share copy has distinct canonical identity'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    (select contribution_revision from public.shopping_list where user_id = auth.uid()),
    '[]'::jsonb, array['61111111-1111-4111-8111-111111111111'::uuid],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[],"scale":1,"total_servings":0,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'stage2c-remove-01', 'remove'
  )
$$, 'UUID contribution removal succeeds before deletion');
select extensions.is(
  public.delete_recipe('61111111-1111-4111-8111-111111111111'),
  '61111111-1111-4111-8111-111111111111'::uuid, 'UUID deletion command returns canonical identity'
);
select extensions.is(
  (select count(*)::integer from public.recipes where recipe_uuid = '61111111-1111-4111-8111-111111111111'),
  0, 'UUID deletion removes the owned recipe'
);
select extensions.ok(
  exists(select 1 from public.recipe_history where recipe_id = 'stage2c-a-1'),
  'recipe deletion preserves historical legacy evidence'
);
select extensions.throws_ok($$
  select public.delete_recipe('not-a-uuid')
$$, '22P02', null, 'malformed deletion UUID rejects before execution');
select extensions.throws_ok($$
  select public.delete_recipe('61999999-9999-4999-8999-999999999999')
$$, '23503', 'recipe UUID is unresolved or belongs to another user', 'unresolved deletion UUID rejects');
select extensions.throws_ok($$
  select public.delete_recipe('62333333-3333-4333-8333-333333333333')
$$, '23503', 'recipe UUID is unresolved or belongs to another user', 'cross-owner deletion UUID rejects');
select extensions.ok(
  has_function_privilege('authenticated', 'public.delete_recipe(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.delete_recipe(uuid)', 'EXECUTE'),
  'UUID deletion function has least-privilege grants'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.recipes', 'DELETE'),
  'authenticated table deletion is unavailable'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$
  select public.delete_recipe('61222222-2222-4222-8222-222222222222')
$$, '42501', 'permission denied for function delete_recipe', 'anonymous UUID deletion rejects');

select * from extensions.finish();
rollback;
