begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(41);

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
    '{"name":"Shared for A","category":"security-test","servings":2,"tags":["shared"],"ingredients":[],"instructions":[]}'::jsonb
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
    'b-malformed-source',
    '{"name":"Malformed for A","category":"security-test","servings":"many","tags":{},"ingredients":[],"instructions":[]}'::jsonb
  );

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

select extensions.ok(
  public.accept_recipe_share('a1000000-0000-0000-0000-000000000001') is not null,
  'User A can accept a share addressed to User A'
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
