begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

select extensions.col_type_is(
  'public', 'recipes', 'recipe_uuid', 'uuid',
  'canonical recipe identity uses PostgreSQL uuid'
);

select extensions.col_not_null(
  'public', 'recipes', 'recipe_uuid',
  'every recipe has a canonical UUID'
);

select extensions.is(
  (
    select column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and column_name = 'recipe_uuid'
  ),
  null,
  'active recipe creation has no implicit UUID default'
);

select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname = 'recipes_recipe_uuid_key'
      and contype = 'u'
  ),
  'recipe UUIDs are globally unique'
);

select extensions.ok(
  not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.recipes'::regclass
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) ilike '%name%'
  ),
  'recipe names are not constrained as identity'
);

insert into auth.users (id, email)
values
  ('41000000-0000-0000-0000-000000000001', 'identity-a@example.test'),
  ('42000000-0000-0000-0000-000000000002', 'identity-b@example.test');

select extensions.is(
  (
    select count(distinct recipe_uuid)::integer
    from public.recipes
    where user_id in (
      '41000000-0000-0000-0000-000000000001',
      '42000000-0000-0000-0000-000000000002'
    )
  ),
  6,
  'default recipe seeding assigns distinct UUIDs across users'
);

delete from public.recipes
where user_id in (
  '41000000-0000-0000-0000-000000000001',
  '42000000-0000-0000-0000-000000000002'
);

insert into public.recipes (id, user_id, name, category)
values
  ('legacy-a-1', '41000000-0000-0000-0000-000000000001', 'Same Name', 'test'),
  ('legacy-a-2', '41000000-0000-0000-0000-000000000001', 'Same Name', 'test'),
  ('legacy-b-1', '42000000-0000-0000-0000-000000000002', 'Same Name', 'test'),
  ('legacy-punctuation', '41000000-0000-0000-0000-000000000001', U&'\96EA !!!', 'test');

select extensions.is(
  (
    select count(*)::integer
    from public.recipes
    where name = 'Same Name'
  ),
  3,
  'duplicate names are allowed within and across owners'
);

select extensions.is(
  (
    select count(distinct recipe_uuid)::integer
    from public.recipes
    where name = 'Same Name'
  ),
  3,
  'same-name recipes receive different UUIDs'
);

select extensions.ok(
  (
    select recipe_uuid is not null
    from public.recipes
    where id = 'legacy-punctuation'
  ),
  'punctuation and Unicode do not affect identity generation'
);

create temporary table identity_before_rename as
select recipe_uuid
from public.recipes
where id = 'legacy-a-1';

update public.recipes
set name = 'Freely Renamed'
where id = 'legacy-a-1';

select extensions.is(
  (select recipe_uuid from public.recipes where id = 'legacy-a-1'),
  (select recipe_uuid from identity_before_rename),
  'renaming a recipe preserves its UUID'
);

select extensions.throws_ok(
  $$
    update public.recipes
    set recipe_uuid = gen_random_uuid()
    where id = 'legacy-a-1'
  $$,
  'P0001',
  'recipe_uuid is immutable',
  'canonical UUID identity cannot be changed'
);

select extensions.throws_ok(
  format(
    'insert into public.recipes (id, recipe_uuid, user_id, name, category) values (%L, %L, %L, %L, %L)',
    'legacy-duplicate-uuid',
    (select recipe_uuid from public.recipes where id = 'legacy-a-1'),
    '41000000-0000-0000-0000-000000000001',
    'Another Name',
    'test'
  ),
  '23505',
  null,
  'a canonical UUID cannot identify two recipes'
);

insert into public.recipe_shares (
  id,
  sender_user_id,
  sender_email,
  recipient_user_id,
  recipient_email,
  source_recipe_id,
  source_recipe_snapshot
)
values (
  '43000000-0000-0000-0000-000000000003',
  '41000000-0000-0000-0000-000000000001',
  'identity-a@example.test',
  '42000000-0000-0000-0000-000000000002',
  'identity-b@example.test',
  'legacy-a-2',
  '{"name":"Same Name","category":"test","servings":4,"tags":[],"ingredients":[],"instructions":[]}'::jsonb
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '42000000-0000-0000-0000-000000000002', true);
select public.accept_recipe_share('43000000-0000-0000-0000-000000000003');
reset role;

select extensions.ok(
  (
    select accepted.recipe_uuid is not null
      and accepted.user_id = share_row.recipient_user_id
      and accepted.recipe_uuid <> source.recipe_uuid
    from public.recipe_shares share_row
    join public.recipes source on source.id = share_row.source_recipe_id
    join public.recipes accepted on accepted.id = share_row.accepted_recipe_id
    where share_row.id = '43000000-0000-0000-0000-000000000003'
  ),
  'accepted shares receive a new recipient-owned UUID'
);

select extensions.is(
  (select count(*)::integer from public.recipes where recipe_uuid is null),
  0,
  'no recipe is left without canonical identity'
);

select extensions.is(
  (select count(*)::integer from public.recipes),
  (select count(distinct recipe_uuid)::integer from public.recipes),
  'the legacy-to-UUID mapping is one-to-one'
);

select * from extensions.finish();

rollback;
