-- Forward correction for 031; preserve its checksum and deployed history.
-- All cooperating planner/history/deletion paths serialize per authenticated
-- owner BEFORE taking row locks. Different owners remain independent.
-- A statement trigger is essential: an UPDATE already owns its history row
-- before a row trigger runs, which would invert deletion's recipe/history order.
-- Existing row locks, stale-state fences, RLS and Shopping cleanup stay intact.
begin;

create function private.lock_planner_history_owner()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
begin
  -- Service/operator writes without a principal retain the existing row guard.
  -- App writes and service-backed recipe deletion have an authenticated owner.
  if v_owner is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe-genie/planner/' || v_owner::text, 0));
  end if;
  return null;
end;
$$;
alter function private.lock_planner_history_owner() owner to postgres;
revoke all on function private.lock_planner_history_owner() from public, anon, authenticated, service_role;
create trigger aa_lock_planner_history_owner
before insert or update or delete on public.recipe_history
for each statement execute function private.lock_planner_history_owner();

create or replace function public.replace_planned_recipe(
  p_week_date date, p_old_recipe uuid, p_replacement_recipe uuid,
  p_day integer, p_expected_day integer,
  p_expected_recipes uuid[], p_expected_made uuid[], p_expected_assignments jsonb,
  p_timezone text
) returns public.weekly_plans
language plpgsql security invoker set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_plan public.weekly_plans%rowtype;
  v_assignments jsonb;
begin
  if v_owner is null then raise exception 'Sign in to swap a meal.' using errcode = '42501'; end if;
  if p_day is null or p_day < 0 or p_day > 6 or p_timezone is null or
    not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Choose a valid scheduled day and timezone.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe-genie/planner/' || v_owner::text, 0));
  select * into v_plan from public.weekly_plans
    where user_id = v_owner and week_date = p_week_date for update;
  if not found or not p_old_recipe = any(v_plan.recipe_uuids) then
    raise exception 'This meal is no longer in the plan. Close and reopen Swap meal.';
  end if;
  if v_plan.recipe_uuids is distinct from p_expected_recipes or
    v_plan.made_recipe_uuids is distinct from p_expected_made or
    v_plan.day_assignment_recipe_uuids is distinct from p_expected_assignments or
    (v_plan.day_assignment_recipe_uuids->>p_old_recipe::text)::integer is distinct from p_expected_day then
    raise exception 'The plan changed while saving. Close and reopen Swap meal to review it.';
  end if;
  -- Owner serialization precedes all row locks. The
  -- separate subsequent history SELECT sees any writer that held this lock.
  perform 1 from public.recipes where user_id = v_owner and recipe_uuid = p_old_recipe for update;
  if p_old_recipe = any(v_plan.made_recipe_uuids) or exists (
    select 1 from public.recipe_history h where h.user_id = v_owner and h.recipe_uuid = p_old_recipe
      and (h.date_made at time zone p_timezone)::date >= p_week_date
      and (h.date_made at time zone p_timezone)::date < p_week_date + 7
  ) then raise exception 'A cooked meal cannot be swapped.'; end if;
  if p_replacement_recipe = any(v_plan.recipe_uuids) then
    raise exception 'That recipe is already planned this week. Choose another recipe.';
  end if;
  if not exists (select 1 from public.recipes where user_id = v_owner and recipe_uuid = p_replacement_recipe) then
    raise exception 'Replacement recipe not found.' using errcode = '42501';
  end if;
  v_assignments := (v_plan.day_assignment_recipe_uuids - p_old_recipe::text) ||
    jsonb_build_object(p_replacement_recipe::text, p_day);
  update public.weekly_plans set
    recipe_uuids = array_replace(v_plan.recipe_uuids, p_old_recipe, p_replacement_recipe),
    day_assignment_recipe_uuids = v_assignments
    where user_id = v_owner and week_date = p_week_date returning * into v_plan;
  return v_plan;
end;
$$;
alter function public.replace_planned_recipe(date, uuid, uuid, integer, integer, uuid[], uuid[], jsonb, text) owner to postgres;
revoke all on function public.replace_planned_recipe(date, uuid, uuid, integer, integer, uuid[], uuid[], jsonb, text) from public, anon, service_role;
grant execute on function public.replace_planned_recipe(date, uuid, uuid, integer, integer, uuid[], uuid[], jsonb, text) to authenticated;

create or replace function public.toggle_weekly_recipe_made(
  p_recipe_uuid uuid,
  p_week_date date,
  p_made boolean,
  p_made_at timestamptz default null
)
returns table(
  action text,
  recipe_uuid uuid,
  week_date date,
  made_recipe_uuids uuid[],
  history_date_made timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_recipe_id text;
  v_plan public.weekly_plans%rowtype;
  v_history_date timestamptz;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe-genie/planner/' || v_user_id::text, 0));
  v_recipe_id := private.resolve_owned_recipe_legacy_id(v_user_id, p_recipe_uuid);

  select plan.*
  into v_plan
  from public.weekly_plans as plan
  where plan.user_id = v_user_id
    and plan.week_date = p_week_date
  for update;

  if not found then
    raise exception 'weekly plan not found' using errcode = 'P0002';
  end if;

  if p_made then
    if not p_recipe_uuid = any(coalesce(v_plan.made_recipe_uuids, '{}'::uuid[])) then
      v_plan.made_recipe_uuids := array_append(
        coalesce(v_plan.made_recipe_uuids, '{}'::uuid[]),
        p_recipe_uuid
      );
    end if;
    if not v_recipe_id = any(coalesce(v_plan.made_recipe_ids, '{}'::text[])) then
      v_plan.made_recipe_ids := array_append(
        coalesce(v_plan.made_recipe_ids, '{}'::text[]),
        v_recipe_id
      );
    end if;

    v_history_date := coalesce(p_made_at, now());
    insert into public.recipe_history(user_id, recipe_id, recipe_uuid, date_made)
    values (v_user_id, v_recipe_id, p_recipe_uuid, v_history_date);
    action := 'marked';
  else
    v_plan.made_recipe_uuids := array_remove(
      coalesce(v_plan.made_recipe_uuids, '{}'::uuid[]),
      p_recipe_uuid
    );
    v_plan.made_recipe_ids := array_remove(
      coalesce(v_plan.made_recipe_ids, '{}'::text[]),
      v_recipe_id
    );

    delete from public.recipe_history as history
    where history.id = (
      select candidate.id
      from public.recipe_history as candidate
      where candidate.user_id = v_user_id
        and candidate.recipe_uuid = p_recipe_uuid
      order by candidate.date_made desc, candidate.id desc
      limit 1
    );
    action := 'unmarked';
    v_history_date := null;
  end if;

  update public.weekly_plans as plan
  set made_recipe_uuids = v_plan.made_recipe_uuids,
      made_recipe_ids = v_plan.made_recipe_ids
  where plan.user_id = v_user_id
    and plan.week_date = p_week_date
  returning plan.made_recipe_uuids into v_plan.made_recipe_uuids;

  recipe_uuid := p_recipe_uuid;
  week_date := p_week_date;
  made_recipe_uuids := coalesce(v_plan.made_recipe_uuids, '{}'::uuid[]);
  history_date_made := v_history_date;
  return next;
end;
$$;

alter function public.toggle_weekly_recipe_made(uuid, date, boolean, timestamptz)
  owner to postgres;
revoke all privileges on function public.toggle_weekly_recipe_made(uuid, date, boolean, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.toggle_weekly_recipe_made(uuid, date, boolean, timestamptz)
  to authenticated;


create or replace function private.shopping_delete_recipe_internal(p_recipe_uuid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_legacy_id text;
  v_deleted uuid;
  v_document jsonb;
  v_previous_deletion_setting text := coalesce(
    current_setting('recipe_genie.recipe_deletion', true), ''
  );
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe-genie/planner/' || v_user_id::text, 0));
  select recipe.id into v_legacy_id
  from public.recipes as recipe
  where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid
  for update;
  if v_legacy_id is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  perform 1 from public.weekly_plans as plan
  where plan.user_id = v_user_id and (
    p_recipe_uuid = any(plan.recipe_uuids) or v_legacy_id = any(plan.recipe_ids)
    or plan.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(plan.day_assignments, '{}'::jsonb) ? v_legacy_id
    or p_recipe_uuid = any(plan.made_recipe_uuids)
    or v_legacy_id = any(plan.made_recipe_ids)
  ) order by plan.week_date for update;
  perform 1 from public.plan_templates as template
  where template.user_id = v_user_id and (
    p_recipe_uuid = any(template.recipe_uuids) or v_legacy_id = any(template.recipe_ids)
    or template.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(template.day_assignments, '{}'::jsonb) ? v_legacy_id
  ) order by template.id for update;
  select document into v_document
  from public.shopping_list
  where user_id = v_user_id
  for update;

  perform set_config('recipe_genie.recipe_deletion', 'on', true);
  update public.weekly_plans as plan
  set recipe_uuids = private.remove_recipe_uuid_from_array(plan.recipe_uuids, p_recipe_uuid),
      day_assignment_recipe_uuids = coalesce(plan.day_assignment_recipe_uuids, '{}'::jsonb)
        - p_recipe_uuid::text,
      made_recipe_uuids = private.remove_recipe_uuid_from_array(plan.made_recipe_uuids, p_recipe_uuid)
  where plan.user_id = v_user_id and (
    p_recipe_uuid = any(plan.recipe_uuids) or v_legacy_id = any(plan.recipe_ids)
    or plan.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(plan.day_assignments, '{}'::jsonb) ? v_legacy_id
    or p_recipe_uuid = any(plan.made_recipe_uuids)
    or v_legacy_id = any(plan.made_recipe_ids)
  );
  update public.plan_templates as template
  set recipe_uuids = private.remove_recipe_uuid_from_array(template.recipe_uuids, p_recipe_uuid),
      day_assignment_recipe_uuids = coalesce(template.day_assignment_recipe_uuids, '{}'::jsonb)
        - p_recipe_uuid::text
  where template.user_id = v_user_id and (
    p_recipe_uuid = any(template.recipe_uuids) or v_legacy_id = any(template.recipe_ids)
    or template.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(template.day_assignments, '{}'::jsonb) ? v_legacy_id
  );
  if v_document->'recipeEntries' ? p_recipe_uuid::text then
    v_document := private.shopping_recover_trip_visibility(v_document);
    v_document := jsonb_set(
      v_document,
      '{recipeEntries}',
      (v_document->'recipeEntries') - p_recipe_uuid::text,
      true
    );
    update public.shopping_list
    set document = private.prune_shopping_document_v2(v_document),
        content_revision = content_revision + 1
    where user_id = v_user_id;
  end if;
  delete from public.recipes as recipe
  where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid
  returning recipe.recipe_uuid into v_deleted;
  if v_deleted is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  perform set_config('recipe_genie.recipe_deletion', v_previous_deletion_setting, true);
  return v_deleted;
end;
$$;

revoke all on function private.shopping_delete_recipe_internal(uuid) from public, anon, authenticated, service_role;
commit;
