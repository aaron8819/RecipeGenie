begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(39);

insert into auth.users(id, email) values
  ('71000000-0000-4000-8000-000000000001', 'stage2b-a@example.test'),
  ('72000000-0000-4000-8000-000000000002', 'stage2b-b@example.test');

delete from public.recipes where user_id in (
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000002'
);

insert into public.recipes(
  id, recipe_uuid, user_id, name, category, servings, ingredients, instructions
) values
  ('71111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111',
    '71000000-0000-4000-8000-000000000001', 'Same Name', 'test', 4, '[]', '{}'),
  ('71222222-2222-4222-8222-222222222222', '71222222-2222-4222-8222-222222222222',
    '71000000-0000-4000-8000-000000000001', 'Same Name', 'test', 4, '[]', '{}'),
  ('72333333-3333-4333-8333-333333333333', '72333333-3333-4333-8333-333333333333',
    '72000000-0000-4000-8000-000000000002', 'Same Name', 'test', 4, '[]', '{}');

select extensions.is(
  (select count(*)::integer from public.recipes where name = 'Same Name'), 3,
  'duplicate names are allowed within and across owners'
);
select extensions.is(
  (select count(distinct recipe_uuid)::integer from public.recipes where name = 'Same Name'), 3,
  'duplicate names retain distinct UUID identities'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok($$
  insert into public.weekly_plans(
    user_id, week_date, recipe_uuids, day_assignment_recipe_uuids, made_recipe_uuids
  ) values (
    auth.uid(), '2026-07-20',
    array['71222222-2222-4222-8222-222222222222'::uuid, '71111111-1111-4111-8111-111111111111'::uuid],
    '{"71111111-1111-4111-8111-111111111111":{"day":2},"71222222-2222-4222-8222-222222222222":[4,5]}'::jsonb,
    array['71111111-1111-4111-8111-111111111111'::uuid]
  )
$$, 'UUID-first planner insert succeeds');
select extensions.is(
  (select recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = '2026-07-20'),
  array['71222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111'],
  'UUID-first planner membership derives ordered legacy compatibility'
);
select extensions.is(
  (select day_assignments from public.weekly_plans where user_id = auth.uid() and week_date = '2026-07-20'),
  '{"71111111-1111-4111-8111-111111111111":{"day":2},"71222222-2222-4222-8222-222222222222":[4,5]}'::jsonb,
  'UUID-first planner assignments preserve JSON values'
);
select extensions.is(
  (select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = '2026-07-20'),
  array['71111111-1111-4111-8111-111111111111'],
  'UUID-first made-state derives legacy compatibility'
);

select extensions.lives_ok($$
  update public.weekly_plans
  set recipe_ids = array['71111111-1111-4111-8111-111111111111']
  where user_id = auth.uid() and week_date = '2026-07-20'
$$, 'old application legacy-first planner update still succeeds');
select extensions.is(
  (select recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = '2026-07-20'),
  array['71111111-1111-4111-8111-111111111111'::uuid],
  'legacy-first planner update derives UUID membership'
);
select extensions.throws_ok($$
  insert into public.weekly_plans(user_id, week_date, recipe_ids, recipe_uuids)
  values (
    auth.uid(), '2026-07-27',
    array['71111111-1111-4111-8111-111111111111'],
    array['71222222-2222-4222-8222-222222222222'::uuid]
  )
$$, '23503', 'weekly plan legacy and UUID memberships disagree',
  'inconsistent planner identity pair rejects');

select extensions.lives_ok($$
  insert into public.plan_templates(
    user_id, name, recipe_uuids, day_assignment_recipe_uuids
  ) values (
    auth.uid(), 'Two same names',
    array['71111111-1111-4111-8111-111111111111'::uuid, '71222222-2222-4222-8222-222222222222'::uuid],
    '{"71111111-1111-4111-8111-111111111111":1,"71222222-2222-4222-8222-222222222222":6}'::jsonb
  )
$$, 'UUID-first template insert succeeds');
select extensions.is(
  (select recipe_ids from public.plan_templates where user_id = auth.uid() and name = 'Two same names'),
  array['71111111-1111-4111-8111-111111111111', '71222222-2222-4222-8222-222222222222'],
  'template same-name membership remains ordered and distinct'
);
select extensions.is(
  (select day_assignments from public.plan_templates where user_id = auth.uid() and name = 'Two same names'),
  '{"71111111-1111-4111-8111-111111111111":1,"71222222-2222-4222-8222-222222222222":6}'::jsonb,
  'template assignment values are preserved'
);

select extensions.lives_ok($$
  insert into public.recipe_history(user_id, recipe_uuid, date_made)
  values (auth.uid(), '71111111-1111-4111-8111-111111111111', '2026-07-17T12:00:00Z')
$$, 'UUID-first active history insert succeeds');
select extensions.is(
  (select recipe_id from public.recipe_history where user_id = auth.uid() and recipe_uuid = '71111111-1111-4111-8111-111111111111'),
  '71111111-1111-4111-8111-111111111111',
  'UUID-first history derives legacy evidence'
);
select extensions.is(
  public.resolve_recipe_identity('71111111-1111-4111-8111-111111111111', null),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'resolver prefers and returns canonical UUID'
);
select extensions.is(
  public.resolve_recipe_identity(null, '71111111-1111-4111-8111-111111111111'),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'resolver supports one explicit same-owner legacy compatibility input'
);
select extensions.is(
  public.resolve_recipe_identity(
    '71111111-1111-4111-8111-111111111111',
    '71111111-1111-4111-8111-111111111111'
  ),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'matching resolver pair succeeds'
);
select extensions.throws_ok($$
  select public.resolve_recipe_identity(
    '71111111-1111-4111-8111-111111111111',
    '71222222-2222-4222-8222-222222222222'
  )
$$, '23503', 'recipe UUID and legacy identity disagree', 'resolver mismatch rejects');
select extensions.throws_ok($$
  select public.resolve_recipe_identity('72333333-3333-4333-8333-333333333333', null)
$$, '23503', 'recipe UUID is unresolved or belongs to another user',
  'resolver rejects another owner UUID');

select extensions.lives_ok($$
  insert into public.recipe_shares(
    sender_user_id, sender_email, recipient_user_id, recipient_email,
    source_recipe_uuid, source_recipe_snapshot, status
  ) values (
    auth.uid(), 'stage2b-a@example.test',
    '72000000-0000-4000-8000-000000000002', 'stage2b-b@example.test',
    '71111111-1111-4111-8111-111111111111',
    '{"name":"Same Name","category":"test","servings":4,"tags":[],"ingredients":[],"instructions":[]}'::jsonb,
    'pending'
  )
$$, 'UUID-first share creation succeeds');
select extensions.is(
  (select source_recipe_id from public.recipe_shares where sender_user_id = auth.uid()),
  '71111111-1111-4111-8111-111111111111',
  'UUID-first share derives legacy source metadata'
);

select extensions.lives_ok($$
  select public.apply_recipe_shopping_contribution_uuid_command(
    0,
    '[{"recipe_uuid":"71111111-1111-4111-8111-111111111111","servings":4,"scale":1,"normalization_version":1,"snapshot":{"recipeName":"Same Name","items":[]}}]'::jsonb,
    '{}'::uuid[],
    '{"items":[],"already_have":[],"excluded":[],"source_recipe_uuids":["71111111-1111-4111-8111-111111111111"],"scale":1,"total_servings":4,"custom_order":false}'::jsonb,
    '{}'::jsonb, 'stage2b-shopping-command', 'add_or_replace'
  )
$$, 'UUID shopping contribution command succeeds');
select extensions.is(
  (select recipe_uuid from public.shopping_recipe_contributions where user_id = auth.uid()),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'shopping contribution natural identity is UUID'
);
select extensions.is(
  (select recipe_id from public.shopping_recipe_contributions where user_id = auth.uid()),
  '71111111-1111-4111-8111-111111111111',
  'shopping contribution legacy compatibility is synchronized'
);
select extensions.is(
  (select source_recipe_uuids from public.shopping_list where user_id = auth.uid()),
  array['71111111-1111-4111-8111-111111111111'::uuid],
  'shopping projection stores UUID source authority'
);
select extensions.lives_ok($$
  update public.shopping_list
  set items = '[{"item":"direct edit","sources":[{"recipeId":"71111111-1111-4111-8111-111111111111","recipeName":"Display"}]}]'::jsonb
  where user_id = auth.uid()
$$, 'direct application shopping edit accepts UUID provenance');
select extensions.ok(
  (
    select items #>> '{0,sources,0,recipeUuid}' = '71111111-1111-4111-8111-111111111111'
      and items #>> '{0,sources,0,recipeId}' = '71111111-1111-4111-8111-111111111111'
    from public.shopping_list where user_id = auth.uid()
  ),
  'database derives legacy shopping provenance while preserving UUID authority'
);

select extensions.lives_ok($$
  update public.recipes set name = 'Renamed ! Unicode café' where recipe_uuid = '71111111-1111-4111-8111-111111111111'
$$, 'renaming a recipe succeeds');
select extensions.is(
  (select recipe_uuid from public.recipes where name = 'Renamed ! Unicode café'),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'rename preserves UUID identity'
);
select extensions.throws_ok($$
  update public.recipes set id = 'changed-alias' where recipe_uuid = '71111111-1111-4111-8111-111111111111'
$$, '23514', 'legacy recipe alias is immutable', 'legacy alias is immutable');

select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
select extensions.isnt(
  public.accept_recipe_share((select id from public.recipe_shares where status = 'pending')),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'accepted share receives a distinct recipient-owned UUID'
);
select extensions.ok(
  exists(select 1 from public.recipe_shares where status = 'accepted' and accepted_recipe_uuid is not null),
  'accepted-copy UUID is stored on the share'
);
select extensions.ok(
  exists(
    select 1 from public.recipe_shares share
    join public.recipes recipe on recipe.recipe_uuid = share.accepted_recipe_uuid
    where recipe.user_id = auth.uid()
  ),
  'accepted-copy UUID belongs to the recipient'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select extensions.throws_ok($$
  select public.resolve_recipe_identity('71111111-1111-4111-8111-111111111111', null)
$$, '42501', 'permission denied for function resolve_recipe_identity',
  'anonymous cannot execute compatibility resolver');
select extensions.throws_ok($$
  select public.toggle_weekly_recipe_made(
    '71111111-1111-4111-8111-111111111111'::uuid, '2026-07-20', false, null
  )
$$, '42501', 'permission denied for function toggle_weekly_recipe_made',
  'anonymous cannot execute UUID made-state command');

reset role;
select extensions.ok(
  not has_function_privilege('anon', 'private.resolve_owned_recipe_legacy_id(uuid,uuid)', 'EXECUTE'),
  'anonymous cannot execute private UUID resolver'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'private.resolve_owned_recipe_legacy_id(uuid,uuid)', 'EXECUTE'),
  'authenticated cannot execute private UUID resolver directly'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.resolve_recipe_identity(uuid,text)', 'EXECUTE'),
  'authenticated may execute explicit compatibility resolver'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)',
    'EXECUTE'
  ),
  'authenticated may execute UUID shopping command'
);

select * from extensions.finish();
rollback;
