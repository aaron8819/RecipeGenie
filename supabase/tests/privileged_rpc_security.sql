begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(50);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'security-a@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'security-b@example.test');

select extensions.is(
  (select count(*)::integer from public.recipes where user_id = '10000000-0000-0000-0000-000000000001'),
  3,
  'the trusted signup trigger seeds User A defaults'
);

select extensions.is(
  (select count(*)::integer from public.recipes where user_id = '20000000-0000-0000-0000-000000000002'),
  3,
  'the trusted signup trigger seeds User B defaults'
);

select extensions.ok(
  to_regprocedure('public.insert_default_recipes_for_user(uuid)') is null,
  'the caller-selectable default seeding helper is removed'
);

delete from public.recipes
where user_id in (
  '10000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002'
);

insert into public.recipes (
  id,
  user_id,
  name,
  category,
  servings,
  tags,
  ingredients,
  instructions
)
values
  (
    'a-owned',
    '10000000-0000-0000-0000-000000000001',
    'User A Recipe',
    'security-test',
    2,
    array['common', 'rename-a', 'merge-a', 'delete-a'],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-owned',
    '20000000-0000-0000-0000-000000000002',
    'User B Recipe',
    'security-test',
    2,
    array['common', 'rename-b', 'merge-b', 'delete-b'],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-malformed-source',
    '20000000-0000-0000-0000-000000000002',
    'User B Malformed Share Source',
    'security-test',
    2,
    array['malformed-share-source'],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-contradictory-quantity',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Quantity Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-contradictory-package',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Package Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-oversized-rational',
    '20000000-0000-0000-0000-000000000002',
    'User B Oversized Rational Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-malformed-package',
    '20000000-0000-0000-0000-000000000002',
    'User B Malformed Package Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '{}'::text[]
  ),
  (
    'b-contradictory-yield',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Yield Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '{}'::text[]
  );

insert into public.recipe_history (user_id, recipe_id, date_made)
values
  ('10000000-0000-0000-0000-000000000001', 'a-owned', '2026-07-10T12:00:00Z'),
  ('10000000-0000-0000-0000-000000000001', 'a-owned', '2026-07-11T12:00:00Z'),
  ('20000000-0000-0000-0000-000000000002', 'b-owned', '2026-07-12T12:00:00Z');

insert into public.recipe_shares (
  id,
  sender_user_id,
  sender_email,
  recipient_user_id,
  recipient_email,
  source_recipe_id,
  source_recipe_snapshot
)
values
  (
    'a1000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-owned',
    '{
      "name":"Shared for A",
      "category":"security-test",
      "servings":2,
      "tags":["shared"],
      "ingredients":[{
        "item":"sugar",
        "amount":0.5,
        "unit":"cup",
        "authoredUnit":"cups",
        "quantityV1":{
          "version":1,
          "kind":"exact",
          "authored":"0.50",
          "source":"authored",
          "value":{"numerator":"1","denominator":"2"},
          "lexeme":"0.50"
        }
      }],
      "instructions":[],
      "yield_metadata":{
        "version":1,
        "authoredText":"2 servings",
        "kind":"servings",
        "scalingBasis":{"numerator":"2","denominator":"1"},
        "value":{"numerator":"2","denominator":"1"}
      }
    }'::jsonb
  ),
  (
    'b2000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    'a-owned',
    '{"name":"Shared for B","category":"security-test","servings":2,"tags":["shared"],"ingredients":[],"instructions":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-contradictory-quantity',
    '{"name":"Malformed for A","category":"security-test","servings":"many","tags":{},"ingredients":[],"instructions":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-contradictory-package',
    '{"name":"Contradictory quantity","category":"security-test","servings":2,"tags":[],"ingredients":[{"item":"sugar","amount":1,"unit":"cup","authoredUnit":"cup","quantityV1":{"version":1,"kind":"exact","authored":"9","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"9"}}],"instructions":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-oversized-rational',
    '{"name":"Contradictory package","category":"security-test","servings":2,"tags":[],"ingredients":[{"item":"tomatoes","amount":1,"unit":"(14 oz) can","authoredUnit":"(14 oz) can","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"packageV1":{"version":1,"count":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"size":{"value":{"numerator":"14","denominator":"1"},"lexeme":"999","unit":"oz","authoredUnit":"oz"},"type":"can","authoredType":"can"}}],"instructions":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-malformed-package',
    '{"name":"Oversized rational","category":"security-test","servings":2,"tags":[],"ingredients":[{"item":"sugar","amount":1,"unit":"cup","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1000000000000","denominator":"1"},"lexeme":"1"}}],"instructions":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-malformed-source',
    '{"name":"Malformed package","category":"security-test","servings":2,"tags":[],"ingredients":[{"item":"tomatoes","amount":1,"unit":"can","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"packageV1":{"version":1,"count":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"size":{},"type":"can","authoredType":"can"}}],"instructions":[]}'::jsonb
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);

select extensions.lives_ok(
  $$
    insert into public.recipe_shares (
      id,
      sender_user_id,
      sender_email,
      recipient_user_id,
      recipient_email,
      source_recipe_id,
      source_recipe_uuid,
      source_recipe_snapshot
    )
    select
      'a1000000-0000-0000-0000-000000000008',
      auth.uid(),
      'security-b@example.test',
      '10000000-0000-0000-0000-000000000001',
      'security-a@example.test',
      id,
      recipe_uuid,
      '{"name":"Contradictory yield","category":"security-test","servings":2,"tags":[],"ingredients":[],"instructions":[],"yield_metadata":{"version":1,"authoredText":"9 servings","kind":"servings","scalingBasis":{"numerator":"2","denominator":"1"},"value":{"numerator":"2","denominator":"1"}}}'::jsonb
    from public.recipes
    where id = 'b-contradictory-yield'
  $$,
  'an authenticated sender can directly insert a share snapshot permitted by RLS'
);

reset role;

create temporary table user_b_recipe_before as
select to_jsonb(recipe) as row_data
from public.recipes as recipe
where recipe.id = 'b-owned';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select extensions.results_eq(
  $$ select id from public.filter_recipes_by_tags(array['common']) $$,
  $$ values ('a-owned'::text) $$,
  'User A tag filtering returns only User A data'
);

select extensions.results_eq(
  $$ select recipe_id, times_made from public.get_recipe_history_stats() $$,
  $$ select recipe_uuid, 2::integer from public.recipes where id = 'a-owned' $$,
  'User A history statistics return only User A data'
);

select extensions.is(
  (
    select count(*)::integer
    from public.recipes
    where user_id = '20000000-0000-0000-0000-000000000002'
  ),
  0,
  'direct table RLS hides User B recipes from User A'
);

select extensions.is_empty(
  $$
    update public.recipes
    set name = 'tampered by User A'
    where user_id = '20000000-0000-0000-0000-000000000002'
    returning 1
  $$,
  'direct table RLS prevents User A from mutating User B recipes'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('b2000000-0000-0000-0000-000000000002') $$,
  'P0001',
  'Share not found',
  'User A cannot accept a share addressed to User B'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000003') $$,
  'P0001',
  'Invalid recipe snapshot',
  'malformed shared JSON is rejected without leaking a cast or iterator error'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000004') $$,
  'P0001',
  'Invalid recipe snapshot',
  'contradictory authored quantity metadata cannot cross the share boundary'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000005') $$,
  'P0001',
  'Invalid recipe snapshot',
  'contradictory package-size metadata cannot cross the share boundary'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000006') $$,
  'P0001',
  'Invalid recipe snapshot',
  'oversized structured rationals cannot cross the share boundary'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000007') $$,
  'P0001',
  'Invalid recipe snapshot',
  'malformed nested package metadata cannot cross the share boundary'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000008') $$,
  'P0001',
  'Invalid recipe snapshot',
  'a directly inserted contradictory yield cannot cross the privileged RPC'
);

select extensions.ok(
  public.accept_recipe_share('a1000000-0000-0000-0000-000000000001') is not null,
  'User A can accept a share addressed to User A'
);

select extensions.ok(
  (
    select ingredients #>> '{0,quantityV1,authored}' = '0.50'
      and ingredients #>> '{0,quantityV1,value,numerator}' = '1'
      and yield_metadata->>'authoredText' = '2 servings'
    from public.recipes
    where recipe_uuid = (
      select accepted_recipe_uuid
      from public.recipe_shares
      where id = 'a1000000-0000-0000-0000-000000000001'
    )
  ),
  'valid structured ingredient and yield metadata is preserved atomically'
);

select extensions.is(
  (
    select count(*)
    from public.recipe_shares
    where id in (
      'a1000000-0000-0000-0000-000000000004',
      'a1000000-0000-0000-0000-000000000005',
      'a1000000-0000-0000-0000-000000000006',
      'a1000000-0000-0000-0000-000000000007',
      'a1000000-0000-0000-0000-000000000008'
    )
      and status = 'pending'
  ),
  5::bigint,
  'rejected share acceptance leaves every malformed share pending'
);

select extensions.is(
  (
    select count(*)
    from public.recipes
    where name in (
      'Contradictory quantity',
      'Contradictory package',
      'Oversized rational',
      'Malformed package',
      'Contradictory yield'
    )
  ),
  0::bigint,
  'rejected share acceptance persists no partial recipient recipe'
);

select extensions.lives_ok(
  $$ select public.rename_tag('rename-a', 'renamed-a') $$,
  'User A can rename User A tags'
);

select extensions.lives_ok(
  $$ select public.merge_tags('merge-a', 'merged-a') $$,
  'User A can merge User A tags'
);

select extensions.lives_ok(
  $$ select public.delete_tag('delete-a') $$,
  'User A can delete User A tags'
);

select extensions.results_eq(
  $$
    select tags @> array['common', 'renamed-a', 'merged-a']
      and not tags && array['rename-a', 'merge-a', 'delete-a']
    from public.recipes
    where id = 'a-owned'
  $$,
  $$ values (true) $$,
  'User A mutations produce the expected User A tags'
);

reset role;

select extensions.is(
  (select to_jsonb(recipe) from public.recipes as recipe where recipe.id = 'b-owned'),
  (select row_data from user_b_recipe_before),
  'User A RPC mutations leave the complete User B recipe row unchanged'
);

select extensions.results_eq(
  $$
    select status, accepted_recipe_id is null
    from public.recipe_shares
    where id = 'b2000000-0000-0000-0000-000000000002'
  $$,
  $$ values ('pending'::text, true) $$,
  'User A cannot mutate User B pending share state'
);

select extensions.is(
  (
    select count(*)::integer
    from public.recipes
    where user_id = '10000000-0000-0000-0000-000000000001'
      and name = 'Shared for A'
  ),
  1,
  'accepting a share creates the recipe only for User A'
);

create temporary table user_a_recipe_after as
select to_jsonb(recipe) as row_data
from public.recipes as recipe
where recipe.id = 'a-owned';

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);

select extensions.results_eq(
  $$ select id from public.filter_recipes_by_tags(array['common']) $$,
  $$ values ('b-owned'::text) $$,
  'User B tag filtering returns only User B data'
);

select extensions.results_eq(
  $$ select recipe_id, times_made from public.get_recipe_history_stats() $$,
  $$ select recipe_uuid, 1::integer from public.recipes where id = 'b-owned' $$,
  'User B history statistics return only User B data'
);

select extensions.is(
  (
    select count(*)::integer
    from public.recipes
    where user_id = '10000000-0000-0000-0000-000000000001'
  ),
  0,
  'direct table RLS hides User A recipes from User B'
);

select extensions.is_empty(
  $$
    update public.recipes
    set name = 'tampered by User B'
    where user_id = '10000000-0000-0000-0000-000000000001'
    returning 1
  $$,
  'direct table RLS prevents User B from mutating User A recipes'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000001') $$,
  'P0001',
  'Share not found',
  'User B cannot access the share addressed to User A'
);

select extensions.ok(
  public.accept_recipe_share('b2000000-0000-0000-0000-000000000002') is not null,
  'User B can accept a share addressed to User B'
);

select extensions.lives_ok(
  $$ select public.rename_tag('rename-b', 'renamed-b') $$,
  'User B can rename User B tags'
);

select extensions.lives_ok(
  $$ select public.merge_tags('merge-b', 'merged-b') $$,
  'User B can merge User B tags'
);

select extensions.lives_ok(
  $$ select public.delete_tag('delete-b') $$,
  'User B can delete User B tags'
);

select extensions.results_eq(
  $$
    select tags @> array['common', 'renamed-b', 'merged-b']
      and not tags && array['rename-b', 'merge-b', 'delete-b']
    from public.recipes
    where id = 'b-owned'
  $$,
  $$ values (true) $$,
  'User B mutations produce the expected User B tags'
);

reset role;

select extensions.is(
  (select to_jsonb(recipe) from public.recipes as recipe where recipe.id = 'a-owned'),
  (select row_data from user_a_recipe_after),
  'User B RPC mutations leave the complete User A recipe row unchanged'
);

select extensions.is(
  (
    select count(*)::integer
    from public.recipes
    where user_id = '20000000-0000-0000-0000-000000000002'
      and name = 'Shared for B'
  ),
  1,
  'accepting a share creates the recipe only for User B'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);

select extensions.throws_ok(
  $$ select public.delete_tag('common') $$,
  '42501',
  'permission denied for function delete_tag',
  'anonymous callers cannot delete tags'
);

select extensions.throws_ok(
  $$ select * from public.filter_recipes_by_tags(array['common']) $$,
  '42501',
  'permission denied for function filter_recipes_by_tags',
  'anonymous callers cannot filter user recipes'
);

select extensions.throws_ok(
  $$ select * from public.get_recipe_history_stats() $$,
  '42501',
  'permission denied for function get_recipe_history_stats',
  'anonymous callers cannot read history statistics'
);

select extensions.throws_ok(
  $$ select public.merge_tags('common', 'other') $$,
  '42501',
  'permission denied for function merge_tags',
  'anonymous callers cannot merge tags'
);

select extensions.throws_ok(
  $$ select public.rename_tag('common', 'other') $$,
  '42501',
  'permission denied for function rename_tag',
  'anonymous callers cannot rename tags'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000001') $$,
  '42501',
  'permission denied for function accept_recipe_share',
  'anonymous callers cannot accept recipe shares'
);

reset role;

select extensions.ok(to_regprocedure('public.delete_tag(uuid,text)') is null, 'legacy delete_tag signature is absent');
select extensions.ok(to_regprocedure('public.filter_recipes_by_tags(uuid,text[])') is null, 'legacy filter signature is absent');
select extensions.ok(to_regprocedure('public.get_recipe_history_stats(uuid)') is null, 'legacy stats signature is absent');
select extensions.ok(to_regprocedure('public.merge_tags(uuid,text,text)') is null, 'legacy merge signature is absent');
select extensions.ok(to_regprocedure('public.rename_tag(uuid,text,text)') is null, 'legacy rename signature is absent');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

select extensions.throws_ok(
  $$
    select public.delete_tag(
      '20000000-0000-0000-0000-000000000002'::uuid,
      'common'::text
    )
  $$,
  '42883',
  'function public.delete_tag(uuid, text) does not exist',
  'passing User B identity cannot alter User A authorization'
);

reset role;

select * from extensions.finish();

rollback;
