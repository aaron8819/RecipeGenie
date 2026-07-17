begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

create function private.test_active_recipe_reference_counts()
returns jsonb
language sql
stable
set search_path = ''
as $$
  with unresolved as (
    select 'membership'::text as kind
    from public.weekly_plans as plan
    cross join lateral unnest(plan.recipe_ids) as recipe_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = recipe_id
    )
    union all
    select 'assignment'
    from public.weekly_plans as plan
    cross join lateral jsonb_object_keys(coalesce(plan.day_assignments, '{}'::jsonb)) as recipe_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = recipe_id
    )
    union all
    select 'made'
    from public.weekly_plans as plan
    cross join lateral unnest(coalesce(plan.made_recipe_ids, '{}'::text[])) as recipe_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = recipe_id
    )
  )
  select jsonb_build_array(
    count(*) filter (where kind = 'membership'),
    count(*) filter (where kind = 'assignment'),
    count(*) filter (where kind = 'made')
  ) from unresolved;
$$;

insert into auth.users(id, email) values
  ('71000000-0000-4000-8000-000000000001', 'deletion-owner-a@example.test'),
  ('72000000-0000-4000-8000-000000000002', 'deletion-owner-b@example.test');

insert into public.recipes(
  id, recipe_uuid, user_id, name, category, servings, ingredients, instructions
) values
  ('71111111-1111-4111-8111-111111111111', '71111111-1111-4111-8111-111111111111',
   '71000000-0000-4000-8000-000000000001', 'Delete target', 'test', 4, '[]', '{}'),
  ('71222222-2222-4222-8222-222222222222', '71222222-2222-4222-8222-222222222222',
   '71000000-0000-4000-8000-000000000001', 'Keep target', 'test', 4, '[]', '{}'),
  ('71333333-3333-4333-8333-333333333333', '71333333-3333-4333-8333-333333333333',
   '71000000-0000-4000-8000-000000000001', 'Defect fixture', 'test', 4, '[]', '{}'),
  ('72444444-4444-4444-8244-444444444444', '72444444-4444-4444-8244-444444444444',
   '72000000-0000-4000-8000-000000000002', 'Other owner', 'test', 4, '[]', '{}');

insert into public.weekly_plans(
  user_id, week_date, recipe_uuids, day_assignment_recipe_uuids, made_recipe_uuids
) values (
  '71000000-0000-4000-8000-000000000001', date '2098-01-05',
  array[
    '71222222-2222-4222-8222-222222222222'::uuid,
    '71111111-1111-4111-8111-111111111111'::uuid
  ],
  '{"71111111-1111-4111-8111-111111111111":2,"71222222-2222-4222-8222-222222222222":4}',
  array[
    '71111111-1111-4111-8111-111111111111'::uuid,
    '71222222-2222-4222-8222-222222222222'::uuid
  ]
), (
  '71000000-0000-4000-8000-000000000001', date '2098-01-12',
  array['71222222-2222-4222-8222-222222222222'::uuid],
  '{"71111111-1111-4111-8111-111111111111":5}',
  array['71111111-1111-4111-8111-111111111111'::uuid]
);

insert into public.plan_templates(
  user_id, name, recipe_uuids, day_assignment_recipe_uuids
) values (
  '71000000-0000-4000-8000-000000000001', 'Deletion fixture',
  array[
    '71111111-1111-4111-8111-111111111111'::uuid,
    '71222222-2222-4222-8222-222222222222'::uuid
  ],
  '{"71111111-1111-4111-8111-111111111111":1,"71222222-2222-4222-8222-222222222222":6}'
);

-- Accidental duplicates are not accepted by normal writes, but deletion must
-- still clean them if legacy data predates that validation.
alter table public.weekly_plans disable trigger sync_weekly_plan_recipe_uuids;
alter table public.plan_templates disable trigger sync_plan_template_recipe_uuids;
update public.weekly_plans
set recipe_ids = array_append(recipe_ids, '71111111-1111-4111-8111-111111111111'),
    recipe_uuids = array_append(recipe_uuids, '71111111-1111-4111-8111-111111111111'::uuid),
    made_recipe_ids = array_append(made_recipe_ids, '71111111-1111-4111-8111-111111111111'),
    made_recipe_uuids = array_append(made_recipe_uuids, '71111111-1111-4111-8111-111111111111'::uuid)
where user_id = '71000000-0000-4000-8000-000000000001'
  and week_date = date '2098-01-05';
update public.plan_templates
set recipe_ids = array_append(recipe_ids, '71111111-1111-4111-8111-111111111111'),
    recipe_uuids = array_append(recipe_uuids, '71111111-1111-4111-8111-111111111111'::uuid)
where user_id = '71000000-0000-4000-8000-000000000001';
alter table public.weekly_plans enable trigger sync_weekly_plan_recipe_uuids;
alter table public.plan_templates enable trigger sync_plan_template_recipe_uuids;

-- Simulate a privileged pre-contract cross-owner corruption. The deletion
-- command must remain narrowly owner-scoped even when UUID-shaped text matches.
alter table public.weekly_plans disable trigger sync_weekly_plan_recipe_uuids;
insert into public.weekly_plans(
  user_id, week_date, recipe_ids, recipe_uuids, day_assignments,
  day_assignment_recipe_uuids, made_recipe_ids, made_recipe_uuids
) values (
  '72000000-0000-4000-8000-000000000002', date '2098-01-05',
  array['71111111-1111-4111-8111-111111111111'],
  array['71111111-1111-4111-8111-111111111111'::uuid],
  '{"71111111-1111-4111-8111-111111111111":3}',
  '{"71111111-1111-4111-8111-111111111111":3}',
  array['71111111-1111-4111-8111-111111111111'],
  array['71111111-1111-4111-8111-111111111111'::uuid]
);
alter table public.weekly_plans enable trigger sync_weekly_plan_recipe_uuids;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select extensions.is(
  public.delete_recipe('71111111-1111-4111-8111-111111111111'),
  '71111111-1111-4111-8111-111111111111'::uuid,
  'atomic deletion succeeds for the same owner'
);
select extensions.is(
  (select recipe_uuids from public.weekly_plans
   where user_id = auth.uid() and week_date = date '2098-01-05'),
  array['71222222-2222-4222-8222-222222222222'::uuid],
  'duplicate memberships are removed while remaining order is preserved'
);
select extensions.is(
  (select recipe_ids from public.weekly_plans
   where user_id = auth.uid() and week_date = date '2098-01-05'),
  array['71222222-2222-4222-8222-222222222222']::text[],
  'legacy and canonical membership mirrors remain positionally aligned'
);
select extensions.ok(
  (select day_assignment_recipe_uuids = '{"71222222-2222-4222-8222-222222222222":4}'::jsonb
      and day_assignments = '{"71222222-2222-4222-8222-222222222222":4}'::jsonb
      and made_recipe_uuids = array['71222222-2222-4222-8222-222222222222'::uuid]
      and made_recipe_ids = array['71222222-2222-4222-8222-222222222222']::text[]
   from public.weekly_plans where user_id = auth.uid() and week_date = date '2098-01-05'),
  'assignment and made-only references are cleaned with aligned mirrors'
);
select extensions.ok(
  (select not (day_assignment_recipe_uuids ? '71111111-1111-4111-8111-111111111111')
      and not ('71111111-1111-4111-8111-111111111111'::uuid = any(made_recipe_uuids))
   from public.weekly_plans where user_id = auth.uid() and week_date = date '2098-01-12'),
  'assignment and made state are cleaned even without membership'
);
select extensions.ok(
  (select recipe_uuids = array['71222222-2222-4222-8222-222222222222'::uuid]
      and recipe_ids = array['71222222-2222-4222-8222-222222222222']::text[]
      and day_assignment_recipe_uuids = '{"71222222-2222-4222-8222-222222222222":6}'::jsonb
   from public.plan_templates where user_id = auth.uid()),
  'template membership and assignment references are detached'
);
reset role;
select extensions.ok(
  (select recipe_uuids = array['71111111-1111-4111-8111-111111111111'::uuid]
      and recipe_ids = array['71111111-1111-4111-8111-111111111111']::text[]
   from public.weekly_plans where user_id = '72000000-0000-4000-8000-000000000002'),
  'same-shaped cross-owner references are untouched'
);

delete from public.weekly_plans
where user_id = '72000000-0000-4000-8000-000000000002' and week_date = date '2098-01-05';

-- Reproduce the production defect shape through a privileged legacy delete:
-- one aligned UUID/text membership remains after its recipe disappears.
insert into public.weekly_plans(user_id, week_date, recipe_uuids)
values (
  '71000000-0000-4000-8000-000000000001', date '2098-01-19',
  array['71333333-3333-4333-8333-333333333333'::uuid]
);
delete from public.recipes
where user_id = '71000000-0000-4000-8000-000000000001'
  and recipe_uuid = '71333333-3333-4333-8333-333333333333';
select extensions.is(
  private.test_active_recipe_reference_counts(),
  '[1, 0, 0]'::jsonb,
  'the active-reference audit detects the reproduced deletion defect'
);

alter table public.weekly_plans disable trigger sync_weekly_plan_recipe_uuids;
update public.weekly_plans
set recipe_ids = '{}'::text[], recipe_uuids = '{}'::uuid[]
where user_id = '71000000-0000-4000-8000-000000000001'
  and week_date = date '2098-01-19';
alter table public.weekly_plans enable trigger sync_weekly_plan_recipe_uuids;
select extensions.is(
  private.test_active_recipe_reference_counts(),
  '[0, 0, 0]'::jsonb,
  'controlled fixture cleanup returns active-reference counters to zero'
);

select extensions.is(
  (select count(*)::integer from public.recipes
   where user_id = '71000000-0000-4000-8000-000000000001'
     and recipe_uuid = '71111111-1111-4111-8111-111111111111'),
  0, 'the repaired deletion path cannot leave its target recipe present'
);
select extensions.is(
  private.test_active_recipe_reference_counts(),
  '[0, 0, 0]'::jsonb,
  'the repaired deletion fixture finishes with no active unresolved references'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select extensions.throws_ok($$
  select public.delete_recipe('72444444-4444-4444-8244-444444444444')
$$, '23503', 'recipe UUID is unresolved or belongs to another user',
  'cross-owner deletion remains non-disclosing'
);
reset role;
select extensions.is(
  (select count(*)::integer from public.recipes
   where recipe_uuid = '72444444-4444-4444-8244-444444444444'),
  1, 'cross-owner deletion does not modify the other owner recipe'
);

select * from extensions.finish();
rollback;
