begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(41);

select extensions.col_type_is('public', 'weekly_plans', 'recipe_uuids', 'uuid[]', 'weekly membership has a UUID mirror');
select extensions.col_type_is('public', 'weekly_plans', 'day_assignment_recipe_uuids', 'jsonb', 'weekly assignments have a UUID-keyed mirror');
select extensions.col_type_is('public', 'weekly_plans', 'made_recipe_uuids', 'uuid[]', 'weekly made-state has a UUID mirror');
select extensions.col_type_is('public', 'plan_templates', 'recipe_uuids', 'uuid[]', 'template membership has a UUID mirror');
select extensions.col_type_is('public', 'plan_templates', 'day_assignment_recipe_uuids', 'jsonb', 'template assignments have a UUID-keyed mirror');
select extensions.col_type_is('public', 'recipe_history', 'recipe_uuid', 'uuid', 'history has nullable canonical linkage');
select extensions.col_type_is('public', 'recipe_shares', 'source_recipe_uuid', 'uuid', 'shares have canonical source linkage');
select extensions.col_type_is('public', 'recipe_shares', 'accepted_recipe_uuid', 'uuid', 'shares have recipient-owned accepted linkage');
select extensions.col_type_is('public', 'shopping_list', 'source_recipe_uuids', 'uuid[]', 'shopping provenance has a UUID mirror');
select extensions.col_type_is('public', 'shopping_recipe_contributions', 'recipe_uuid', 'uuid', 'contributions have canonical identity');

select extensions.col_not_null('public', 'weekly_plans', 'recipe_uuids', 'weekly UUID membership is required');
select extensions.col_not_null('public', 'weekly_plans', 'day_assignment_recipe_uuids', 'weekly UUID assignments are required');
select extensions.col_not_null('public', 'weekly_plans', 'made_recipe_uuids', 'weekly UUID made-state is required');
select extensions.col_not_null('public', 'plan_templates', 'recipe_uuids', 'template UUID membership is required');
select extensions.col_not_null('public', 'plan_templates', 'day_assignment_recipe_uuids', 'template UUID assignments are required');
select extensions.col_not_null('public', 'shopping_list', 'source_recipe_uuids', 'shopping UUID provenance is required');
select extensions.col_not_null('public', 'shopping_recipe_contributions', 'recipe_uuid', 'contribution UUID identity is required');

insert into auth.users (id, email)
values
  ('51000000-0000-0000-0000-000000000001', 'uuid-refs-a@example.test'),
  ('52000000-0000-0000-0000-000000000002', 'uuid-refs-b@example.test');

delete from public.recipes
where user_id in (
  '51000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000002'
);

insert into public.recipes (id, user_id, name, category)
values
  ('uuid-ref-a-1', '51000000-0000-0000-0000-000000000001', 'Same Name', 'test'),
  ('uuid-ref-a-2', '51000000-0000-0000-0000-000000000001', 'Same Name', 'test'),
  ('uuid-ref-b-1', '52000000-0000-0000-0000-000000000002', 'Same Name', 'test');

insert into public.weekly_plans (
  user_id,
  week_date,
  recipe_ids,
  day_assignments,
  made_recipe_ids
)
values (
  '51000000-0000-0000-0000-000000000001',
  '2026-07-13',
  array['uuid-ref-a-2', 'uuid-ref-a-1'],
  '{"uuid-ref-a-1":["monday","wednesday"],"uuid-ref-a-2":{"day":"friday","slot":2}}'::jsonb,
  array['uuid-ref-a-1']
);

insert into public.plan_templates (
  id,
  user_id,
  name,
  recipe_ids,
  day_assignments
)
values (
  '53000000-0000-0000-0000-000000000003',
  '51000000-0000-0000-0000-000000000001',
  'UUID reference fixture',
  array['uuid-ref-a-1', 'uuid-ref-a-2'],
  '{"uuid-ref-a-2":["sunday"]}'::jsonb
);

insert into public.recipe_history (recipe_id, user_id, date_made)
values
  ('uuid-ref-a-1', '51000000-0000-0000-0000-000000000001', '2026-07-10T12:00:00Z'),
  ('deleted-legacy-evidence', '51000000-0000-0000-0000-000000000001', '2025-01-01T12:00:00Z');

insert into public.recipe_shares (
  id,
  sender_user_id,
  sender_email,
  recipient_user_id,
  recipient_email,
  source_recipe_id,
  source_recipe_snapshot,
  status,
  accepted_recipe_id
)
values
  (
    '54000000-0000-0000-0000-000000000004',
    '51000000-0000-0000-0000-000000000001',
    'uuid-refs-a@example.test',
    '52000000-0000-0000-0000-000000000002',
    'uuid-refs-b@example.test',
    'uuid-ref-a-1',
    '{"name":"snapshot"}'::jsonb,
    'accepted',
    'uuid-ref-b-1'
  ),
  (
    '55000000-0000-0000-0000-000000000005',
    '51000000-0000-0000-0000-000000000001',
    'uuid-refs-a@example.test',
    '52000000-0000-0000-0000-000000000002',
    'uuid-refs-b@example.test',
    'deleted-share-source',
    '{"name":"historical snapshot"}'::jsonb,
    'accepted',
    'deleted-accepted-copy'
  );

insert into public.shopping_list (
  user_id,
  items,
  already_have,
  excluded,
  source_recipes
)
values (
  '51000000-0000-0000-0000-000000000001',
  '[
    {"rowId":"first","sources":[{"recipeId":"uuid-ref-a-2","recipeName":"snapshot"}]},
    {"rowId":"second","sources":[{"recipeId":"deleted-shopping-source","recipeName":"snapshot"}]}
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  array['uuid-ref-a-2', 'uuid-ref-a-1']
)
on conflict (user_id) do update
set items = excluded.items,
    already_have = excluded.already_have,
    excluded = excluded.excluded,
    source_recipes = excluded.source_recipes;

insert into public.shopping_recipe_contributions (
  user_id,
  recipe_id,
  servings,
  scale,
  normalization_version,
  snapshot,
  idempotency_key
)
values (
  '51000000-0000-0000-0000-000000000001',
  'uuid-ref-a-1',
  4,
  1,
  1,
  '{"items":[{"sources":[{"recipeId":"uuid-ref-a-1","recipeName":"snapshot"}]}]}'::jsonb,
  'uuid-reference-fixture'
);

select extensions.is(
  (select recipe_uuids from public.weekly_plans where user_id = '51000000-0000-0000-0000-000000000001'),
  array[
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-2'),
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-1')
  ]::uuid[],
  'weekly membership preserves legacy array order'
);

select extensions.is(
  (select day_assignment_recipe_uuids -> (select recipe_uuid::text from public.recipes where id = 'uuid-ref-a-1') from public.weekly_plans where user_id = '51000000-0000-0000-0000-000000000001'),
  '["monday", "wednesday"]'::jsonb,
  'weekly assignment values survive key conversion exactly'
);

select extensions.is(
  (select made_recipe_uuids from public.weekly_plans where user_id = '51000000-0000-0000-0000-000000000001'),
  array[(select recipe_uuid from public.recipes where id = 'uuid-ref-a-1')]::uuid[],
  'weekly made-state maps to canonical UUID'
);

select extensions.is(
  (select recipe_uuids from public.plan_templates where id = '53000000-0000-0000-0000-000000000003'),
  array[
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-1'),
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-2')
  ]::uuid[],
  'template membership preserves order'
);

select extensions.is(
  (select day_assignment_recipe_uuids -> (select recipe_uuid::text from public.recipes where id = 'uuid-ref-a-2') from public.plan_templates where id = '53000000-0000-0000-0000-000000000003'),
  '["sunday"]'::jsonb,
  'template assignment values survive key conversion'
);

select extensions.is(
  (select recipe_uuid from public.recipe_history where recipe_id = 'uuid-ref-a-1'),
  (select recipe_uuid from public.recipes where id = 'uuid-ref-a-1'),
  'resolvable history receives canonical linkage'
);

select extensions.ok(
  (select recipe_uuid is null and recipe_id = 'deleted-legacy-evidence' from public.recipe_history where recipe_id = 'deleted-legacy-evidence'),
  'unresolved history keeps legacy evidence without inventing a UUID'
);

select extensions.ok(
  (
    select share.source_recipe_uuid = source.recipe_uuid
      and share.accepted_recipe_uuid = accepted.recipe_uuid
      and share.source_recipe_uuid <> share.accepted_recipe_uuid
    from public.recipe_shares share
    join public.recipes source on source.id = 'uuid-ref-a-1'
    join public.recipes accepted on accepted.id = 'uuid-ref-b-1'
    where share.id = '54000000-0000-0000-0000-000000000004'
  ),
  'share linkage preserves separate sender and recipient UUIDs'
);

select extensions.ok(
  (
    select source_recipe_uuid is null
      and accepted_recipe_uuid is null
      and source_recipe_id = 'deleted-share-source'
      and accepted_recipe_id = 'deleted-accepted-copy'
    from public.recipe_shares
    where id = '55000000-0000-0000-0000-000000000005'
  ),
  'historical share aliases and snapshot survive without invented UUIDs'
);

select extensions.is(
  (select source_recipe_uuids from public.shopping_list where user_id = '51000000-0000-0000-0000-000000000001'),
  array[
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-2'),
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-1')
  ]::uuid[],
  'shopping source UUIDs preserve order'
);

select extensions.is(
  (select items #>> '{0,sources,0,recipeUuid}' from public.shopping_list where user_id = '51000000-0000-0000-0000-000000000001'),
  (select recipe_uuid::text from public.recipes where id = 'uuid-ref-a-2'),
  'resolvable shopping display provenance gains canonical UUID metadata'
);

select extensions.ok(
  (
    select items #>> '{1,sources,0,legacyRecipeId}' = 'deleted-shopping-source'
      and items #> '{1,sources,0,recipeUuid}' is null
    from public.shopping_list
    where user_id = '51000000-0000-0000-0000-000000000001'
  ),
  'unresolved shopping provenance is explicitly retained as legacy evidence'
);

select extensions.is(
  (select string_agg(item ->> 'rowId', ',' order by position) from public.shopping_list shopping cross join lateral jsonb_array_elements(shopping.items) with ordinality item(item, position) where shopping.user_id = '51000000-0000-0000-0000-000000000001'),
  'first,second',
  'shopping JSON enrichment preserves item order'
);

select extensions.is(
  (select recipe_uuid from public.shopping_recipe_contributions where recipe_id = 'uuid-ref-a-1'),
  (select recipe_uuid from public.recipes where id = 'uuid-ref-a-1'),
  'contribution identity maps one-to-one to recipe UUID'
);

select extensions.is(
  (select snapshot #>> '{items,0,sources,0,recipeUuid}' from public.shopping_recipe_contributions where recipe_id = 'uuid-ref-a-1'),
  (select recipe_uuid::text from public.recipes where id = 'uuid-ref-a-1'),
  'contribution snapshot provenance gains canonical UUID metadata'
);

update public.weekly_plans
set recipe_ids = array['uuid-ref-a-1'],
    day_assignments = '{"uuid-ref-a-1":["tuesday"]}'::jsonb,
    made_recipe_ids = array['uuid-ref-a-1']
where user_id = '51000000-0000-0000-0000-000000000001';

select extensions.ok(
  (
    select recipe_uuids = array[(select recipe_uuid from public.recipes where id = 'uuid-ref-a-1')]
      and made_recipe_uuids = array[(select recipe_uuid from public.recipes where id = 'uuid-ref-a-1')]
      and day_assignment_recipe_uuids ? (select recipe_uuid::text from public.recipes where id = 'uuid-ref-a-1')
    from public.weekly_plans
    where user_id = '51000000-0000-0000-0000-000000000001'
  ),
  'legacy application planner writes remain synchronized during Stage 2A'
);

select extensions.throws_ok(
  $$
    update public.weekly_plans
    set recipe_ids = array['uuid-ref-b-1']
    where user_id = '51000000-0000-0000-0000-000000000001'
  $$,
  '23503',
  'active recipe reference is unresolved or belongs to another user',
  'cross-user active references are rejected'
);

select extensions.throws_ok(
  $$
    update public.weekly_plans
    set recipe_ids = array['uuid-ref-a-1', 'uuid-ref-a-1']
    where user_id = '51000000-0000-0000-0000-000000000001'
  $$,
  '23505',
  'active recipe references contain a duplicate canonical identity',
  'duplicate canonical active membership is rejected'
);

select extensions.throws_ok(
  $$
    insert into public.recipe_shares (
      sender_user_id, sender_email, recipient_user_id, recipient_email,
      source_recipe_id, source_recipe_snapshot, status
    ) values (
      '51000000-0000-0000-0000-000000000001', 'uuid-refs-a@example.test',
      '52000000-0000-0000-0000-000000000002', 'uuid-refs-b@example.test',
      'missing-pending-source', '{}'::jsonb, 'pending'
    )
  $$,
  '23503',
  'pending share source is unresolved or belongs to another user',
  'new pending shares cannot store unresolved legacy-only identity'
);

select extensions.lives_ok(
  $$
    insert into public.recipe_history (recipe_id, user_id)
    values ('another-deleted-recipe', '51000000-0000-0000-0000-000000000001')
  $$,
  'historical unresolved linkage remains preservable'
);

select extensions.lives_ok(
  format(
    'update public.shopping_recipe_contributions set recipe_uuid = %L where recipe_id = %L',
    (select recipe_uuid from public.recipes where id = 'uuid-ref-a-2'),
    'uuid-ref-a-1'
  ),
  'contribution UUID-first update derives its legacy compatibility mirror'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shopping_recipe_contributions'::regclass
      and conname = 'shopping_recipe_contributions_user_recipe_uuid_key'
      and contype = 'u'
  ),
  'one active contribution is enforced per user and recipe UUID'
);

select extensions.ok(
  not has_function_privilege(
    'authenticated',
    'private.resolve_owned_recipe_uuid_array(uuid,text[])',
    'execute'
  ),
  'application roles cannot call transitional mapping helpers'
);

select extensions.is(
  (
    select count(*)::integer
    from public.weekly_plans plan
    where plan.recipe_uuids <> private.resolve_owned_recipe_uuid_array(plan.user_id, plan.recipe_ids)
       or plan.day_assignment_recipe_uuids <> private.resolve_owned_recipe_assignment_keys(plan.user_id, plan.day_assignments)
       or plan.made_recipe_uuids <> private.resolve_owned_recipe_uuid_array(plan.user_id, plan.made_recipe_ids)
  ),
  0,
  'all active weekly references retain exact UUID parity'
);

select * from extensions.finish();

rollback;
