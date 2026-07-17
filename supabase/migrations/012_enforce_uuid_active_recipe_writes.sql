-- Stage 2C: canonical UUID identity is required for every active recipe write.
-- Legacy aliases remain derived compatibility output and historical evidence.

begin;

-- Active recipe creation must supply a UUID. Trusted server functions already
-- allocate one explicitly; removing the default makes missing identity fail.
alter table public.recipes alter column recipe_uuid drop default;

create function private.enforce_recipe_uuid_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  if new.recipe_uuid is null and auth.uid() is null and session_user = 'postgres' then
    -- Reset/migration fixtures remain able to model pre-UUID rows without
    -- becoming an authenticated application compatibility path.
    new.recipe_uuid := gen_random_uuid();
  elsif new.recipe_uuid is null then
    raise exception 'recipe UUID is required' using errcode = '22023';
  end if;
  if nullif(new.id, '') is null then
    new.id := new.recipe_uuid::text;
  elsif auth.uid() is not null and new.id <> new.recipe_uuid::text then
    raise exception 'recipe UUID and legacy identity disagree' using errcode = '23503';
  end if;
  return new;
end;
$$;

alter function private.enforce_recipe_uuid_insert() owner to postgres;
revoke all privileges on function private.enforce_recipe_uuid_insert()
  from public, anon, authenticated, service_role;

create trigger enforce_recipe_uuid_insert
before insert on public.recipes
for each row execute function private.enforce_recipe_uuid_insert();

-- One explicit same-owner alias resolver remains for old external references.
-- Only alias-bearing calls are counted; normal UUID commands use private UUID
-- helpers and never pass through this compatibility seam.
create table private.recipe_identity_compat_usage (
  usage_date date primary key,
  lookup_count bigint not null default 0 check (lookup_count >= 0),
  last_used_at timestamptz not null default now()
);

revoke all privileges on table private.recipe_identity_compat_usage
  from public, anon, authenticated, service_role;

create or replace function public.resolve_recipe_identity(
  p_recipe_uuid uuid default null,
  p_legacy_id text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
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
    insert into private.recipe_identity_compat_usage(usage_date, lookup_count, last_used_at)
    values (current_date, 1, now())
    on conflict (usage_date) do update
    set lookup_count = private.recipe_identity_compat_usage.lookup_count + 1,
        last_used_at = excluded.last_used_at;
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

create function public.get_recipe_identity_compat_usage()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return coalesce((select sum(lookup_count) from private.recipe_identity_compat_usage), 0);
end;
$$;

alter function public.get_recipe_identity_compat_usage() owner to postgres;
revoke all privileges on function public.get_recipe_identity_compat_usage()
  from public, anon, authenticated, service_role;
grant execute on function public.get_recipe_identity_compat_usage() to authenticated;

-- Planner and template mirrors now flow in one direction: UUID -> legacy.
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
  v_expected_json jsonb;
  v_internal_migration boolean := auth.uid() is null and session_user = 'postgres';
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  v_legacy_changed := (tg_op = 'INSERT' and cardinality(new.recipe_ids) > 0)
    or (tg_op = 'UPDATE' and new.recipe_ids is distinct from old.recipe_ids);
  v_uuid_changed := (tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0)
    or (tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids);
  if v_legacy_changed and not v_uuid_changed then
    if v_internal_migration then
      new.recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
      v_uuid_changed := true;
    else
      raise exception 'weekly plan recipe UUIDs are required' using errcode = '22023';
    end if;
  end if;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.recipe_uuids);
    if v_legacy_changed and new.recipe_ids <> v_expected_legacy then
      raise exception 'weekly plan legacy and UUID memberships disagree' using errcode = '23503';
    end if;
    new.recipe_ids := v_expected_legacy;
  end if;

  v_legacy_changed := (tg_op = 'INSERT' and coalesce(new.day_assignments, '{}'::jsonb) <> '{}'::jsonb)
    or (tg_op = 'UPDATE' and new.day_assignments is distinct from old.day_assignments);
  v_uuid_changed := (tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb)
    or (tg_op = 'UPDATE' and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids);
  if v_legacy_changed and not v_uuid_changed then
    if v_internal_migration then
      new.day_assignment_recipe_uuids := private.resolve_owned_recipe_assignment_keys(
        new.user_id, coalesce(new.day_assignments, '{}'::jsonb)
      );
      v_uuid_changed := true;
    else
      raise exception 'weekly plan assignment UUIDs are required' using errcode = '22023';
    end if;
  end if;
  if v_uuid_changed then
    v_expected_json := private.resolve_owned_recipe_legacy_assignments(
      new.user_id, new.day_assignment_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.day_assignments, '{}'::jsonb) <> v_expected_json then
      raise exception 'weekly plan legacy and UUID assignments disagree' using errcode = '23503';
    end if;
    new.day_assignments := nullif(v_expected_json, '{}'::jsonb);
  end if;

  v_legacy_changed := (tg_op = 'INSERT' and cardinality(new.made_recipe_ids) > 0)
    or (tg_op = 'UPDATE' and new.made_recipe_ids is distinct from old.made_recipe_ids);
  v_uuid_changed := (tg_op = 'INSERT' and cardinality(new.made_recipe_uuids) > 0)
    or (tg_op = 'UPDATE' and new.made_recipe_uuids is distinct from old.made_recipe_uuids);
  if v_legacy_changed and not v_uuid_changed then
    if v_internal_migration then
      new.made_recipe_uuids := private.resolve_owned_recipe_uuid_array(
        new.user_id, new.made_recipe_ids
      );
      v_uuid_changed := true;
    else
      raise exception 'weekly plan made-state UUIDs are required' using errcode = '22023';
    end if;
  end if;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.made_recipe_uuids);
    if v_legacy_changed and new.made_recipe_ids <> v_expected_legacy then
      raise exception 'weekly plan legacy and UUID made-state disagree' using errcode = '23503';
    end if;
    new.made_recipe_ids := v_expected_legacy;
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
  v_expected_json jsonb;
  v_internal_migration boolean := auth.uid() is null and session_user = 'postgres';
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := (tg_op = 'INSERT' and cardinality(new.recipe_ids) > 0)
    or (tg_op = 'UPDATE' and new.recipe_ids is distinct from old.recipe_ids);
  v_uuid_changed := (tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0)
    or (tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids);
  if v_legacy_changed and not v_uuid_changed then
    if v_internal_migration then
      new.recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
      v_uuid_changed := true;
    else
      raise exception 'template recipe UUIDs are required' using errcode = '22023';
    end if;
  end if;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(new.user_id, new.recipe_uuids);
    if v_legacy_changed and new.recipe_ids <> v_expected_legacy then
      raise exception 'template legacy and UUID memberships disagree' using errcode = '23503';
    end if;
    new.recipe_ids := v_expected_legacy;
  end if;

  v_legacy_changed := (tg_op = 'INSERT' and coalesce(new.day_assignments, '{}'::jsonb) <> '{}'::jsonb)
    or (tg_op = 'UPDATE' and new.day_assignments is distinct from old.day_assignments);
  v_uuid_changed := (tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb)
    or (tg_op = 'UPDATE' and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids);
  if v_legacy_changed and not v_uuid_changed then
    if v_internal_migration then
      new.day_assignment_recipe_uuids := private.resolve_owned_recipe_assignment_keys(
        new.user_id, coalesce(new.day_assignments, '{}'::jsonb)
      );
      v_uuid_changed := true;
    else
      raise exception 'template assignment UUIDs are required' using errcode = '22023';
    end if;
  end if;
  if v_uuid_changed then
    v_expected_json := private.resolve_owned_recipe_legacy_assignments(
      new.user_id, new.day_assignment_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.day_assignments, '{}'::jsonb) <> v_expected_json then
      raise exception 'template legacy and UUID assignments disagree' using errcode = '23503';
    end if;
    new.day_assignments := nullif(v_expected_json, '{}'::jsonb);
  end if;
  return new;
end;
$$;

-- Live history requires UUID. Migration-owner inserts can still preserve an
-- unresolved legacy-only record as historical evidence.
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
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := (tg_op = 'INSERT' and nullif(new.recipe_id, '') is not null)
    or (tg_op = 'UPDATE' and new.recipe_id is distinct from old.recipe_id);
  v_uuid_changed := (tg_op = 'INSERT' and new.recipe_uuid is not null)
    or (tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid);
  if v_uuid_changed then
    if new.recipe_uuid is null then
      raise exception 'active recipe history UUID is required' using errcode = '22023';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if v_legacy_changed and new.recipe_id <> v_expected_legacy then
      raise exception 'history legacy and UUID identities disagree' using errcode = '23503';
    end if;
    new.recipe_id := v_expected_legacy;
  elsif v_legacy_changed and auth.uid() is not null then
    raise exception 'active recipe history UUID is required' using errcode = '22023';
  elsif v_legacy_changed then
    select recipe.recipe_uuid into new.recipe_uuid
    from public.recipes as recipe
    where recipe.user_id = new.user_id and recipe.id = new.recipe_id;
  elsif not v_legacy_changed then
    raise exception 'recipe history identity is required' using errcode = '22023';
  end if;
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
begin
  if v_authenticated_user_id is not null
    and v_authenticated_user_id <> new.sender_user_id
    and v_authenticated_user_id <> new.recipient_user_id then
    raise exception 'recipe share owner does not match authenticated user' using errcode = '42501';
  elsif v_authenticated_user_id is null and session_user <> 'postgres' then
    raise exception 'recipe share synchronization requires an authenticated participant'
      using errcode = '42501';
  end if;

  v_legacy_changed := (tg_op = 'INSERT' and nullif(new.source_recipe_id, '') is not null)
    or (tg_op = 'UPDATE' and new.source_recipe_id is distinct from old.source_recipe_id);
  v_uuid_changed := (tg_op = 'INSERT' and new.source_recipe_uuid is not null)
    or (tg_op = 'UPDATE' and new.source_recipe_uuid is distinct from old.source_recipe_uuid);
  if v_uuid_changed then
    if new.source_recipe_uuid is null and new.status = 'pending' then
      raise exception 'pending share source UUID is required' using errcode = '22023';
    elsif new.source_recipe_uuid is not null then
      v_expected_legacy := private.resolve_owned_recipe_legacy_id(
        new.sender_user_id, new.source_recipe_uuid
      );
      if v_legacy_changed and new.source_recipe_id <> v_expected_legacy then
        raise exception 'share source identities disagree' using errcode = '23503';
      end if;
      new.source_recipe_id := v_expected_legacy;
    end if;
  elsif v_legacy_changed and v_authenticated_user_id is not null then
    raise exception 'active share source UUID is required' using errcode = '22023';
  elsif v_legacy_changed then
    select recipe.recipe_uuid into new.source_recipe_uuid
    from public.recipes as recipe
    where recipe.user_id = new.sender_user_id and recipe.id = new.source_recipe_id;
  elsif tg_op = 'INSERT' and new.status = 'pending' then
    if v_authenticated_user_id is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    raise exception 'pending share source UUID is required' using errcode = '22023';
  end if;
  if new.status = 'pending' and new.source_recipe_uuid is null then
    raise exception 'pending share source is unresolved or belongs to another user'
      using errcode = '23503';
  end if;

  v_legacy_changed := (tg_op = 'INSERT' and new.accepted_recipe_id is not null)
    or (tg_op = 'UPDATE' and new.accepted_recipe_id is distinct from old.accepted_recipe_id);
  v_uuid_changed := (tg_op = 'INSERT' and new.accepted_recipe_uuid is not null)
    or (tg_op = 'UPDATE' and new.accepted_recipe_uuid is distinct from old.accepted_recipe_uuid);
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
  elsif v_legacy_changed and v_authenticated_user_id is not null then
    raise exception 'accepted share copy UUID is required' using errcode = '22023';
  elsif v_legacy_changed then
    select recipe.recipe_uuid into new.accepted_recipe_uuid
    from public.recipes as recipe
    where recipe.user_id = new.recipient_user_id and recipe.id = new.accepted_recipe_id;
  end if;
  return new;
end;
$$;

-- Reject live legacy-only shopping provenance while retaining unresolved
-- historical snapshot evidence. UUID metadata is always same-owner checked.
create or replace function private.validate_recipe_source_items(
  p_user_id uuid,
  p_items jsonb
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_item record;
  v_source record;
  v_legacy_id text;
  v_supplied_uuid uuid;
  v_owned_uuid uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'shopping recipe source items must be a JSON array' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if jsonb_typeof(v_item.value) <> 'object' then
      raise exception 'shopping recipe source item must be a JSON object' using errcode = '22023';
    end if;
    if v_item.value ? 'sources' and jsonb_typeof(v_item.value -> 'sources') <> 'array' then
      raise exception 'shopping recipe sources must be a JSON array' using errcode = '22023';
    end if;
    for v_source in select value from jsonb_array_elements(
      case when jsonb_typeof(v_item.value -> 'sources') = 'array'
        then v_item.value -> 'sources' else '[]'::jsonb end
    ) loop
      if jsonb_typeof(v_source.value) <> 'object' then
        raise exception 'shopping recipe source must be a JSON object' using errcode = '22023';
      end if;
      v_legacy_id := coalesce(
        nullif(v_source.value ->> 'recipeId', ''),
        nullif(v_source.value ->> 'legacyRecipeId', '')
      );
      v_supplied_uuid := null;
      if nullif(v_source.value ->> 'recipeUuid', '') is not null then
        begin
          v_supplied_uuid := (v_source.value ->> 'recipeUuid')::uuid;
        exception when invalid_text_representation then
          raise exception 'shopping recipe UUID metadata is malformed' using errcode = '22023';
        end;
        select recipe.recipe_uuid into v_owned_uuid
        from public.recipes as recipe
        where recipe.recipe_uuid = v_supplied_uuid and recipe.user_id = p_user_id;
        if v_owned_uuid is null then
          raise exception 'shopping recipe UUID is unresolved or belongs to another user'
            using errcode = '23503';
        end if;
        if v_legacy_id is not null and not exists (
          select 1 from public.recipes as recipe
          where recipe.user_id = p_user_id
            and recipe.recipe_uuid = v_supplied_uuid
            and recipe.id = v_legacy_id
        ) then
          raise exception 'shopping recipe legacy and UUID metadata disagree or cross owners'
            using errcode = '23503';
        end if;
      elsif auth.uid() is not null and v_legacy_id is not null and exists (
        select 1 from public.recipes as recipe
        where recipe.user_id = p_user_id and recipe.id = v_legacy_id
      ) then
        raise exception 'shopping recipe UUID metadata is required' using errcode = '22023';
      end if;
    end loop;
  end loop;
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
  v_internal_uuid_command boolean := coalesce(
    current_setting('recipe_genie.uuid_command', true), ''
  ) = 'on' or (auth.uid() is null and session_user = 'postgres');
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := (tg_op = 'INSERT' and cardinality(coalesce(new.source_recipes, '{}'::text[])) > 0)
    or (tg_op = 'UPDATE' and new.source_recipes is distinct from old.source_recipes);
  v_uuid_changed := (tg_op = 'INSERT' and cardinality(new.source_recipe_uuids) > 0)
    or (tg_op = 'UPDATE' and new.source_recipe_uuids is distinct from old.source_recipe_uuids);
  if v_legacy_changed and not v_uuid_changed and not v_internal_uuid_command then
    raise exception 'shopping source recipe UUIDs are required' using errcode = '22023';
  end if;
  if v_uuid_changed then
    v_expected_legacy := private.resolve_owned_recipe_legacy_array(
      new.user_id, new.source_recipe_uuids
    );
    if v_legacy_changed and coalesce(new.source_recipes, '{}'::text[]) <> v_expected_legacy then
      raise exception 'shopping source identities disagree' using errcode = '23503';
    end if;
    new.source_recipes := v_expected_legacy;
  elsif v_internal_uuid_command and v_legacy_changed then
    new.source_recipe_uuids := private.resolve_owned_recipe_uuid_array(
      new.user_id, coalesce(new.source_recipes, '{}'::text[])
    );
  end if;
  if auth.uid() is null and session_user = 'postgres' then
    new.items := private.enrich_recipe_source_items(new.user_id, new.items);
    new.already_have := private.enrich_recipe_source_items(new.user_id, new.already_have);
    new.excluded := private.enrich_recipe_source_items(new.user_id, new.excluded);
  end if;
  new.items := private.compat_recipe_source_items_from_uuid(new.user_id, new.items);
  new.already_have := private.compat_recipe_source_items_from_uuid(new.user_id, new.already_have);
  new.excluded := private.compat_recipe_source_items_from_uuid(new.user_id, new.excluded);
  perform private.validate_recipe_source_items(new.user_id, new.items);
  perform private.validate_recipe_source_items(new.user_id, new.already_have);
  perform private.validate_recipe_source_items(new.user_id, new.excluded);
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
  v_internal_uuid_command boolean := coalesce(
    current_setting('recipe_genie.uuid_command', true), ''
  ) = 'on' or (auth.uid() is null and session_user = 'postgres');
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := (tg_op = 'INSERT' and nullif(new.recipe_id, '') is not null)
    or (tg_op = 'UPDATE' and new.recipe_id is distinct from old.recipe_id);
  v_uuid_changed := (tg_op = 'INSERT' and new.recipe_uuid is not null)
    or (tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid);
  if v_uuid_changed then
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe UUID is required' using errcode = '22023';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if v_legacy_changed and new.recipe_id <> v_expected_legacy then
      raise exception 'shopping contribution identities disagree' using errcode = '23503';
    end if;
    new.recipe_id := v_expected_legacy;
  elsif v_internal_uuid_command and v_legacy_changed then
    select recipe.recipe_uuid into new.recipe_uuid
    from public.recipes as recipe
    where recipe.user_id = new.user_id and recipe.id = new.recipe_id;
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
  else
    raise exception 'shopping contribution recipe UUID is required' using errcode = '22023';
  end if;
  if jsonb_typeof(new.snapshot) = 'object'
    and jsonb_typeof(new.snapshot -> 'items') = 'array' then
    new.snapshot := jsonb_set(
      new.snapshot, '{items}',
      private.compat_recipe_source_items_from_uuid(new.user_id, new.snapshot -> 'items'), true
    );
    perform private.validate_recipe_source_items(new.user_id, new.snapshot -> 'items');
  end if;
  new.snapshot := private.enrich_recipe_contribution_snapshot(new.user_id, new.snapshot);
  return new;
end;
$$;

-- The legacy shopping implementation remains only as a postgres-owned helper.
-- The UUID RPC sets a transaction-local marker after validating every UUID.
revoke all privileges on function public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;

create or replace function public.apply_recipe_shopping_contribution_uuid_command(
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
    if nullif(v_contribution ->> 'recipe_id', '') is not null
      and v_contribution ->> 'recipe_id' <> v_legacy_id then
      raise exception 'contribution recipe identities disagree' using errcode = '23503';
    end if;
    v_snapshot := v_contribution -> 'snapshot';
    if jsonb_typeof(v_snapshot) = 'object' and jsonb_typeof(v_snapshot -> 'items') = 'array' then
      v_snapshot := jsonb_set(
        v_snapshot, '{items}',
        private.compat_recipe_source_items_from_uuid(v_user_id, v_snapshot -> 'items'), true
      );
    end if;
    v_legacy_contributions := v_legacy_contributions || jsonb_build_array(
      (v_contribution - 'recipe_uuid' - 'recipe_id' - 'snapshot')
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
  perform set_config('recipe_genie.uuid_command', 'on', true);
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

-- The old made-state command is no longer an active compatibility surface.
drop function public.toggle_weekly_recipe_made(text, text, boolean, timestamptz);

-- Table DELETE cannot reveal whether its predicate used UUID or legacy text.
-- Route deletion through one UUID-only same-owner command instead.
create function public.delete_recipe(p_recipe_uuid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  delete from public.recipes as recipe
  where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid
  returning recipe.recipe_uuid into v_deleted;
  if v_deleted is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  return v_deleted;
end;
$$;

alter function public.delete_recipe(uuid) owner to postgres;
revoke all privileges on function public.delete_recipe(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_recipe(uuid) to authenticated;
revoke delete on table public.recipes from public, anon, authenticated;

-- Trigger helpers remain inaccessible through the Data API.
revoke all privileges on function private.sync_weekly_plan_recipe_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_plan_template_recipe_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_recipe_history_uuid()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_recipe_share_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_shopping_list_recipe_uuids()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.sync_shopping_contribution_recipe_uuid()
  from public, anon, authenticated, service_role;
revoke all privileges on function private.validate_recipe_source_items(uuid, jsonb)
  from public, anon, authenticated, service_role;

comment on column public.weekly_plans.recipe_ids is
  'Derived legacy compatibility mirror. Active writes must supply recipe_uuids.';
comment on column public.plan_templates.recipe_ids is
  'Derived legacy compatibility mirror. Active writes must supply recipe_uuids.';
comment on column public.recipe_history.recipe_id is
  'Derived alias for live UUID writes or preserved unresolved historical evidence.';
comment on column public.shopping_list.source_recipes is
  'Derived compatibility mirror. Operational writes must supply source_recipe_uuids.';
comment on function public.resolve_recipe_identity(uuid, text) is
  'Measured same-owner compatibility lookup for old aliases; not an active command authority.';
comment on function public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
) is 'Postgres-internal compatibility implementation; active callers use the UUID command.';

-- Abort migration if the deployed data or catalog violates the Stage 2C gate.
do $$
begin
  if exists (
    select 1 from public.weekly_plans as plan
    where plan.recipe_ids <> private.resolve_owned_recipe_legacy_array(plan.user_id, plan.recipe_uuids)
       or coalesce(plan.day_assignments, '{}'::jsonb) <>
          private.resolve_owned_recipe_legacy_assignments(plan.user_id, plan.day_assignment_recipe_uuids)
       or plan.made_recipe_ids <> private.resolve_owned_recipe_legacy_array(plan.user_id, plan.made_recipe_uuids)
  ) then raise exception 'weekly plan Stage 2C parity failed'; end if;
  if exists (
    select 1 from public.plan_templates as template
    where template.recipe_ids <> private.resolve_owned_recipe_legacy_array(template.user_id, template.recipe_uuids)
       or coalesce(template.day_assignments, '{}'::jsonb) <>
          private.resolve_owned_recipe_legacy_assignments(template.user_id, template.day_assignment_recipe_uuids)
  ) then raise exception 'template Stage 2C parity failed'; end if;
  if exists (
    select 1 from public.shopping_list as shopping
    where shopping.source_recipes <> private.resolve_owned_recipe_legacy_array(
      shopping.user_id, shopping.source_recipe_uuids
    )
  ) then raise exception 'shopping source Stage 2C parity failed'; end if;
  if exists (
    select 1 from public.shopping_recipe_contributions as contribution
    join public.recipes as recipe
      on recipe.recipe_uuid = contribution.recipe_uuid
     and recipe.user_id = contribution.user_id
    where contribution.recipe_id <> recipe.id
  ) then raise exception 'shopping contribution Stage 2C parity failed'; end if;

  if to_regprocedure(
    'public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)'
  ) is not null then raise exception 'legacy made-state overload remains'; end if;
  if to_regprocedure(
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)'
  ) is null then raise exception 'canonical made-state command is missing'; end if;
  if has_function_privilege(
    'authenticated',
    'public.apply_recipe_shopping_contribution_command(bigint,jsonb,text[],jsonb,jsonb,text,text)',
    'EXECUTE'
  ) then raise exception 'legacy shopping command remains executable'; end if;
  if not has_function_privilege('authenticated', 'public.delete_recipe(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.delete_recipe(uuid)', 'EXECUTE') then
    raise exception 'UUID recipe deletion grants are invalid';
  end if;
  if has_table_privilege('authenticated', 'public.recipes', 'DELETE') then
    raise exception 'authenticated legacy-addressable recipe deletion remains';
  end if;
end;
$$;

commit;
