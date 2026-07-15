begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(28);

insert into auth.users (id, email)
values
  ('31000000-0000-0000-0000-000000000001', 'contribution-a@example.test'),
  ('32000000-0000-0000-0000-000000000002', 'contribution-b@example.test');

delete from public.recipes
where user_id in (
  '31000000-0000-0000-0000-000000000001',
  '32000000-0000-0000-0000-000000000002'
);

insert into public.recipes (id, user_id, name, category, servings, ingredients, instructions)
values
  ('contrib-a', '31000000-0000-0000-0000-000000000001', 'Contribution A', 'test', 4, '[]', '{}'),
  ('contrib-a2', '31000000-0000-0000-0000-000000000001', 'Contribution A2', 'test', 4, '[]', '{}'),
  ('contrib-b', '32000000-0000-0000-0000-000000000002', 'Contribution B', 'test', 4, '[]', '{}');

update public.shopping_list
set items = '[{"rowId":"legacy-banana","item":"banana","amount":6,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeName":"Manual","recipeId":""}]}]'::jsonb
where user_id = '31000000-0000-0000-0000-000000000001';

select extensions.is(
  (select items -> 0 ->> 'item' from public.shopping_list where user_id = '31000000-0000-0000-0000-000000000001'),
  'banana',
  'migration preserves ambiguous legacy and manual shopping JSON'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      1,
      '[{"recipe_id":"contrib-a","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Contribution A","items":[{"bucket":"items","item":"milk","amount":1,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[{"rowId":"legacy-banana","item":"banana","amount":6,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeName":"Manual","recipeId":""}]},{"rowId":"milk","item":"milk","amount":1,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"}]}],"already_have":[],"excluded":[],"source_recipes":["contrib-a"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
      '{}'::jsonb,
      'request-add-a',
      'add_or_replace'
    )
  $$,
  'User A can atomically add their contribution'
);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions),
  1,
  'User A sees one authoritative contribution'
);

select extensions.is(
  (select (items -> 1 ->> 'amount')::numeric from public.shopping_list),
  1::numeric,
  'the compatibility projection contains the contribution quantity'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      2,
      '[{"recipe_id":"contrib-a","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Contribution A","items":[{"bucket":"items","item":"milk","amount":1,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb,
      '{}'::jsonb,
      'request-add-a',
      'add_or_replace'
    )
  $$,
  'lost-response retry with the same idempotency key is a no-op'
);

select extensions.is(
  (select contribution_revision::integer from public.shopping_list),
  2,
  'idempotent retry does not advance the contribution revision'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      2,
      '[{"recipe_id":"contrib-a2","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Contribution A2","items":[]}}]'::jsonb,
      '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb, '{}'::jsonb, 'request-add-a', 'add_or_replace'
    )
  $$,
  '22023',
  'idempotency key already used for another request',
  'reusing an idempotency key for a different request is rejected'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      2,
      '[{"recipe_id":"contrib-a","servings":8,"scale":2,"normalization_version":1,"snapshot":{"recipeName":"Contribution A","items":[{"bucket":"items","item":"milk","amount":2,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[{"rowId":"legacy-banana","item":"banana","amount":6,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeName":"Manual","recipeId":""}]},{"rowId":"milk","item":"milk","amount":2,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"}]}],"already_have":[],"excluded":[],"source_recipes":["contrib-a"],"scale":2,"total_servings":8,"custom_order":false}'::jsonb,
      '{}'::jsonb,
      'request-replace-a',
      'add_or_replace'
    )
  $$,
  'changed servings replace the existing contribution atomically'
);

select extensions.is(
  (select servings from public.shopping_recipe_contributions where recipe_id = 'contrib-a'),
  8,
  'changed servings replace rather than add to stored servings'
);

select extensions.is(
  (select (items -> 1 ->> 'amount')::numeric from public.shopping_list),
  2::numeric,
  'changed servings replace rather than add to aggregate quantity'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      3,
      '[{"recipe_id":"contrib-a2","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Contribution A2","items":[{"bucket":"items","item":"milk","amount":3,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a2","recipeName":"Contribution A2"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[{"rowId":"legacy-banana","item":"banana","amount":6,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeName":"Manual","recipeId":""}]},{"rowId":"milk","item":"milk","amount":5,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a","recipeName":"Contribution A"},{"recipeId":"contrib-a2","recipeName":"Contribution A2"}]}],"already_have":[],"excluded":[],"source_recipes":["contrib-a","contrib-a2"],"scale":1,"total_servings":12,"custom_order":false}'::jsonb,
      '{}'::jsonb,
      'request-add-a2',
      'add_or_replace'
    )
  $$,
  'a distinct contribution can be added without replacing the first'
);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions),
  2,
  'distinct recipe contributions both survive'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      3, '[]'::jsonb, '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb, '{}'::jsonb,
      'stale-revision', 'add_or_replace'
    )
  $$,
  '40001',
  'shopping contribution revision conflict',
  'a stale concurrent projection is rejected instead of overwriting newer work'
);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      4,
      '[]'::jsonb,
      array['contrib-a'],
      '{"items":[{"rowId":"legacy-banana","item":"banana","amount":6,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeName":"Manual","recipeId":""}]},{"rowId":"milk","item":"milk","amount":3,"unit":"cup","categoryKey":"dairy","categoryOrder":5,"sources":[{"recipeId":"contrib-a2","recipeName":"Contribution A2"}]}],"already_have":[],"excluded":[],"source_recipes":["contrib-a2"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
      '{}'::jsonb,
      'request-remove-a',
      'remove'
    )
  $$,
  'removing one contribution commits its recomputed shared aggregate'
);

select extensions.is(
  (select (items -> 1 ->> 'amount')::numeric from public.shopping_list),
  3::numeric,
  'shared aggregate retains only the remaining recipe quantity'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      5,
      '[{"recipe_id":"contrib-b","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"B","items":[]}}]'::jsonb,
      '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb, '{}'::jsonb, 'invalid-owner-add', 'add_or_replace'
    )
  $$,
  '42501',
  'recipe is not owned by authenticated user',
  'User A cannot add User B recipe contribution'
);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      5, '[]'::jsonb, array['contrib-b'], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb, '{}'::jsonb,
      'invalid-owner-remove', 'remove'
    )
  $$,
  '42501',
  'recipe is not owned by authenticated user',
  'User A cannot remove User B recipe identity'
);

select extensions.throws_ok(
  $$
    insert into public.shopping_recipe_contributions (
      user_id, recipe_id, servings, scale, normalization_version, snapshot, idempotency_key
    ) values (
      '31000000-0000-0000-0000-000000000001', 'contrib-a', 4, 1, 1, '{}'::jsonb, 'direct-write'
    )
  $$,
  '42501',
  'permission denied for table shopping_recipe_contributions',
  'authenticated clients cannot bypass the command with direct contribution writes'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '32000000-0000-0000-0000-000000000002', true);

select extensions.lives_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      0,
      '[{"recipe_id":"contrib-b","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Contribution B","items":[{"bucket":"items","item":"tomato","amount":7,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeId":"contrib-b","recipeName":"Contribution B"}]}]}}]'::jsonb,
      '{}'::text[],
      '{"items":[{"rowId":"tomato","item":"tomato","amount":7,"unit":"","categoryKey":"produce","categoryOrder":1,"sources":[{"recipeId":"contrib-b","recipeName":"Contribution B"}]}],"already_have":[],"excluded":[],"source_recipes":["contrib-b"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
      '{}'::jsonb,
      'request-add-b',
      'add_or_replace'
    )
  $$,
  'User B can independently add their contribution'
);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions),
  1,
  'RLS exposes only User B contribution to User B'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-0000-0000-000000000001', true);

select extensions.is(
  (select count(*)::integer from public.shopping_recipe_contributions where recipe_id = 'contrib-b'),
  0,
  'User A cannot read User B contribution'
);

reset role;

select extensions.is(
  (
    select (sl.items -> 0 ->> 'amount')::numeric
    from public.shopping_list sl
    where sl.user_id = '32000000-0000-0000-0000-000000000002'
  ),
  7::numeric,
  'User A failed commands leave User B aggregate unchanged'
);

select extensions.is(
  (
    select sum((item ->> 'amount')::numeric)
    from public.shopping_recipe_contributions contribution,
      lateral jsonb_array_elements(contribution.snapshot -> 'items') item
    where contribution.user_id = '31000000-0000-0000-0000-000000000001'
  ),
  3::numeric,
  'remaining aggregate quantity is explainable by authoritative snapshots'
);

select extensions.is(
  (
    select count(*)::integer
    from public.shopping_contribution_commands
    where user_id = '31000000-0000-0000-0000-000000000001'
  ),
  4,
  'lost-response retry records one command identity rather than a duplicate'
);

select extensions.is(
  (
    select count(*)::integer
    from public.shopping_list,
      lateral jsonb_array_elements(items) item
    where user_id = '31000000-0000-0000-0000-000000000001'
      and item ->> 'item' = 'banana'
  ),
  1,
  'legacy manual data survives recipe add, replace, and removal'
);

select extensions.is(
  (
    select constraint_row.confdeltype::text
    from pg_constraint constraint_row
    where constraint_row.conname = 'shopping_recipe_contributions_recipe_id_fkey'
  ),
  'r',
  'recipe deletion is restricted until its shopping contribution is removed'
);

update public.shopping_list
set custom_order = custom_order
where user_id = '32000000-0000-0000-0000-000000000002';

select extensions.is(
  (
    select contribution_revision::integer
    from public.shopping_list
    where user_id = '32000000-0000-0000-0000-000000000002'
  ),
  2,
  'ordinary manual shopping updates advance the contribution revision'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.throws_ok(
  $$
    select public.apply_recipe_shopping_contribution_command(
      0, '[]'::jsonb, '{}'::text[], '{"items":[],"already_have":[],"excluded":[],"source_recipes":[]}'::jsonb, '{}'::jsonb,
      'anonymous-request', 'remove'
    )
  $$,
  '42501',
  'permission denied for function apply_recipe_shopping_contribution_command',
  'anonymous contribution command execution fails'
);

reset role;

select * from extensions.finish();

rollback;
