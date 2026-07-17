-- Repair the Stage 2B UUID made-state contract without changing the deployed
-- legacy caller contract.

begin;

drop function public.toggle_weekly_recipe_made(uuid, text, boolean, timestamptz);

create function public.toggle_weekly_recipe_made(
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

-- The deployed legacy application remains authenticated and keeps its existing
-- argument and toggle semantics. Restrict it to the same least-privilege role.
alter function public.toggle_weekly_recipe_made(text, text, boolean, timestamptz)
  owner to postgres;
alter function public.toggle_weekly_recipe_made(text, text, boolean, timestamptz)
  set search_path = '';
revoke all privileges on function public.toggle_weekly_recipe_made(text, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.toggle_weekly_recipe_made(text, text, boolean, timestamptz)
  to authenticated;

do $$
declare
  v_canonical regprocedure := to_regprocedure(
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)'
  );
  v_legacy regprocedure := to_regprocedure(
    'public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)'
  );
begin
  if v_canonical is null then
    raise exception 'canonical UUID/date made-state function is missing';
  end if;
  if to_regprocedure(
    'public.toggle_weekly_recipe_made(uuid,text,boolean,timestamp with time zone)'
  ) is not null then
    raise exception 'obsolete UUID/text made-state function remains';
  end if;
  if v_legacy is null then
    raise exception 'legacy made-state compatibility function is missing';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = v_canonical
      and procedure.prosecdef
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception 'canonical made-state security contract is invalid';
  end if;

  if not has_function_privilege('authenticated', v_canonical, 'EXECUTE')
    or has_function_privilege('anon', v_canonical, 'EXECUTE')
    or has_function_privilege('service_role', v_canonical, 'EXECUTE')
    or has_function_privilege('public', v_canonical, 'EXECUTE')
  then
    raise exception 'canonical made-state grants are invalid';
  end if;

  if not exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = v_legacy
      and not procedure.prosecdef
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
  ) then
    raise exception 'legacy made-state security contract is invalid';
  end if;

  if not has_function_privilege('authenticated', v_legacy, 'EXECUTE')
    or has_function_privilege('anon', v_legacy, 'EXECUTE')
    or has_function_privilege('service_role', v_legacy, 'EXECUTE')
    or has_function_privilege('public', v_legacy, 'EXECUTE')
  then
    raise exception 'legacy made-state grants are invalid';
  end if;
end;
$$;

commit;
