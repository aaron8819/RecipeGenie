begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.planner_reference_reconciliation_audit (
  id bigint generated always as identity primary key,
  reconciliation_id text not null,
  reference_label text not null,
  reference_fingerprint text not null,
  planner_row_fingerprint text not null,
  action_type text not null,
  reason_classification text not null,
  reconciled_at timestamptz not null default transaction_timestamp(),
  constraint planner_reference_reconciliation_id_check
    check (reconciliation_id = '008_reconcile_stale_planner_references'),
  constraint planner_reference_label_check
    check (reference_label in ('Ref-A', 'Ref-B', 'Ref-C')),
  constraint planner_reference_fingerprint_check
    check (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint planner_row_fingerprint_check
    check (planner_row_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint planner_reference_action_check
    check (action_type in ('membership_removed', 'assignment_key_removed')),
  constraint planner_reference_reason_check
    check (reason_classification in ('confirmed_deleted', 'ambiguous_unresolvable')),
  constraint planner_reference_reconciliation_action_key
    unique (reconciliation_id, reference_label, action_type)
);

revoke all on table private.planner_reference_reconciliation_audit from public, anon, authenticated, service_role;
revoke all on sequence private.planner_reference_reconciliation_audit_id_seq from public, anon, authenticated, service_role;

create or replace function private.reconciliation_sha256(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(value, 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function private.reconciliation_sha256(text) from public, anon, authenticated, service_role;

create or replace procedure private.reconcile_stale_planner_reference_008(
  p_reference_label text,
  p_planner_row_fingerprint text,
  p_reference_fingerprint text,
  p_remove_membership boolean,
  p_remove_assignment boolean,
  p_reason_classification text,
  p_expected_recipe_ids_hash text,
  p_expected_assignment_hash text,
  p_expected_made_state_hash text,
  p_expected_recipe_ids_count integer,
  p_expected_assignment_count integer,
  p_expected_made_state_count integer
)
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.weekly_plans%rowtype;
  v_after public.weekly_plans%rowtype;
  v_candidate_ids text[];
  v_stale_id text;
  v_membership_count integer;
  v_assignment_count integer;
  v_made_count integer;
  v_global_membership_count integer;
  v_global_assignment_count integer;
  v_global_made_count integer;
  v_unrelated_rows_hash_before text;
  v_unrelated_rows_hash_after text;
begin
  if p_reference_label not in ('Ref-A', 'Ref-B', 'Ref-C')
    or p_reason_classification not in ('confirmed_deleted', 'ambiguous_unresolvable')
    or not (p_remove_membership or p_remove_assignment)
    or p_planner_row_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reference_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception '008 reconciliation specification is invalid';
  end if;

  select wp.*
  into strict v_plan
  from public.weekly_plans as wp
  where private.reconciliation_sha256(wp.user_id::text || chr(31) || wp.week_date::text)
    = p_planner_row_fingerprint
  for update;

  if private.reconciliation_sha256(to_jsonb(v_plan.recipe_ids)::text) <> p_expected_recipe_ids_hash
    or private.reconciliation_sha256(coalesce(v_plan.day_assignments, '{}'::jsonb)::text) <> p_expected_assignment_hash
    or private.reconciliation_sha256(to_jsonb(coalesce(v_plan.made_recipe_ids, '{}'::text[]))::text) <> p_expected_made_state_hash
    or cardinality(v_plan.recipe_ids) <> p_expected_recipe_ids_count
    or (select count(*) from jsonb_object_keys(coalesce(v_plan.day_assignments, '{}'::jsonb))) <> p_expected_assignment_count
    or cardinality(coalesce(v_plan.made_recipe_ids, '{}'::text[])) <> p_expected_made_state_count
  then
    raise exception '008 reconciliation field precondition failed for %', p_reference_label;
  end if;

  select coalesce(array_agg(candidate order by candidate), '{}'::text[])
  into v_candidate_ids
  from (
    select distinct candidate
    from (
      select recipe_id as candidate
      from unnest(v_plan.recipe_ids) as recipe_id
      union all
      select assignment_key as candidate
      from jsonb_object_keys(coalesce(v_plan.day_assignments, '{}'::jsonb)) as assignment_key
    ) as candidates
    where private.reconciliation_sha256(candidate) = p_reference_fingerprint
  ) as matched;

  if cardinality(v_candidate_ids) <> 1 then
    raise exception '008 reconciliation reference fingerprint precondition failed for %', p_reference_label;
  end if;
  v_stale_id := v_candidate_ids[1];

  select count(*)::integer
  into v_membership_count
  from unnest(v_plan.recipe_ids) as recipe_id
  where recipe_id = v_stale_id;

  v_assignment_count := case
    when coalesce(v_plan.day_assignments, '{}'::jsonb) ? v_stale_id then 1
    else 0
  end;

  select count(*)::integer
  into v_made_count
  from unnest(coalesce(v_plan.made_recipe_ids, '{}'::text[])) as recipe_id
  where recipe_id = v_stale_id;

  if v_membership_count <> (case when p_remove_membership then 1 else 0 end)
    or v_assignment_count <> (case when p_remove_assignment then 1 else 0 end)
    or v_made_count <> 0
  then
    raise exception '008 reconciliation stale-shape precondition failed for %', p_reference_label;
  end if;

  select count(*)::integer
  into v_global_membership_count
  from public.weekly_plans as wp
  cross join lateral unnest(wp.recipe_ids) as recipe_id
  where recipe_id = v_stale_id;

  select count(*)::integer
  into v_global_assignment_count
  from public.weekly_plans as wp
  cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
  where assignment_key = v_stale_id;

  select count(*)::integer
  into v_global_made_count
  from public.weekly_plans as wp
  cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
  where recipe_id = v_stale_id;

  if v_global_membership_count <> v_membership_count
    or v_global_assignment_count <> v_assignment_count
    or v_global_made_count <> 0
  then
    raise exception '008 reconciliation found an unexpected active occurrence for %', p_reference_label;
  end if;

  if exists (select 1 from public.recipes as r where r.id = v_stale_id)
    or exists (
      select 1
      from public.plan_templates as pt
      cross join lateral unnest(pt.recipe_ids) as recipe_id
      where recipe_id = v_stale_id
    )
    or exists (
      select 1
      from public.plan_templates as pt
      cross join lateral jsonb_object_keys(coalesce(pt.day_assignments, '{}'::jsonb)) as assignment_key
      where assignment_key = v_stale_id
    )
    or exists (select 1 from public.recipe_history as rh where rh.recipe_id = v_stale_id)
    or exists (
      select 1
      from public.recipe_shares as rs
      where rs.source_recipe_id = v_stale_id
        or rs.accepted_recipe_id = v_stale_id
        or rs.source_recipe_snapshot ? v_stale_id
        or jsonb_path_exists(
          rs.source_recipe_snapshot,
          '$.** ? (@ == $stale)',
          jsonb_build_object('stale', to_jsonb(v_stale_id))
        )
    )
    or exists (
      select 1
      from public.shopping_list as sl
      cross join lateral unnest(coalesce(sl.source_recipes, '{}'::text[])) as recipe_id
      where recipe_id = v_stale_id
    )
    or exists (
      select 1
      from public.shopping_recipe_contributions as src
      where src.recipe_id = v_stale_id
    )
  then
    raise exception '008 reconciliation found a live or historical conflicting reference for %', p_reference_label;
  end if;

  select private.reconciliation_sha256(
    coalesce(
      string_agg(
        private.reconciliation_sha256(to_jsonb(wp)::text),
        chr(10)
        order by wp.user_id, wp.week_date
      ),
      ''
    )
  )
  into v_unrelated_rows_hash_before
  from public.weekly_plans as wp
  where (wp.user_id, wp.week_date) <> (v_plan.user_id, v_plan.week_date);

  if p_remove_membership and p_remove_assignment then
    update public.weekly_plans as wp
    set recipe_ids = array(
      select recipe_id
      from unnest(wp.recipe_ids) with ordinality as item(recipe_id, position)
      where recipe_id <> v_stale_id
      order by position
    ),
      day_assignments = coalesce(wp.day_assignments, '{}'::jsonb) - v_stale_id
    where wp.user_id = v_plan.user_id and wp.week_date = v_plan.week_date
    returning wp.* into strict v_after;
  elsif p_remove_membership then
    update public.weekly_plans as wp
    set recipe_ids = array(
      select recipe_id
      from unnest(wp.recipe_ids) with ordinality as item(recipe_id, position)
      where recipe_id <> v_stale_id
      order by position
    )
    where wp.user_id = v_plan.user_id and wp.week_date = v_plan.week_date
    returning wp.* into strict v_after;
  else
    update public.weekly_plans as wp
    set day_assignments = coalesce(wp.day_assignments, '{}'::jsonb) - v_stale_id
    where wp.user_id = v_plan.user_id and wp.week_date = v_plan.week_date
    returning wp.* into strict v_after;
  end if;

  if v_after.recipe_ids <> array(
      select recipe_id
      from unnest(v_plan.recipe_ids) with ordinality as item(recipe_id, position)
      where not p_remove_membership or recipe_id <> v_stale_id
      order by position
    )
    or coalesce(v_after.day_assignments, '{}'::jsonb) <> (case
      when p_remove_assignment then coalesce(v_plan.day_assignments, '{}'::jsonb) - v_stale_id
      else coalesce(v_plan.day_assignments, '{}'::jsonb)
    end)
    or coalesce(v_after.made_recipe_ids, '{}'::text[]) <> coalesce(v_plan.made_recipe_ids, '{}'::text[])
    or (to_jsonb(v_after) - array['recipe_ids', 'day_assignments', 'made_recipe_ids'])
      <> (to_jsonb(v_plan) - array['recipe_ids', 'day_assignments', 'made_recipe_ids'])
  then
    raise exception '008 reconciliation preservation assertion failed for %', p_reference_label;
  end if;

  select private.reconciliation_sha256(
    coalesce(
      string_agg(
        private.reconciliation_sha256(to_jsonb(wp)::text),
        chr(10)
        order by wp.user_id, wp.week_date
      ),
      ''
    )
  )
  into v_unrelated_rows_hash_after
  from public.weekly_plans as wp
  where (wp.user_id, wp.week_date) <> (v_plan.user_id, v_plan.week_date);

  if v_unrelated_rows_hash_after <> v_unrelated_rows_hash_before then
    raise exception '008 reconciliation unrelated-row assertion failed for %', p_reference_label;
  end if;

  if p_remove_membership then
    insert into private.planner_reference_reconciliation_audit (
      reconciliation_id,
      reference_label,
      reference_fingerprint,
      planner_row_fingerprint,
      action_type,
      reason_classification
    ) values (
      '008_reconcile_stale_planner_references',
      p_reference_label,
      p_reference_fingerprint,
      p_planner_row_fingerprint,
      'membership_removed',
      p_reason_classification
    );
  end if;

  if p_remove_assignment then
    insert into private.planner_reference_reconciliation_audit (
      reconciliation_id,
      reference_label,
      reference_fingerprint,
      planner_row_fingerprint,
      action_type,
      reason_classification
    ) values (
      '008_reconcile_stale_planner_references',
      p_reference_label,
      p_reference_fingerprint,
      p_planner_row_fingerprint,
      'assignment_key_removed',
      p_reason_classification
    );
  end if;
end;
$$;

revoke all on procedure private.reconcile_stale_planner_reference_008(
  text, text, text, boolean, boolean, text, text, text, text, integer, integer, integer
) from public, anon, authenticated, service_role;

do $$
declare
  v_is_pristine_fixture boolean;
  v_unresolved_memberships integer;
  v_unresolved_assignments integer;
  v_unresolved_made_state integer;
  v_distinct_unresolved integer;
  v_recipe_count_before bigint;
  v_recipe_count_after bigint;
  v_recipe_mapping_hash_before text;
  v_recipe_mapping_hash_after text;
  v_planner_count_before bigint;
  v_planner_count_after bigint;
begin
  v_is_pristine_fixture := not exists (select 1 from auth.users)
    and not exists (select 1 from public.recipes)
    and not exists (select 1 from public.weekly_plans)
    and not exists (select 1 from public.plan_templates)
    and not exists (select 1 from public.recipe_history)
    and not exists (select 1 from public.recipe_shares)
    and not exists (select 1 from public.shopping_list)
    and not exists (select 1 from public.shopping_recipe_contributions)
    and not exists (select 1 from public.pantry_items)
    and not exists (select 1 from public.user_config);

  if v_is_pristine_fixture then
    raise notice '008 reconciliation skipped production targets in explicitly identified pristine fixture database';
  else
    select count(*)::integer
    into v_unresolved_memberships
    from public.weekly_plans as wp
    cross join lateral unnest(wp.recipe_ids) as recipe_id
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
    );

    select count(*)::integer
    into v_unresolved_assignments
    from public.weekly_plans as wp
    cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = assignment_key
    );

    select count(*)::integer
    into v_unresolved_made_state
    from public.weekly_plans as wp
    cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
    );

    select count(distinct unresolved_id)::integer
    into v_distinct_unresolved
    from (
      select recipe_id as unresolved_id
      from public.weekly_plans as wp
      cross join lateral unnest(wp.recipe_ids) as recipe_id
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
      )
      union all
      select assignment_key as unresolved_id
      from public.weekly_plans as wp
      cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = assignment_key
      )
      union all
      select recipe_id as unresolved_id
      from public.weekly_plans as wp
      cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
      where not exists (
        select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
      )
    ) as unresolved;

    if (v_unresolved_memberships, v_unresolved_assignments, v_unresolved_made_state, v_distinct_unresolved)
      <> (2, 2, 0, 3)
    then
      raise exception '008 reconciliation global precondition failed: expected approved active-reference counts';
    end if;

    select count(*), private.reconciliation_sha256(
      coalesce(
        string_agg(
          r.user_id::text || chr(31) || r.id || chr(31) || r.recipe_uuid::text,
          chr(10)
          order by r.user_id, r.id
        ),
        ''
      )
    )
    into v_recipe_count_before, v_recipe_mapping_hash_before
    from public.recipes as r;

    select count(*) into v_planner_count_before from public.weekly_plans;

    call private.reconcile_stale_planner_reference_008(
      'Ref-A',
      '0f657cc2dc7957c7d3f246207cb9c6f1198299c822ce38ba427c40d8b7db10c3',
      '4287c1db81af01de4110c5a4d65c5a7d3f034010c9da33112d0a360ecac249ec',
      false,
      true,
      'confirmed_deleted',
      'bf655989d517b9f34b1e3e0f20c2939002a08834447c208cfd2db9175c8f93be',
      '19190d0931cb9fe44b8a3e1525bb9bae03afb68af1e621e308aec34696d297f0',
      'e2266b54cfc4871ff5807ae3cc7ae7d68237dfbbf01d5d1dee712bdf588097fd',
      4,
      9,
      3
    );

    call private.reconcile_stale_planner_reference_008(
      'Ref-B',
      '4d653640df5c4020555697432535ea01028d8eeea0e2f2fc10cfe0ec530aba19',
      'e8806218376f889668cc91b01a5bf5646160414bbceb60b6fc0515cd98a5f8cf',
      true,
      false,
      'confirmed_deleted',
      '6ee72402cd8fa8b4ca62893867924cae99912f3b0b42b470fa800c6cb5bb2e80',
      'e968fdb29805227bdb379bbb6a963b7e5f3449ab9d024a941f21b031c473cb46',
      '6c8ea3b4f159e7549430a1287fd0f7e01b0a39d4c6213feff08cfb3719c36e4d',
      3,
      1,
      1
    );

    call private.reconcile_stale_planner_reference_008(
      'Ref-C',
      'cfc6a9f0c39deb8f7ff0fe779f11ebc136696b5e9a935d24fa95fa73b2bbd4aa',
      '0fec66ac3757cbc09aa4edaa756bf4792ac03b9cefd224707084ad9bd3d7a9d8',
      true,
      true,
      'ambiguous_unresolvable',
      'e103665bd59c5e7aafac7315aaca331be5346784d11dc6442bfb62d3528151b1',
      '63e2035b50eef4ab774b56f7f1f30a49b989a34d0a6a22ef4616e63800ef503f',
      '1b55f6c553ec83ca9f73c9463cd3f98f1a8b703f8ffe60f52a7449616589fb40',
      5,
      4,
      4
    );

    select count(*)::integer
    into v_unresolved_memberships
    from public.weekly_plans as wp
    cross join lateral unnest(wp.recipe_ids) as recipe_id
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
    );

    select count(*)::integer
    into v_unresolved_assignments
    from public.weekly_plans as wp
    cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = assignment_key
    );

    select count(*)::integer
    into v_unresolved_made_state
    from public.weekly_plans as wp
    cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
    where not exists (
      select 1 from public.recipes as r where r.user_id = wp.user_id and r.id = recipe_id
    );

    if (v_unresolved_memberships, v_unresolved_assignments, v_unresolved_made_state) <> (0, 0, 0) then
      raise exception '008 reconciliation postcondition failed: active unresolved references remain';
    end if;

    select count(*), private.reconciliation_sha256(
      coalesce(
        string_agg(
          r.user_id::text || chr(31) || r.id || chr(31) || r.recipe_uuid::text,
          chr(10)
          order by r.user_id, r.id
        ),
        ''
      )
    )
    into v_recipe_count_after, v_recipe_mapping_hash_after
    from public.recipes as r;

    select count(*) into v_planner_count_after from public.weekly_plans;

    if v_recipe_count_after <> v_recipe_count_before
      or v_recipe_mapping_hash_after <> v_recipe_mapping_hash_before
      or v_planner_count_after <> v_planner_count_before
      or (select count(*) from private.planner_reference_reconciliation_audit
          where reconciliation_id = '008_reconcile_stale_planner_references') <> 4
    then
      raise exception '008 reconciliation preservation or audit-evidence postcondition failed';
    end if;
  end if;
end;
$$;

comment on table private.planner_reference_reconciliation_audit is
  'Operator-only, non-sensitive evidence for migration 008 planner reference removals.';
comment on procedure private.reconcile_stale_planner_reference_008(
  text, text, text, boolean, boolean, text, text, text, text, integer, integer, integer
) is 'Migration-008-only guarded planner reconciliation primitive; unavailable to application roles.';

commit;
