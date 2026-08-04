begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(88);

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
  ingredient_sections,
  instruction_sections
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
    '[]'::jsonb
  ),
  (
    'b-owned',
    '20000000-0000-0000-0000-000000000002',
    'User B Recipe',
    'security-test',
    2,
    array['common', 'rename-b', 'merge-b', 'delete-b'],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-malformed-source',
    '20000000-0000-0000-0000-000000000002',
    'User B Malformed Share Source',
    'security-test',
    2,
    array['malformed-share-source'],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-contradictory-quantity',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Quantity Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-contradictory-package',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Package Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-oversized-rational',
    '20000000-0000-0000-0000-000000000002',
    'User B Oversized Rational Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-malformed-package',
    '20000000-0000-0000-0000-000000000002',
    'User B Malformed Package Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-contradictory-yield',
    '20000000-0000-0000-0000-000000000002',
    'User B Contradictory Yield Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-malformed-instructions',
    '20000000-0000-0000-0000-000000000002',
    'User B Malformed Instructions Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-direct-acceptance-source',
    '20000000-0000-0000-0000-000000000002',
    'User B Direct Acceptance Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-decline-source',
    '20000000-0000-0000-0000-000000000002',
    'User B Decline Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
  ),
  (
    'b-legacy-empty-source',
    '20000000-0000-0000-0000-000000000002',
    'User B Legacy Empty Source',
    'security-test',
    2,
    array[]::text[],
    '[]'::jsonb,
    '[]'::jsonb
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
      "ingredient_sections":[{"label":null,"ingredients":[{
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
      }]}],
      "instruction_sections":[
        {"label":"Finish","steps":["Serve immediately."]}
      ],
      "image_url":"",
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
    '{"name":"Shared for B","category":"security-test","servings":2,"tags":["shared"],"ingredient_sections":[],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-contradictory-quantity',
    '{"name":"Malformed for A","category":"security-test","servings":"many","tags":{},"ingredient_sections":[],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-contradictory-package',
    '{"name":"Contradictory quantity","category":"security-test","servings":2,"tags":[],"ingredient_sections":[{"label":null,"ingredients":[{"item":"sugar","amount":1,"unit":"cup","authoredUnit":"cup","quantityV1":{"version":1,"kind":"exact","authored":"9","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"9"}}]}],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-oversized-rational',
    '{"name":"Contradictory package","category":"security-test","servings":2,"tags":[],"ingredient_sections":[{"label":null,"ingredients":[{"item":"tomatoes","amount":1,"unit":"(14 oz) can","authoredUnit":"(14 oz) can","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"packageV1":{"version":1,"count":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"size":{"value":{"numerator":"14","denominator":"1"},"lexeme":"999","unit":"oz","authoredUnit":"oz"},"type":"can","authoredType":"can"}}]}],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-malformed-package',
    '{"name":"Oversized rational","category":"security-test","servings":2,"tags":[],"ingredient_sections":[{"label":null,"ingredients":[{"item":"sugar","amount":1,"unit":"cup","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1000000000000","denominator":"1"},"lexeme":"1"}}]}],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-malformed-source',
    '{"name":"Malformed package","category":"security-test","servings":2,"tags":[],"ingredient_sections":[{"label":null,"ingredients":[{"item":"tomatoes","amount":1,"unit":"can","quantityV1":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"packageV1":{"version":1,"count":{"version":1,"kind":"exact","authored":"1","source":"authored","value":{"numerator":"1","denominator":"1"},"lexeme":"1"},"size":{},"type":"can","authoredType":"can"}}]}],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000009',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-malformed-instructions',
    '{"name":"Malformed instructions","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[{"label":null,"steps":"not-an-array"}]}'::jsonb
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
values
  (
    'a1000000-0000-0000-0000-000000000010',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-direct-acceptance-source',
    '{"name":"Direct acceptance target","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000011',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-decline-source',
    '{"name":"Decline target","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb
  ),
  (
    'a1000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000002',
    'security-b@example.test',
    '10000000-0000-0000-0000-000000000001',
    'security-a@example.test',
    'b-legacy-empty-source',
    '{}'::jsonb
  );

select extensions.ok(
  not has_table_privilege(
    'authenticated',
    'public.recipe_shares',
    'UPDATE'
  )
  and has_column_privilege(
    'authenticated',
    'public.recipe_shares',
    'status',
    'UPDATE'
  )
  and has_column_privilege(
    'authenticated',
    'public.recipe_shares',
    'responded_at',
    'UPDATE'
  )
  and not has_column_privilege(
    'authenticated',
    'public.recipe_shares',
    'accepted_recipe_id',
    'UPDATE'
  )
  and not has_column_privilege(
    'authenticated',
    'public.recipe_shares',
    'accepted_recipe_uuid',
    'UPDATE'
  ),
  'authenticated callers can update only recipient response columns'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.recipe_shares', 'UPDATE'),
  'anonymous callers have no recipe-share update privilege'
);

create temporary table snapshot_validation_cases (
  description text not null,
  snapshot jsonb not null,
  expected boolean not null
);

insert into snapshot_validation_cases(description, snapshot, expected)
select description, base.snapshot || extension, expected
from (
  select
    '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb
      as snapshot
) as base
cross join lateral (values
  ('accepts empty canonical section arrays', '{}'::jsonb, true),
  ('accepts an unlabeled instruction section', '{"instruction_sections":[{"label":null,"steps":["Whisk."]}]}'::jsonb, true),
  ('accepts a labeled instruction section', '{"instruction_sections":[{"label":"Sauce","steps":["Whisk."]}]}'::jsonb, true),
  ('rejects legacy ingredients', '{"ingredients":[]}'::jsonb, false),
  ('rejects legacy instructions', '{"instructions":[]}'::jsonb, false),
  ('rejects legacy instruction groups', '{"instruction_groups":[]}'::jsonb, false),
  ('rejects null section entries', '{"instruction_sections":[null]}'::jsonb, false),
  ('rejects array section entries', '{"instruction_sections":[[]]}'::jsonb, false),
  ('rejects scalar section entries', '{"instruction_sections":["section"]}'::jsonb, false),
  ('rejects unsupported section fields', '{"instruction_sections":[{"name":"Sauce","label":"Sauce","steps":["Whisk."]}]}'::jsonb, false),
  ('rejects missing steps', '{"instruction_sections":[{"label":"Sauce"}]}'::jsonb, false),
  ('rejects null steps', '{"instruction_sections":[{"label":null,"steps":null}]}'::jsonb, false),
  ('rejects object steps', '{"instruction_sections":[{"label":null,"steps":{}}]}'::jsonb, false),
  ('rejects string steps', '{"instruction_sections":[{"label":null,"steps":"Cook."}]}'::jsonb, false),
  ('rejects boolean steps', '{"instruction_sections":[{"label":null,"steps":true}]}'::jsonb, false),
  ('rejects empty sections', '{"instruction_sections":[{"label":null,"steps":[]}]}'::jsonb, false),
  ('rejects empty labels', '{"instruction_sections":[{"label":" ","steps":["Cook."]}]}'::jsonb, false),
  ('rejects object step entries', '{"instruction_sections":[{"label":null,"steps":[{"text":"Cook."}]}]}'::jsonb, false),
  ('rejects invalid image URLs', '{"image_url":false}'::jsonb, false)
) as cases(description, extension, expected);

insert into snapshot_validation_cases(description, snapshot, expected)
select
  'rejects oversized group arrays',
  base.snapshot || jsonb_build_object(
    'instruction_sections',
    (
      select jsonb_agg(jsonb_build_object('label', null, 'steps', jsonb_build_array('Cook.')))
      from generate_series(1, 501)
    )
  ),
  false
from (
  select '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb as snapshot
) as base
union all
select
  'rejects oversized step arrays',
  base.snapshot || jsonb_build_object(
    'instruction_sections',
    jsonb_build_array(jsonb_build_object(
      'steps',
      (select jsonb_agg('Cook.'::text) from generate_series(1, 2001))
    ))
  ),
  false
from (
  select '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb as snapshot
) as base
union all
select
  'rejects oversized labels',
  base.snapshot || jsonb_build_object(
    'instruction_sections',
    jsonb_build_array(jsonb_build_object(
      'label', repeat('x', 129),
      'steps', jsonb_build_array('Cook.')
    ))
  ),
  false
from (
  select '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb as snapshot
) as base
union all
select
  'rejects oversized step strings',
  base.snapshot || jsonb_build_object(
    'instruction_sections',
    jsonb_build_array(jsonb_build_object(
      'steps', jsonb_build_array(repeat('x', 10001))
    ))
  ),
  false
from (
  select '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb as snapshot
) as base
union all
select
  'rejects oversized image URLs',
  base.snapshot || jsonb_build_object('image_url', repeat('x', 8193)),
  false
from (
  select '{"name":"Snapshot case","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[]}'::jsonb as snapshot
) as base;

select extensions.is(
  private.recipe_share_snapshot_is_valid(snapshot),
  expected,
  description
)
from snapshot_validation_cases
order by description;

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
      '{"name":"Contradictory yield","category":"security-test","servings":2,"tags":[],"ingredient_sections":[],"instruction_sections":[],"yield_metadata":{"version":1,"authoredText":"9 servings","kind":"servings","scalingBasis":{"numerator":"2","denominator":"1"},"value":{"numerator":"2","denominator":"1"}}}'::jsonb
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

select extensions.throws_ok(
  $$
    update public.recipe_shares
    set status = 'accepted', responded_at = now()
    where id = 'a1000000-0000-0000-0000-000000000010'
  $$,
  '42501',
  'new row violates row-level security policy for table "recipe_shares"',
  'a recipient cannot directly transition a pending share to accepted'
);

select extensions.throws_ok(
  $$
    update public.recipe_shares
    set
      status = 'accepted',
      responded_at = now(),
      accepted_recipe_uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    where id = 'a1000000-0000-0000-0000-000000000010'
  $$,
  '42501',
  'permission denied for table recipe_shares',
  'a recipient cannot directly write privileged acceptance metadata'
);

select extensions.results_eq(
  $$
    select
      status,
      responded_at is null,
      accepted_recipe_id is null,
      accepted_recipe_uuid is null
    from public.recipe_shares
    where id = 'a1000000-0000-0000-0000-000000000010'
  $$,
  $$ values ('pending'::text, true, true, true) $$,
  'direct acceptance attempts leave the pending share unchanged'
);

select extensions.results_eq(
  $$
    update public.recipe_shares
    set status = 'declined', responded_at = now()
    where id = 'a1000000-0000-0000-0000-000000000011'
    returning
      status,
      responded_at is not null,
      accepted_recipe_id is null,
      accepted_recipe_uuid is null
  $$,
  $$ values ('declined'::text, true, true, true) $$,
  'a recipient can still decline a pending share without acceptance metadata'
);

select extensions.throws_ok(
  $$
    update public.recipe_shares
    set status = 'declined', responded_at = now()
    where id = 'b2000000-0000-0000-0000-000000000002'
    returning id
  $$,
  '42501',
  'new row violates row-level security policy for table "recipe_shares"',
  'a non-recipient cannot alter another user share'
);

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

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000009') $$,
  'P0001',
  'Invalid recipe snapshot',
  'malformed instruction groups cannot cross the privileged RPC'
);

select extensions.ok(
  public.accept_recipe_share('a1000000-0000-0000-0000-000000000001') is not null,
  'User A can accept a share addressed to User A'
);

select extensions.ok(
  (
    select ingredient_sections #>> '{0,ingredients,0,quantityV1,authored}' = '0.50'
      and ingredient_sections #>> '{0,ingredients,0,quantityV1,value,numerator}' = '1'
      and yield_metadata->>'authoredText' = '2 servings'
      and instruction_sections #>> '{0,label}' = 'Finish'
      and instruction_sections #>> '{0,steps,0}' = 'Serve immediately.'
      and image_url is null
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
  public.accept_recipe_share('a1000000-0000-0000-0000-000000000001'),
  (
    select accepted_recipe_uuid
    from public.recipe_shares
    where id = 'a1000000-0000-0000-0000-000000000001'
  ),
  'accepted structured share retries return the existing recipe UUID'
);

select extensions.is(
  (
    select count(*)
    from public.recipes
    where user_id = '10000000-0000-0000-0000-000000000001'
      and name = 'Shared for A'
  ),
  1::bigint,
  'accepted structured share retries create no duplicate recipe'
);

select extensions.throws_ok(
  $$ select public.accept_recipe_share('a1000000-0000-0000-0000-000000000012') $$,
  'P0001', 'Invalid recipe snapshot',
  'empty legacy snapshots are rejected'
);

select extensions.is(
  (select status from public.recipe_shares where id = 'a1000000-0000-0000-0000-000000000012'),
  'pending',
  'empty snapshot rejection leaves the share pending'
);

select extensions.is(
  (select accepted_recipe_uuid from public.recipe_shares where id = 'a1000000-0000-0000-0000-000000000012'),
  null::uuid,
  'empty snapshot rejection creates no accepted identity'
);

select extensions.is(
  (select count(*) from public.recipes where user_id = '10000000-0000-0000-0000-000000000001' and name = 'Shared Recipe'),
  0::bigint,
  'empty snapshot rejection creates no recipe'
);

select extensions.is(
  (
    select count(*)
    from public.recipe_shares
    where id in (
      'a1000000-0000-0000-0000-000000000003',
      'a1000000-0000-0000-0000-000000000004',
      'a1000000-0000-0000-0000-000000000005',
      'a1000000-0000-0000-0000-000000000006',
      'a1000000-0000-0000-0000-000000000007',
      'a1000000-0000-0000-0000-000000000008',
      'a1000000-0000-0000-0000-000000000009'
    )
      and status = 'pending'
  ),
  7::bigint,
  'rejected share acceptance leaves every malformed share pending'
);

select extensions.is(
  (
    select count(*)
    from public.recipes
    where name in (
      'Malformed for A',
      'Contradictory quantity',
      'Contradictory package',
      'Oversized rational',
      'Malformed package',
      'Contradictory yield',
      'Malformed instructions'
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
