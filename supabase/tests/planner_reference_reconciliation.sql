begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

create temporary table reconciliation_fixture_context (
  reference_label text primary key,
  owner_id uuid not null,
  week_date date not null,
  stale_id text not null,
  remove_membership boolean not null,
  remove_assignment boolean not null,
  reason_classification text not null
) on commit drop;

insert into reconciliation_fixture_context values
  (
    'Ref-A',
    extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1'),
    date '2099-01-01' + 7,
    lower(replace('Ref-A', 'Ref-', 'fixture-stale-')),
    false,
    true,
    'confirmed_deleted'
  ),
  (
    'Ref-B',
    extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1'),
    date '2099-01-01',
    lower(replace('Ref-B', 'Ref-', 'fixture-stale-')),
    true,
    false,
    'confirmed_deleted'
  ),
  (
    'Ref-C',
    extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1'),
    date '2099-01-01' + 14,
    lower(replace('Ref-C', 'Ref-', 'fixture-stale-')),
    true,
    true,
    'ambiguous_unresolvable'
  );

insert into auth.users (id)
values
  (extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
  (extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2'));

delete from public.recipes
where user_id in (
  extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1'),
  extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2')
);

insert into public.recipes (id, user_id, name, category)
select recipe_id, owner_id, recipe_id, 'fixture'
from (
  values
    ('fixture-valid-a1', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-a2', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-a3', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-b1', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-b2', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-c1', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-valid-c2', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')),
    ('fixture-unrelated-owner', extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2'))
) as fixture_recipes(recipe_id, owner_id);

insert into public.weekly_plans (
  user_id,
  week_date,
  recipe_ids,
  day_assignments,
  made_recipe_ids,
  scale,
  generated_at
)
select
  context.owner_id,
  context.week_date,
  case context.reference_label
    when 'Ref-A' then array['fixture-valid-a2', 'fixture-valid-a1', 'fixture-valid-a3']
    when 'Ref-B' then array['fixture-valid-b2', context.stale_id, 'fixture-valid-b1']
    else array['fixture-valid-c2', context.stale_id, 'fixture-valid-c1']
  end,
  case context.reference_label
    when 'Ref-A' then jsonb_build_object(
      'fixture-valid-a1', jsonb_build_array(1),
      context.stale_id, jsonb_build_array(2),
      'fixture-valid-a3', jsonb_build_array(3)
    )
    when 'Ref-B' then jsonb_build_object('fixture-valid-b1', jsonb_build_array(1))
    else jsonb_build_object(
      'fixture-valid-c1', jsonb_build_array(1),
      context.stale_id, jsonb_build_array(2)
    )
  end,
  case context.reference_label
    when 'Ref-A' then array['fixture-valid-a3']
    when 'Ref-B' then array['fixture-valid-b1']
    else array['fixture-valid-c2']
  end,
  case context.reference_label when 'Ref-A' then 1.25 when 'Ref-B' then 1.50 else 1.75 end,
  timestamptz '2099-01-01 12:00:00+00' + ((context.week_date - date '2099-01-01') * interval '1 day')
from reconciliation_fixture_context as context;

insert into public.weekly_plans (
  user_id,
  week_date,
  recipe_ids,
  day_assignments,
  made_recipe_ids,
  scale,
  generated_at
) values
  (
    extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1'),
    date '2099-02-01',
    array['fixture-valid-a1'],
    jsonb_build_object('fixture-valid-a1', jsonb_build_array(1)),
    array['fixture-valid-a1'],
    2.0,
    timestamptz '2099-02-01 12:00:00+00'
  ),
  (
    extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2'),
    date '2099-01-01',
    array['fixture-unrelated-owner'],
    jsonb_build_object('fixture-unrelated-owner', jsonb_build_array(1)),
    array['fixture-unrelated-owner'],
    3.0,
    timestamptz '2099-01-01 13:00:00+00'
  );

create temporary table reconciliation_plan_before on commit drop as
select * from public.weekly_plans;

create temporary table reconciliation_recipe_before on commit drop as
select id, user_id, recipe_uuid, to_jsonb(recipes) as row_value from public.recipes;

do $$
declare
  context reconciliation_fixture_context%rowtype;
  plan_row public.weekly_plans%rowtype;
  assignment_count integer;
begin
  for context in select * from reconciliation_fixture_context order by reference_label loop
    select *
    into strict plan_row
    from public.weekly_plans
    where user_id = context.owner_id and week_date = context.week_date;

    select count(*)::integer
    into assignment_count
    from jsonb_object_keys(coalesce(plan_row.day_assignments, '{}'::jsonb));

    call private.reconcile_stale_planner_reference_008(
      context.reference_label,
      private.reconciliation_sha256(plan_row.user_id::text || chr(31) || plan_row.week_date::text),
      private.reconciliation_sha256(context.stale_id),
      context.remove_membership,
      context.remove_assignment,
      context.reason_classification,
      private.reconciliation_sha256(to_jsonb(plan_row.recipe_ids)::text),
      private.reconciliation_sha256(coalesce(plan_row.day_assignments, '{}'::jsonb)::text),
      private.reconciliation_sha256(to_jsonb(coalesce(plan_row.made_recipe_ids, '{}'::text[]))::text),
      cardinality(plan_row.recipe_ids),
      assignment_count,
      cardinality(coalesce(plan_row.made_recipe_ids, '{}'::text[]))
    );
  end loop;
end;
$$;

select extensions.ok(
  not (wp.day_assignments ? context.stale_id)
    and wp.recipe_ids = before.recipe_ids,
  'assignment-only stale key is removed without changing membership'
)
from reconciliation_fixture_context as context
join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
where context.reference_label = 'Ref-A';

select extensions.ok(
  not (context.stale_id = any(wp.recipe_ids))
    and wp.day_assignments = before.day_assignments,
  'membership-only stale value is removed without changing assignments'
)
from reconciliation_fixture_context as context
join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
where context.reference_label = 'Ref-B';

select extensions.ok(
  not (context.stale_id = any(wp.recipe_ids))
    and not (wp.day_assignments ? context.stale_id),
  'combined stale membership and assignment key are removed'
)
from reconciliation_fixture_context as context
join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
where context.reference_label = 'Ref-C';

select extensions.ok(
  not exists (
    select 1
    from reconciliation_fixture_context as context
    join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
    join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
    where wp.recipe_ids <> array(
      select recipe_id
      from unnest(before.recipe_ids) with ordinality as item(recipe_id, position)
      where recipe_id <> context.stale_id
      order by position
    )
  ),
  'valid recipe order is preserved'
);

select extensions.ok(
  not exists (
    select 1
    from reconciliation_fixture_context as context
    join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
    join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
    where wp.day_assignments <> before.day_assignments - context.stale_id
  ),
  'valid assignment keys and values are preserved'
);

select extensions.ok(
  not exists (
    select 1
    from reconciliation_fixture_context as context
    join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
    join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
    where wp.made_recipe_ids is distinct from before.made_recipe_ids
  ),
  'made-state arrays are preserved'
);

select extensions.ok(
  not exists (
    select 1
    from reconciliation_fixture_context as context
    join public.weekly_plans as wp on wp.user_id = context.owner_id and wp.week_date = context.week_date
    join reconciliation_plan_before as before on before.user_id = context.owner_id and before.week_date = context.week_date
    where (to_jsonb(wp) - array['recipe_ids', 'day_assignments'])
      is distinct from (to_jsonb(before) - array['recipe_ids', 'day_assignments'])
  ),
  'ownership, week, made-state, scale, timestamp, and unrelated row fields are preserved'
);

select extensions.ok(
  (select to_jsonb(wp) from public.weekly_plans as wp
    where wp.user_id = extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')
      and wp.week_date = date '2099-02-01')
  =
  (select to_jsonb(before) from reconciliation_plan_before as before
    where before.user_id = extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1')
      and before.week_date = date '2099-02-01'),
  'unrelated week is unchanged'
);

select extensions.ok(
  (select to_jsonb(wp) from public.weekly_plans as wp
    where wp.user_id = extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2'))
  =
  (select to_jsonb(before) from reconciliation_plan_before as before
    where before.user_id = extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-2')),
  'unrelated owner is unchanged'
);

select extensions.ok(
  not exists (
    select id, user_id, recipe_uuid, to_jsonb(recipes)
    from public.recipes
    except
    select id, user_id, recipe_uuid, row_value
    from reconciliation_recipe_before
  )
  and (select count(*) from public.recipes) = (select count(*) from reconciliation_recipe_before),
  'no recipe row is deleted or modified'
);

select extensions.ok(
  not exists (
    select current_row.id, current_row.user_id
    from public.recipes as current_row
    join reconciliation_recipe_before as before using (id, user_id)
    where current_row.recipe_uuid <> before.recipe_uuid
  ),
  'recipe UUID mapping is unchanged'
);

select extensions.is(
  (
    select jsonb_build_array(
      count(*) filter (where field_name = 'recipe_ids'),
      count(*) filter (where field_name = 'assignment_keys'),
      count(*) filter (where field_name = 'made_recipe_ids')
    )
    from (
      select 'recipe_ids' as field_name
      from public.weekly_plans as wp
      cross join lateral unnest(wp.recipe_ids) as recipe_id
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
      )
      union all
      select 'assignment_keys'
      from public.weekly_plans as wp
      cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = assignment_key
      )
      union all
      select 'made_recipe_ids'
      from public.weekly_plans as wp
      cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
      )
    ) as unresolved
  ),
  '[0, 0, 0]'::jsonb,
  'active planner reference audit reports zero unresolved values'
);

insert into public.weekly_plans (user_id, week_date, recipe_ids, day_assignments, made_recipe_ids)
select
  owner_id,
  date '2099-03-01',
  array['fixture-valid-a1'],
  jsonb_build_object(stale_id || '-changed', jsonb_build_array(1)),
  array['fixture-valid-a1']
from reconciliation_fixture_context
where reference_label = 'Ref-A';

select extensions.throws_ok(
  format(
    'call private.reconcile_stale_planner_reference_008(%L, %L, %L, false, true, %L, %L, %L, %L, 1, 1, 1)',
    'Ref-A',
    private.reconciliation_sha256(owner_id::text || chr(31) || date '2099-03-01'::text),
    private.reconciliation_sha256(stale_id || '-changed'),
    'confirmed_deleted',
    repeat('0', 64),
    private.reconciliation_sha256(jsonb_build_object(stale_id || '-changed', jsonb_build_array(1))::text),
    private.reconciliation_sha256(to_jsonb(array['fixture-valid-a1']::text[])::text)
  ),
  'P0001',
  '008 reconciliation field precondition failed for Ref-A',
  'changed row precondition aborts the reconciliation'
)
from reconciliation_fixture_context
where reference_label = 'Ref-A';

delete from public.weekly_plans
where week_date = date '2099-03-01'
  and user_id = extensions.uuid_generate_v5(extensions.uuid_nil(), 'migration-008-owner-1');

select extensions.ok(
  not exists (
    select 1
    from public.weekly_plans as wp
    cross join lateral unnest(wp.recipe_ids) as recipe_id
    join public.recipes as r on r.id = recipe_id and r.user_id <> wp.user_id
  ),
  'no planner reference is reassigned across owners'
);

select extensions.ok(
  not exists (
    select 1
    from reconciliation_fixture_context as context
    join public.recipes as r on r.id = context.stale_id
  ),
  'no UUID or recipe row is generated for a stale reference'
);

select * from extensions.finish();
rollback;
