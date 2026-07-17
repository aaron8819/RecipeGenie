begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

insert into auth.users(id, email) values
  ('31000000-0000-4000-8000-000000000001', 'contribution-a@example.test'),
  ('32000000-0000-4000-8000-000000000002', 'contribution-b@example.test');
delete from public.recipes where user_id in (
  '31000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000002'
);
insert into public.recipes(id, recipe_uuid, user_id, name, category, servings, ingredients, instructions)
values
  ('contrib-a', '31111111-1111-4111-8111-111111111111', '31000000-0000-4000-8000-000000000001', 'A', 'test', 4, '[]', '{}'),
  ('contrib-b', '32333333-3333-4333-8333-333333333333', '32000000-0000-4000-8000-000000000002', 'B', 'test', 4, '[]', '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    0,
    '[{"recipe_uuid":"31111111-1111-4111-8111-111111111111","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":["31111111-1111-4111-8111-111111111111"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0001', 'add_or_replace'
  )
$$, 'UUID contribution command succeeds');
select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions where user_id = auth.uid()),
  1, 'UUID command writes one owned contribution'
);
select extensions.is(
  (select public.apply_recipe_shopping_contribution_uuid_command(
    0,
    '[{"recipe_uuid":"31111111-1111-4111-8111-111111111111","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":["31111111-1111-4111-8111-111111111111"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0001', 'add_or_replace'
  ) ->> 'outcome'),
  'deduplicated', 'UUID command replay is idempotent'
);
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    1, '[]'::jsonb, array['31111111-1111-4111-8111-111111111111'::uuid],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[],"scale":1,"total_servings":0,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0001', 'remove'
  )
$$, '22023', 'idempotency key already used for another request',
  'idempotency key cannot authorize a different UUID command');
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    0, '[]'::jsonb, '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[],"scale":1,"total_servings":0,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0002', 'remove'
  )
$$, '40001', 'shopping contribution revision conflict', 'stale UUID command revision rejects');
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    1,
    '[{"recipe_uuid":"32333333-3333-4333-8333-333333333333","servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[],"scale":1,"total_servings":0,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0003', 'add_or_replace'
  )
$$, '23503', 'recipe UUID is unresolved or belongs to another user',
  'cross-owner contribution UUID rejects');
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    1,
    '[{"servings":4,"scale":1,"normalization_version":1,"snapshot":{"items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[],"scale":1,"total_servings":0,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'uuid-command-0004', 'add_or_replace'
  )
$$, '22023', 'contribution recipe UUID is required', 'missing contribution UUID rejects');
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_command(
    1, '[]'::jsonb, '{}'::text[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
    '{}'::jsonb, 'legacy-command-1', 'remove'
  )
$$, '42501', 'permission denied for function apply_recipe_shopping_contribution_command',
  'legacy contribution command is not executable');
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.apply_recipe_shopping_contribution_command(bigint,jsonb,text[],jsonb,jsonb,text,text)',
    'EXECUTE'
  ), 'only the UUID contribution command is granted'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    1, '[]'::jsonb, '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":[]}'::jsonb,
    '{}'::jsonb, 'uuid-command-anon', 'remove'
  )
$$, '42501', 'permission denied for function apply_recipe_shopping_contribution_uuid_command',
  'anonymous UUID contribution command rejects');

select * from extensions.finish();
rollback;
