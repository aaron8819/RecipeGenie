-- Atomic explicit swaps share the recipe row lock with history writes.
-- No data rewrite; removal/move commands remain available for cooked meals.
begin;

create function private.lock_recipe_history_source()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- UUID synchronization runs before this trigger. Lock both identities for
  -- edits in a stable order; history-only inserts take no plan lock.
  perform 1 from public.recipes r
  where r.user_id = new.user_id and r.recipe_uuid in (
    new.recipe_uuid, case when tg_op = 'UPDATE' then old.recipe_uuid else null end
  ) order by r.recipe_uuid for update;
  return new;
end;
$$;
alter function private.lock_recipe_history_source() owner to postgres;
revoke all on function private.lock_recipe_history_source() from public, anon, authenticated, service_role;
create trigger zz_lock_recipe_history_source
before insert or update of recipe_uuid, date_made on public.recipe_history
for each row execute function private.lock_recipe_history_source();

create function public.replace_planned_recipe(
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
  -- Same ordering as weekly cooking: plan first, then source recipe. The
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
commit;
