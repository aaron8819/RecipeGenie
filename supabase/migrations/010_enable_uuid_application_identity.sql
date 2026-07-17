-- Stage 2B: make UUID fields authoritative for new application writes while
-- retaining migration 009 legacy-first compatibility for the old application.

begin;

alter table public.recipe_history alter column recipe_id set default '';
alter table public.recipe_shares alter column source_recipe_id set default '';
alter table public.shopping_recipe_contributions alter column recipe_id set default '';

create function private.resolve_owned_recipe_legacy_id(
  p_user_id uuid,
  p_recipe_uuid uuid
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_legacy_id text;
begin
  select recipe.id into v_legacy_id
  from public.recipes as recipe
  where recipe.user_id = p_user_id
    and recipe.recipe_uuid = p_recipe_uuid;

  if v_legacy_id is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  return v_legacy_id;
end;
$$;

create function private.resolve_owned_recipe_legacy_array(
  p_user_id uuid,
  p_recipe_uuids uuid[]
)
returns text[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result text[];
  v_unresolved integer;
begin
  select
    coalesce(array_agg(recipe.id order by item.position), '{}'::text[]),
    count(*) filter (where recipe.id is null)
  into v_result, v_unresolved
  from unnest(coalesce(p_recipe_uuids, '{}'::uuid[]))
    with ordinality as item(recipe_uuid, position)
  left join public.recipes as recipe
    on recipe.recipe_uuid = item.recipe_uuid
   and recipe.user_id = p_user_id;

  if v_unresolved > 0 then
    raise exception 'active recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  if cardinality(v_result) <> (select count(distinct id) from unnest(v_result) as id) then
    raise exception 'active recipe UUIDs contain a duplicate identity'
      using errcode = '23505';
  end if;
  return v_result;
end;
$$;

create function private.resolve_owned_recipe_legacy_assignments(
  p_user_id uuid,
  p_uuid_assignments jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_assignment record;
  v_legacy_id text;
  v_recipe_uuid uuid;
begin
  if jsonb_typeof(coalesce(p_uuid_assignments, '{}'::jsonb)) <> 'object' then
    raise exception 'recipe assignments must be a JSON object' using errcode = '22023';
  end if;
  for v_assignment in select key, value from jsonb_each(coalesce(p_uuid_assignments, '{}'::jsonb))
  loop
    begin
      v_recipe_uuid := v_assignment.key::uuid;
    exception when invalid_text_representation then
      raise exception 'recipe assignment key must be a UUID' using errcode = '22023';
    end;
    v_legacy_id := private.resolve_owned_recipe_legacy_id(p_user_id, v_recipe_uuid);
    v_result := v_result || jsonb_build_object(v_legacy_id, v_assignment.value);
  end loop;
  return v_result;
end;
$$;

alter function private.resolve_owned_recipe_legacy_id(uuid, uuid) owner to postgres;
alter function private.resolve_owned_recipe_legacy_array(uuid, uuid[]) owner to postgres;
alter function private.resolve_owned_recipe_legacy_assignments(uuid, jsonb) owner to postgres;
revoke all privileges on function private.resolve_owned_recipe_legacy_id(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.resolve_owned_recipe_legacy_array(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all privileges on function private.resolve_owned_recipe_legacy_assignments(uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.resolve_recipe_identity(
  p_recipe_uuid uuid default null,
  p_legacy_id text default null
)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
  v_from_uuid uuid;
  v_from_legacy uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_recipe_uuid is null and nullif(p_legacy_id, '') is null then
    raise exception 'recipe identity is required' using errcode = '22023';
  end if;
  if p_recipe_uuid is not null then
    select recipe.recipe_uuid into v_from_uuid
    from public.recipes as recipe
    where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid;
    if v_from_uuid is null then
      raise exception 'recipe UUID is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
  end if;
  if nullif(p_legacy_id, '') is not null then
    select recipe.recipe_uuid into v_from_legacy
    from public.recipes as recipe
    where recipe.user_id = v_user_id and recipe.id = p_legacy_id;
    if v_from_legacy is null then
      raise exception 'legacy recipe identity is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
  end if;
  if v_from_uuid is not null and v_from_legacy is not null
    and v_from_uuid <> v_from_legacy then
    raise exception 'recipe UUID and legacy identity disagree' using errcode = '23503';
  end if;
  return coalesce(v_from_uuid, v_from_legacy);
end;
$$;

alter function public.resolve_recipe_identity(uuid, text) owner to postgres;
revoke all privileges on function public.resolve_recipe_identity(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_recipe_identity(uuid, text) to authenticated;

create or replace function private.sync_weekly_plan_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text[];
  v_expected_uuid uuid[];
  v_legacy_json jsonb;
  v_uuid_json jsonb;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  v_legacy_changed := tg_op = 'INSERT' and cardinality(new.recipe_ids) > 0
    or tg_op = 'UPDATE' and new.recipe_ids is distinct from old.recipe_ids;
  v_uuid_changed := tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0
    or tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.recipe_uuids);
    if v_legacy_changed and new.recipe_ids <> v_expected_legacy then
      raise exception 'weekly plan legacy and UUID memberships disagree' using errcode = '23503';
    end if;
    new.recipe_ids := v_expected_legacy;
  else
    v_expected_uuid := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
    new.recipe_uuids := v_expected_uuid;
  end if;

  v_legacy_changed := tg_op = 'INSERT' and coalesce(new.day_assignments, '{}'::jsonb) <> '{}'::jsonb
    or tg_op = 'UPDATE' and new.day_assignments is distinct from old.day_assignments;
  v_uuid_changed := tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb
    or tg_op = 'UPDATE' and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids;
  if v_uuid_changed then
    v_legacy_json := private.resolve_owned_recipe_legacy_assignments(
      new.user_id, new.day_assignment_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.day_assignments, '{}'::jsonb) <> v_legacy_json then
      raise exception 'weekly plan legacy and UUID assignments disagree' using errcode = '23503';
    end if;
    new.day_assignments := nullif(v_legacy_json, '{}'::jsonb);
  else
    v_uuid_json := private.resolve_owned_recipe_assignment_keys(
      new.user_id, coalesce(new.day_assignments, '{}'::jsonb)
    );
    new.day_assignment_recipe_uuids := v_uuid_json;
  end if;

  v_legacy_changed := tg_op = 'INSERT' and cardinality(new.made_recipe_ids) > 0
    or tg_op = 'UPDATE' and new.made_recipe_ids is distinct from old.made_recipe_ids;
  v_uuid_changed := tg_op = 'INSERT' and cardinality(new.made_recipe_uuids) > 0
    or tg_op = 'UPDATE' and new.made_recipe_uuids is distinct from old.made_recipe_uuids;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.made_recipe_uuids);
    if v_legacy_changed and new.made_recipe_ids <> v_expected_legacy then
      raise exception 'weekly plan legacy and UUID made-state disagree' using errcode = '23503';
    end if;
    new.made_recipe_ids := v_expected_legacy;
  else
    new.made_recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.made_recipe_ids);
  end if;
  return new;
end;
$$;

create or replace function private.sync_plan_template_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text[];
  v_legacy_json jsonb;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := tg_op = 'INSERT' and cardinality(new.recipe_ids) > 0
    or tg_op = 'UPDATE' and new.recipe_ids is distinct from old.recipe_ids;
  v_uuid_changed := tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0
    or tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.recipe_uuids);
    if v_legacy_changed and new.recipe_ids <> v_expected_legacy then
      raise exception 'template legacy and UUID memberships disagree' using errcode = '23503';
    end if;
    new.recipe_ids := v_expected_legacy;
  else
    new.recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
  end if;

  v_legacy_changed := tg_op = 'INSERT' and coalesce(new.day_assignments, '{}'::jsonb) <> '{}'::jsonb
    or tg_op = 'UPDATE' and new.day_assignments is distinct from old.day_assignments;
  v_uuid_changed := tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb
    or tg_op = 'UPDATE' and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids;
  if v_uuid_changed then
    v_legacy_json := private.resolve_owned_recipe_legacy_assignments(
      new.user_id, new.day_assignment_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.day_assignments, '{}'::jsonb) <> v_legacy_json then
      raise exception 'template legacy and UUID assignments disagree' using errcode = '23503';
    end if;
    new.day_assignments := nullif(v_legacy_json, '{}'::jsonb);
  else
    new.day_assignment_recipe_uuids := private.resolve_owned_recipe_assignment_keys(
      new.user_id, coalesce(new.day_assignments, '{}'::jsonb)
    );
  end if;
  return new;
end;
$$;

create or replace function private.sync_recipe_history_uuid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text;
  v_expected_uuid uuid;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := tg_op = 'INSERT' and nullif(new.recipe_id, '') is not null
    or tg_op = 'UPDATE' and new.recipe_id is distinct from old.recipe_id;
  v_uuid_changed := tg_op = 'INSERT' and new.recipe_uuid is not null
    or tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid;

  if v_uuid_changed then
    if new.recipe_uuid is null then
      raise exception 'active recipe history UUID is required' using errcode = '23503';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if v_legacy_changed and new.recipe_id <> v_expected_legacy then
      raise exception 'history legacy and UUID identities disagree' using errcode = '23503';
    end if;
    new.recipe_id := v_expected_legacy;
  elsif v_legacy_changed then
    select recipe.recipe_uuid into v_expected_uuid
    from public.recipes as recipe
    where recipe.user_id = new.user_id and recipe.id = new.recipe_id;
    new.recipe_uuid := v_expected_uuid;
  else
    raise exception 'recipe history identity is required' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function private.sync_shopping_contribution_recipe_uuid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text;
  v_expected_uuid uuid;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := tg_op = 'INSERT' and nullif(new.recipe_id, '') is not null
    or tg_op = 'UPDATE' and new.recipe_id is distinct from old.recipe_id;
  v_uuid_changed := tg_op = 'INSERT' and new.recipe_uuid is not null
    or tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid;
  if v_uuid_changed then
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe UUID is required' using errcode = '23503';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if v_legacy_changed and new.recipe_id <> v_expected_legacy then
      raise exception 'shopping contribution identities disagree' using errcode = '23503';
    end if;
    new.recipe_id := v_expected_legacy;
  else
    select recipe.recipe_uuid into v_expected_uuid
    from public.recipes as recipe
    where recipe.user_id = new.user_id and recipe.id = new.recipe_id;
    if v_expected_uuid is null then
      raise exception 'shopping contribution recipe is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
    new.recipe_uuid := v_expected_uuid;
  end if;
  if jsonb_typeof(new.snapshot) = 'object'
    and jsonb_typeof(new.snapshot -> 'items') = 'array' then
    new.snapshot := jsonb_set(
      new.snapshot, '{items}',
      private.compat_recipe_source_items_from_uuid(new.user_id, new.snapshot -> 'items'), true
    );
  end if;
  if jsonb_typeof(new.snapshot) = 'object'
    and jsonb_typeof(new.snapshot -> 'items') = 'array' then
    perform private.validate_recipe_source_items(new.user_id, new.snapshot -> 'items');
  end if;
  new.snapshot := private.enrich_recipe_contribution_snapshot(new.user_id, new.snapshot);
  return new;
end;
$$;

create or replace function private.sync_recipe_share_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text;
  v_expected_uuid uuid;
begin
  if v_authenticated_user_id is not null
    and v_authenticated_user_id <> new.sender_user_id
    and v_authenticated_user_id <> new.recipient_user_id then
    raise exception 'recipe share owner does not match authenticated user' using errcode = '42501';
  elsif v_authenticated_user_id is null and session_user <> 'postgres' then
    raise exception 'recipe share synchronization requires an authenticated participant'
      using errcode = '42501';
  end if;

  v_legacy_changed := tg_op = 'INSERT' and nullif(new.source_recipe_id, '') is not null
    or tg_op = 'UPDATE' and new.source_recipe_id is distinct from old.source_recipe_id;
  v_uuid_changed := tg_op = 'INSERT' and new.source_recipe_uuid is not null
    or tg_op = 'UPDATE' and new.source_recipe_uuid is distinct from old.source_recipe_uuid;
  if v_uuid_changed then
    if new.source_recipe_uuid is null then
      if new.status = 'pending' then
        raise exception 'pending share source UUID is required' using errcode = '23503';
      end if;
    else
      v_expected_legacy := private.resolve_owned_recipe_legacy_id(
        new.sender_user_id, new.source_recipe_uuid
      );
      if v_legacy_changed and new.source_recipe_id <> v_expected_legacy then
        raise exception 'share source identities disagree' using errcode = '23503';
      end if;
      new.source_recipe_id := v_expected_legacy;
    end if;
  elsif v_legacy_changed then
    select recipe.recipe_uuid into v_expected_uuid
    from public.recipes as recipe
    where recipe.user_id = new.sender_user_id and recipe.id = new.source_recipe_id;
    if new.status = 'pending' and v_expected_uuid is null then
      raise exception 'pending share source is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
    new.source_recipe_uuid := v_expected_uuid;
  elsif tg_op = 'INSERT' then
    raise exception 'share source identity is required' using errcode = '23503';
  end if;

  v_legacy_changed := tg_op = 'INSERT' and new.accepted_recipe_id is not null
    or tg_op = 'UPDATE' and new.accepted_recipe_id is distinct from old.accepted_recipe_id;
  v_uuid_changed := tg_op = 'INSERT' and new.accepted_recipe_uuid is not null
    or tg_op = 'UPDATE' and new.accepted_recipe_uuid is distinct from old.accepted_recipe_uuid;
  if v_uuid_changed then
    if new.accepted_recipe_uuid is null then
      new.accepted_recipe_id := null;
    else
      v_expected_legacy := private.resolve_owned_recipe_legacy_id(
        new.recipient_user_id, new.accepted_recipe_uuid
      );
      if v_legacy_changed and new.accepted_recipe_id <> v_expected_legacy then
        raise exception 'share accepted-copy identities disagree' using errcode = '23503';
      end if;
      new.accepted_recipe_id := v_expected_legacy;
    end if;
  elsif v_legacy_changed then
    select recipe.recipe_uuid into v_expected_uuid
    from public.recipes as recipe
    where recipe.user_id = new.recipient_user_id and recipe.id = new.accepted_recipe_id;
    if v_authenticated_user_id is not null and new.status = 'accepted'
      and new.accepted_recipe_id is not null and v_expected_uuid is null then
      raise exception 'accepted share copy is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
    new.accepted_recipe_uuid := v_expected_uuid;
  end if;
  return new;
end;
$$;

create or replace function private.sync_shopping_list_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text[];
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := tg_op = 'INSERT' and cardinality(coalesce(new.source_recipes, '{}'::text[])) > 0
    or tg_op = 'UPDATE' and new.source_recipes is distinct from old.source_recipes;
  v_uuid_changed := tg_op = 'INSERT' and cardinality(new.source_recipe_uuids) > 0
    or tg_op = 'UPDATE' and new.source_recipe_uuids is distinct from old.source_recipe_uuids;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(
      new.user_id, new.source_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.source_recipes, '{}'::text[]) <> v_expected_legacy then
      raise exception 'shopping source identities disagree' using errcode = '23503';
    end if;
    new.source_recipes := v_expected_legacy;
  else
    new.source_recipe_uuids := private.resolve_owned_recipe_uuid_array(
      new.user_id, coalesce(new.source_recipes, '{}'::text[])
    );
  end if;
  new.items := private.compat_recipe_source_items_from_uuid(new.user_id, new.items);
  new.already_have := private.compat_recipe_source_items_from_uuid(new.user_id, new.already_have);
  new.excluded := private.compat_recipe_source_items_from_uuid(new.user_id, new.excluded);
  perform private.validate_recipe_source_items(new.user_id, new.items);
  perform private.validate_recipe_source_items(new.user_id, new.already_have);
  perform private.validate_recipe_source_items(new.user_id, new.excluded);
  new.items := private.enrich_recipe_source_items(new.user_id, new.items);
  new.already_have := private.enrich_recipe_source_items(new.user_id, new.already_have);
  new.excluded := private.enrich_recipe_source_items(new.user_id, new.excluded);
  return new;
end;
$$;

revoke all privileges on function private.sync_recipe_share_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_shopping_list_recipe_uuids()
  from public, anon, authenticated, service_role;

create function public.toggle_weekly_recipe_made(
  p_recipe_uuid uuid,
  p_week_date text,
  p_is_made_for_week boolean,
  p_date_made timestamptz default null
)
returns table(
  action text,
  recipe_uuid uuid,
  week_date text,
  made_recipe_uuids uuid[],
  history_date_made timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan public.weekly_plans%rowtype;
  v_history_date timestamptz;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform private.resolve_owned_recipe_legacy_id(v_user_id, p_recipe_uuid);
  select * into v_plan from public.weekly_plans
  where user_id = v_user_id and weekly_plans.week_date = p_week_date for update;
  if not found then raise exception 'weekly plan not found' using errcode = 'P0002'; end if;

  if p_is_made_for_week then
    v_plan.made_recipe_uuids := array_remove(v_plan.made_recipe_uuids, p_recipe_uuid);
    delete from public.recipe_history
    where id = (
      select id from public.recipe_history
      where user_id = v_user_id and recipe_uuid = p_recipe_uuid
      order by date_made desc limit 1
    );
    action := 'unmarked';
    v_history_date := null;
  else
    if not p_recipe_uuid = any(v_plan.made_recipe_uuids) then
      v_plan.made_recipe_uuids := array_append(v_plan.made_recipe_uuids, p_recipe_uuid);
    end if;
    v_history_date := coalesce(p_date_made, now());
    insert into public.recipe_history(user_id, recipe_uuid, date_made)
    values (v_user_id, p_recipe_uuid, v_history_date);
    action := 'marked';
  end if;

  update public.weekly_plans
  set made_recipe_uuids = v_plan.made_recipe_uuids
  where user_id = v_user_id and weekly_plans.week_date = p_week_date;
  recipe_uuid := p_recipe_uuid;
  week_date := p_week_date;
  made_recipe_uuids := v_plan.made_recipe_uuids;
  history_date_made := v_history_date;
  return next;
end;
$$;

alter function public.toggle_weekly_recipe_made(uuid, text, boolean, timestamptz)
  owner to postgres;
revoke all privileges on function public.toggle_weekly_recipe_made(uuid, text, boolean, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.toggle_weekly_recipe_made(uuid, text, boolean, timestamptz)
  to authenticated;

drop function public.accept_recipe_share(uuid);
create function public.accept_recipe_share(p_share_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.recipe_shares%rowtype;
  v_new_recipe_uuid uuid := gen_random_uuid();
  v_name text;
  v_category text;
  v_servings integer;
  v_tags text[];
  v_instructions text[];
begin
  if v_user_id is null then raise exception 'Unauthorized' using errcode = '42501'; end if;
  select * into v_share from public.recipe_shares
  where id = p_share_id and recipient_user_id = v_user_id for update;
  if not found then raise exception 'Share not found'; end if;
  if v_share.status = 'accepted' and v_share.accepted_recipe_uuid is not null then
    return v_share.accepted_recipe_uuid;
  end if;
  if v_share.status <> 'pending' then raise exception 'Share is no longer pending'; end if;

  v_name := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'name'), ''), 'Shared Recipe');
  v_category := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'category'), ''), 'uncategorized');
  v_servings := coalesce((v_share.source_recipe_snapshot->>'servings')::integer, 4);
  select coalesce(array_agg(value), '{}'::text[]) into v_tags
  from jsonb_array_elements_text(coalesce(v_share.source_recipe_snapshot->'tags', '[]'::jsonb));
  select coalesce(array_agg(value), '{}'::text[]) into v_instructions
  from jsonb_array_elements_text(coalesce(v_share.source_recipe_snapshot->'instructions', '[]'::jsonb));

  insert into public.recipes(
    id, recipe_uuid, user_id, name, category, servings, favorite, tags,
    ingredients, instructions, image_url, prep_time_minutes,
    cook_time_minutes, total_time_minutes, notes, instruction_groups
  ) values (
    v_new_recipe_uuid::text, v_new_recipe_uuid, v_user_id, v_name, v_category,
    v_servings, false, v_tags,
    coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb),
    v_instructions, nullif(trim(v_share.source_recipe_snapshot->>'image_url'), ''),
    nullif(v_share.source_recipe_snapshot->>'prep_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'cook_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'total_time_minutes', '')::integer,
    coalesce(v_share.source_recipe_snapshot->'notes', '[]'::jsonb),
    v_share.source_recipe_snapshot->'instruction_groups'
  );

  update public.recipe_shares
  set status = 'accepted', accepted_recipe_uuid = v_new_recipe_uuid, responded_at = now()
  where id = v_share.id;
  return v_new_recipe_uuid;
end;
$$;

alter function public.accept_recipe_share(uuid) owner to postgres;
revoke all privileges on function public.accept_recipe_share(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_recipe_share(uuid) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users' or tg_op <> 'INSERT' then
    raise exception 'handle_new_user must run from the auth.users insert trigger';
  end if;
  begin
    insert into public.user_config(user_id) values (new.id) on conflict (user_id) do nothing;
    insert into public.shopping_list(user_id) values (new.id) on conflict (user_id) do nothing;
    insert into public.recipes(
      id, recipe_uuid, user_id, name, category, servings, favorite, tags,
      ingredients, instructions
    )
    select seed.recipe_uuid::text, seed.recipe_uuid, new.id, seed.name,
      seed.category, seed.servings, seed.favorite, seed.tags, seed.ingredients,
      seed.instructions
    from (
      values
        (gen_random_uuid(), '4-Ingredient Mac & Cheese', 'vegetarian', 4, false,
          array['default'],
          '[{"item":"elbow macaroni","unit":"oz","amount":8},{"item":"milk","unit":"cup","amount":2},{"item":"cheddar cheese","unit":"cups","amount":2}]'::jsonb,
          array['Boil pasta.', 'Warm milk.', 'Stir in cheese.', 'Combine and serve.']),
        (gen_random_uuid(), 'Beef and Broccoli', 'beef', 4, true,
          array['default'],
          '[{"item":"beef","unit":"lb","amount":1},{"item":"broccoli","unit":"cups","amount":3}]'::jsonb,
          array['Sear beef.', 'Stir-fry broccoli.', 'Combine with sauce.']),
        (gen_random_uuid(), 'Turkey Burger', 'turkey', 4, false,
          array['default'], '[{"item":"ground turkey","unit":"lb","amount":1}]'::jsonb,
          array['Form patties.', 'Cook until done.', 'Serve with toppings.'])
    ) as seed(recipe_uuid, name, category, servings, favorite, tags, ingredients, instructions);
  exception when others then
    raise warning 'Could not insert defaults for user %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;

create function private.compat_recipe_source_array_from_uuid(
  p_user_id uuid,
  p_sources jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_source record;
  v_recipe_uuid uuid;
  v_legacy_id text;
begin
  if jsonb_typeof(coalesce(p_sources, '[]'::jsonb)) <> 'array' then
    raise exception 'shopping recipe sources must be an array' using errcode = '22023';
  end if;
  for v_source in select value from jsonb_array_elements(coalesce(p_sources, '[]'::jsonb))
  loop
    v_recipe_uuid := null;
    if nullif(v_source.value ->> 'recipeUuid', '') is not null then
      begin v_recipe_uuid := (v_source.value ->> 'recipeUuid')::uuid;
      exception when invalid_text_representation then
        raise exception 'shopping recipe source UUID is malformed' using errcode = '22023';
      end;
    elsif nullif(v_source.value ->> 'recipeId', '') is not null then
      begin v_recipe_uuid := (v_source.value ->> 'recipeId')::uuid;
      exception when invalid_text_representation then
        -- Preserve unresolved historical provenance without inventing linkage.
        v_result := v_result || jsonb_build_array(v_source.value);
        continue;
      end;
    end if;
    if v_recipe_uuid is null then
      v_result := v_result || jsonb_build_array(v_source.value);
      continue;
    end if;
    v_legacy_id := private.resolve_owned_recipe_legacy_id(p_user_id, v_recipe_uuid);
    v_result := v_result || jsonb_build_array(
      (v_source.value - 'recipeId' - 'legacyRecipeId' - 'recipeUuid')
      || jsonb_build_object('recipeId', v_legacy_id, 'recipeUuid', v_recipe_uuid)
    );
  end loop;
  return v_result;
end;
$$;

create function private.compat_recipe_source_items_from_uuid(
  p_user_id uuid,
  p_items jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case when jsonb_typeof(item.value -> 'sources') = 'array'
      then jsonb_set(
        item.value, '{sources}',
        private.compat_recipe_source_array_from_uuid(p_user_id, item.value -> 'sources'), true
      )
      else item.value end
    order by item.position
  ), '[]'::jsonb)
  from jsonb_array_elements(
    case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
  ) with ordinality as item(value, position);
$$;

alter function private.compat_recipe_source_array_from_uuid(uuid, jsonb) owner to postgres;
alter function private.compat_recipe_source_items_from_uuid(uuid, jsonb) owner to postgres;
revoke all privileges on function private.compat_recipe_source_array_from_uuid(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.compat_recipe_source_items_from_uuid(uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.apply_recipe_shopping_contribution_uuid_command(
  p_expected_revision bigint,
  p_contributions jsonb,
  p_remove_recipe_uuids uuid[],
  p_projection jsonb,
  p_contribution_overrides jsonb,
  p_idempotency_key text,
  p_command_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_contribution jsonb;
  v_recipe_uuid uuid;
  v_legacy_id text;
  v_legacy_contributions jsonb := '[]'::jsonb;
  v_legacy_projection jsonb;
  v_legacy_remove_ids text[];
  v_snapshot jsonb;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_contributions, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid contribution payload' using errcode = '22023';
  end if;
  for v_contribution in
    select value from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb))
  loop
    begin v_recipe_uuid := nullif(v_contribution ->> 'recipe_uuid', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'contribution recipe UUID is malformed' using errcode = '22023';
    end;
    if v_recipe_uuid is null then
      raise exception 'contribution recipe UUID is required' using errcode = '22023';
    end if;
    v_legacy_id := private.resolve_owned_recipe_legacy_id(v_user_id, v_recipe_uuid);
    v_snapshot := v_contribution -> 'snapshot';
    if jsonb_typeof(v_snapshot) = 'object' and jsonb_typeof(v_snapshot -> 'items') = 'array' then
      v_snapshot := jsonb_set(
        v_snapshot, '{items}',
        private.compat_recipe_source_items_from_uuid(v_user_id, v_snapshot -> 'items'), true
      );
    end if;
    v_legacy_contributions := v_legacy_contributions || jsonb_build_array(
      (v_contribution - 'recipe_uuid' - 'snapshot')
      || jsonb_build_object('recipe_id', v_legacy_id, 'snapshot', v_snapshot)
    );
  end loop;

  v_legacy_remove_ids := private.resolve_owned_recipe_legacy_array(
    v_user_id, coalesce(p_remove_recipe_uuids, '{}'::uuid[])
  );
  v_legacy_projection := p_projection;
  v_legacy_projection := jsonb_set(
    v_legacy_projection, '{source_recipes}',
    to_jsonb(private.resolve_owned_recipe_legacy_array(
      v_user_id,
      coalesce(array(
        select value::text::uuid
        from jsonb_array_elements_text(
          coalesce(p_projection -> 'source_recipe_uuids', '[]'::jsonb)
        )
      ), '{}'::uuid[])
    )), true
  );
  v_legacy_projection := jsonb_set(
    v_legacy_projection, '{items}',
    private.compat_recipe_source_items_from_uuid(v_user_id, p_projection -> 'items'), true
  );
  v_legacy_projection := jsonb_set(
    v_legacy_projection, '{already_have}',
    private.compat_recipe_source_items_from_uuid(v_user_id, p_projection -> 'already_have'), true
  );
  v_legacy_projection := jsonb_set(
    v_legacy_projection, '{excluded}',
    private.compat_recipe_source_items_from_uuid(v_user_id, p_projection -> 'excluded'), true
  );

  return public.apply_recipe_shopping_contribution_command(
    p_expected_revision,
    v_legacy_contributions,
    v_legacy_remove_ids,
    v_legacy_projection,
    p_contribution_overrides,
    p_idempotency_key,
    p_command_type
  );
end;
$$;

alter function public.apply_recipe_shopping_contribution_uuid_command(
  bigint, jsonb, uuid[], jsonb, jsonb, text, text
) owner to postgres;
revoke all privileges on function public.apply_recipe_shopping_contribution_uuid_command(
  bigint, jsonb, uuid[], jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_recipe_shopping_contribution_uuid_command(
  bigint, jsonb, uuid[], jsonb, jsonb, text, text
) to authenticated;

-- Freeze both sides of the permanent one-to-one recipe identity mapping.
create function private.prevent_recipe_identity_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'legacy recipe alias is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
alter function private.prevent_recipe_identity_change() owner to postgres;
revoke all privileges on function private.prevent_recipe_identity_change()
  from public, anon, authenticated, service_role;
create trigger prevent_recipe_identity_change
before update of id on public.recipes
for each row execute function private.prevent_recipe_identity_change();

-- Canonical history statistics: unresolved historical rows remain evidence but
-- are not invented into a live UUID relationship.
drop function public.get_recipe_history_stats();
create function public.get_recipe_history_stats()
returns table(recipe_id uuid, times_made integer, last_made timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  return query
  select history.recipe_uuid, count(*)::integer, max(history.date_made)
  from public.recipe_history as history
  where history.user_id = v_user_id and history.recipe_uuid is not null
  group by history.recipe_uuid
  order by max(history.date_made) desc;
end;
$$;

alter function public.get_recipe_history_stats() owner to postgres;
revoke all privileges on function public.get_recipe_history_stats()
  from public, anon, authenticated, service_role;
grant execute on function public.get_recipe_history_stats() to authenticated;

-- All private trigger helpers stay unreachable through the Data API.
revoke all privileges on function private.sync_weekly_plan_recipe_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_plan_template_recipe_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_recipe_history_uuid()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_shopping_contribution_recipe_uuid()
  from public, anon, authenticated, service_role;

commit;
