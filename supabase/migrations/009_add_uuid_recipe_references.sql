-- Stage 2A of the recipe identity migration.
--
-- Add canonical UUID mirrors for every active recipe reference while the
-- deployed application continues to read and write legacy text aliases.
-- Legacy fields remain authoritative only for this compatibility window;
-- migration 010 will switch application commands to UUID inputs.

begin;

alter table public.weekly_plans
  add column recipe_uuids uuid[] not null default '{}'::uuid[],
  add column day_assignment_recipe_uuids jsonb not null default '{}'::jsonb,
  add column made_recipe_uuids uuid[] not null default '{}'::uuid[];

alter table public.plan_templates
  add column recipe_uuids uuid[] not null default '{}'::uuid[],
  add column day_assignment_recipe_uuids jsonb not null default '{}'::jsonb;

alter table public.recipe_history
  add column recipe_uuid uuid;

alter table public.recipe_shares
  add column source_recipe_uuid uuid,
  add column accepted_recipe_uuid uuid;

alter table public.shopping_list
  add column source_recipe_uuids uuid[] not null default '{}'::uuid[];

alter table public.shopping_recipe_contributions
  add column recipe_uuid uuid;

create function private.resolve_owned_recipe_uuid_array(
  p_user_id uuid,
  p_legacy_ids text[]
)
returns uuid[]
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result uuid[];
  v_unresolved integer;
begin
  select
    coalesce(array_agg(recipe.recipe_uuid order by item.position), '{}'::uuid[]),
    count(*) filter (where recipe.recipe_uuid is null)
  into v_result, v_unresolved
  from unnest(coalesce(p_legacy_ids, '{}'::text[]))
    with ordinality as item(legacy_id, position)
  left join public.recipes as recipe
    on recipe.id = item.legacy_id
   and recipe.user_id = p_user_id;

  if v_unresolved > 0 then
    raise exception 'active recipe reference is unresolved or belongs to another user'
      using errcode = '23503';
  end if;

  if cardinality(v_result) <> (
    select count(distinct recipe_uuid)
    from unnest(v_result) as recipe_uuid
  ) then
    raise exception 'active recipe references contain a duplicate canonical identity'
      using errcode = '23505';
  end if;

  return v_result;
end;
$$;

create function private.resolve_owned_recipe_assignment_keys(
  p_user_id uuid,
  p_legacy_assignments jsonb
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
  v_recipe_uuid uuid;
begin
  if jsonb_typeof(coalesce(p_legacy_assignments, '{}'::jsonb)) <> 'object' then
    raise exception 'recipe assignments must be a JSON object' using errcode = '22023';
  end if;

  for v_assignment in
    select key, value
    from jsonb_each(coalesce(p_legacy_assignments, '{}'::jsonb))
  loop
    select recipe.recipe_uuid
    into v_recipe_uuid
    from public.recipes as recipe
    where recipe.id = v_assignment.key
      and recipe.user_id = p_user_id;

    if v_recipe_uuid is null then
      raise exception 'active recipe assignment is unresolved or belongs to another user'
        using errcode = '23503';
    end if;

    v_result := v_result || jsonb_build_object(v_recipe_uuid::text, v_assignment.value);
  end loop;

  return v_result;
end;
$$;

create function private.enrich_recipe_source_array(
  p_user_id uuid,
  p_sources jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      case
        when nullif(source.value ->> 'recipeId', '') is null then source.value
        when recipe.recipe_uuid is not null then
          (source.value - 'recipeUuid' - 'legacyRecipeId')
          || jsonb_build_object('recipeUuid', recipe.recipe_uuid)
        else
          (source.value - 'recipeUuid')
          || jsonb_build_object('legacyRecipeId', source.value ->> 'recipeId')
      end
      order by source.position
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(p_sources) = 'array' then p_sources else '[]'::jsonb end
  ) with ordinality as source(value, position)
  left join public.recipes as recipe
    on recipe.id = nullif(source.value ->> 'recipeId', '')
   and recipe.user_id = p_user_id;
$$;

create function private.enrich_recipe_source_items(
  p_user_id uuid,
  p_items jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(item.value -> 'sources') = 'array' then
          jsonb_set(
            item.value,
            '{sources}',
            private.enrich_recipe_source_array(p_user_id, item.value -> 'sources'),
            true
          )
        else item.value
      end
      order by item.position
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
  ) with ordinality as item(value, position);
$$;

create function private.enrich_recipe_contribution_snapshot(
  p_user_id uuid,
  p_snapshot jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_snapshot) = 'object'
     and jsonb_typeof(p_snapshot -> 'items') = 'array'
    then jsonb_set(
      p_snapshot,
      '{items}',
      private.enrich_recipe_source_items(p_user_id, p_snapshot -> 'items'),
      true
    )
    else p_snapshot
  end;
$$;

create function private.validate_recipe_source_items(
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
  v_legacy_recipe_id text;
  v_supplied_recipe_uuid uuid;
  v_owned_recipe_uuid uuid;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'shopping recipe source items must be a JSON array'
      using errcode = '22023';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item.value) <> 'object' then
      raise exception 'shopping recipe source item must be a JSON object'
        using errcode = '22023';
    end if;

    if v_item.value ? 'sources'
      and jsonb_typeof(v_item.value -> 'sources') <> 'array'
    then
      raise exception 'shopping recipe sources must be a JSON array'
        using errcode = '22023';
    end if;

    for v_source in
      select value
      from jsonb_array_elements(
        case
          when jsonb_typeof(v_item.value -> 'sources') = 'array'
            then v_item.value -> 'sources'
          else '[]'::jsonb
        end
      )
    loop
      if jsonb_typeof(v_source.value) <> 'object' then
        raise exception 'shopping recipe source must be a JSON object'
          using errcode = '22023';
      end if;

      if nullif(v_source.value ->> 'recipeUuid', '') is null then
        continue;
      end if;

      begin
        v_supplied_recipe_uuid := (v_source.value ->> 'recipeUuid')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'shopping recipe UUID metadata is malformed'
            using errcode = '22023';
      end;

      v_legacy_recipe_id := nullif(v_source.value ->> 'recipeId', '');
      select recipe.recipe_uuid
      into v_owned_recipe_uuid
      from public.recipes as recipe
      where recipe.id = v_legacy_recipe_id
        and recipe.user_id = p_user_id;

      if v_legacy_recipe_id is null
        or v_owned_recipe_uuid is null
        or v_supplied_recipe_uuid <> v_owned_recipe_uuid
      then
        raise exception 'shopping recipe legacy and UUID metadata disagree or cross owners'
          using errcode = '23503';
      end if;
    end loop;
  end loop;
end;
$$;

revoke all privileges on function private.resolve_owned_recipe_uuid_array(uuid, text[])
  from public, anon, authenticated, service_role;
revoke all privileges on function private.resolve_owned_recipe_assignment_keys(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.enrich_recipe_source_array(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.enrich_recipe_source_items(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.enrich_recipe_contribution_snapshot(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function private.validate_recipe_source_items(uuid, jsonb)
  from public, anon, authenticated, service_role;

update public.weekly_plans as plan
set recipe_uuids = private.resolve_owned_recipe_uuid_array(plan.user_id, plan.recipe_ids),
    day_assignment_recipe_uuids = private.resolve_owned_recipe_assignment_keys(
      plan.user_id,
      plan.day_assignments
    ),
    made_recipe_uuids = private.resolve_owned_recipe_uuid_array(
      plan.user_id,
      plan.made_recipe_ids
    );

update public.plan_templates as template
set recipe_uuids = private.resolve_owned_recipe_uuid_array(template.user_id, template.recipe_ids),
    day_assignment_recipe_uuids = private.resolve_owned_recipe_assignment_keys(
      template.user_id,
      template.day_assignments
    );

update public.recipe_history as history
set recipe_uuid = recipe.recipe_uuid
from public.recipes as recipe
where recipe.id = history.recipe_id
  and recipe.user_id = history.user_id;

update public.recipe_shares as share
set source_recipe_uuid = recipe.recipe_uuid
from public.recipes as recipe
where recipe.id = share.source_recipe_id
  and recipe.user_id = share.sender_user_id;

update public.recipe_shares as share
set accepted_recipe_uuid = recipe.recipe_uuid
from public.recipes as recipe
where recipe.id = share.accepted_recipe_id
  and recipe.user_id = share.recipient_user_id;

alter table public.shopping_list disable trigger bump_shopping_contribution_revision_on_update;

update public.shopping_list as shopping
set source_recipe_uuids = private.resolve_owned_recipe_uuid_array(
      shopping.user_id,
      shopping.source_recipes
    ),
    items = private.enrich_recipe_source_items(shopping.user_id, shopping.items),
    already_have = private.enrich_recipe_source_items(shopping.user_id, shopping.already_have),
    excluded = private.enrich_recipe_source_items(shopping.user_id, shopping.excluded);

alter table public.shopping_list enable trigger bump_shopping_contribution_revision_on_update;

update public.shopping_recipe_contributions as contribution
set recipe_uuid = recipe.recipe_uuid,
    snapshot = private.enrich_recipe_contribution_snapshot(
      contribution.user_id,
      contribution.snapshot
    )
from public.recipes as recipe
where recipe.id = contribution.recipe_id
  and recipe.user_id = contribution.user_id;

alter table public.shopping_recipe_contributions
  alter column recipe_uuid set not null,
  add constraint shopping_recipe_contributions_user_recipe_uuid_key
    unique (user_id, recipe_uuid),
  add constraint shopping_recipe_contributions_recipe_uuid_fkey
    foreign key (recipe_uuid) references public.recipes(recipe_uuid) on delete restrict;

create index recipe_history_recipe_uuid_idx
  on public.recipe_history(recipe_uuid);
create index recipe_shares_source_recipe_uuid_idx
  on public.recipe_shares(source_recipe_uuid);
create index recipe_shares_accepted_recipe_uuid_idx
  on public.recipe_shares(accepted_recipe_uuid)
  where accepted_recipe_uuid is not null;

-- SECURITY DEFINER trigger wrappers still preserve the table's outer RLS
-- decision. This helper adds the row-owner check required before the wrapper
-- reads recipes with the migration owner privileges. A null auth.uid() is
-- accepted only for direct migration-owner work and the nested trusted
-- auth.users -> handle_new_user -> shopping_list trigger path.
create function private.assert_uuid_sync_row_owner(p_row_user_id uuid)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_authenticated_user_id uuid := auth.uid();
begin
  if v_authenticated_user_id is not null then
    if v_authenticated_user_id <> p_row_user_id then
      raise exception 'UUID synchronization row owner does not match authenticated user'
        using errcode = '42501';
    end if;
    return;
  end if;

  if session_user = 'postgres' or pg_catalog.pg_trigger_depth() > 1 then
    return;
  end if;

  raise exception 'UUID synchronization requires an authenticated row owner'
    using errcode = '42501';
end;
$$;

alter function private.assert_uuid_sync_row_owner(uuid) owner to postgres;
revoke all privileges on function private.assert_uuid_sync_row_owner(uuid)
  from public, anon, authenticated, service_role;

create function private.sync_weekly_plan_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe_uuids uuid[];
  v_assignment_recipe_uuids jsonb;
  v_made_recipe_uuids uuid[];
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  v_recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
  v_assignment_recipe_uuids := private.resolve_owned_recipe_assignment_keys(
    new.user_id,
    new.day_assignments
  );
  v_made_recipe_uuids := private.resolve_owned_recipe_uuid_array(
    new.user_id,
    new.made_recipe_ids
  );

  if (tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0 and new.recipe_uuids <> v_recipe_uuids)
    or (tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids
      and new.recipe_uuids <> v_recipe_uuids)
    or (tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb
      and new.day_assignment_recipe_uuids <> v_assignment_recipe_uuids)
    or (tg_op = 'UPDATE'
      and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids
      and new.day_assignment_recipe_uuids <> v_assignment_recipe_uuids)
    or (tg_op = 'INSERT' and cardinality(new.made_recipe_uuids) > 0
      and new.made_recipe_uuids <> v_made_recipe_uuids)
    or (tg_op = 'UPDATE' and new.made_recipe_uuids is distinct from old.made_recipe_uuids
      and new.made_recipe_uuids <> v_made_recipe_uuids)
  then
    raise exception 'weekly plan legacy and UUID recipe identities disagree'
      using errcode = '23503';
  end if;

  new.recipe_uuids := v_recipe_uuids;
  new.day_assignment_recipe_uuids := v_assignment_recipe_uuids;
  new.made_recipe_uuids := v_made_recipe_uuids;
  return new;
end;
$$;

create function private.sync_plan_template_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe_uuids uuid[];
  v_assignment_recipe_uuids jsonb;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  v_recipe_uuids := private.resolve_owned_recipe_uuid_array(new.user_id, new.recipe_ids);
  v_assignment_recipe_uuids := private.resolve_owned_recipe_assignment_keys(
    new.user_id,
    new.day_assignments
  );

  if (tg_op = 'INSERT' and cardinality(new.recipe_uuids) > 0 and new.recipe_uuids <> v_recipe_uuids)
    or (tg_op = 'UPDATE' and new.recipe_uuids is distinct from old.recipe_uuids
      and new.recipe_uuids <> v_recipe_uuids)
    or (tg_op = 'INSERT' and new.day_assignment_recipe_uuids <> '{}'::jsonb
      and new.day_assignment_recipe_uuids <> v_assignment_recipe_uuids)
    or (tg_op = 'UPDATE'
      and new.day_assignment_recipe_uuids is distinct from old.day_assignment_recipe_uuids
      and new.day_assignment_recipe_uuids <> v_assignment_recipe_uuids)
  then
    raise exception 'plan template legacy and UUID recipe identities disagree'
      using errcode = '23503';
  end if;

  new.recipe_uuids := v_recipe_uuids;
  new.day_assignment_recipe_uuids := v_assignment_recipe_uuids;
  return new;
end;
$$;

create function private.sync_recipe_history_uuid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe_uuid uuid;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  select recipe.recipe_uuid
  into v_recipe_uuid
  from public.recipes as recipe
  where recipe.id = new.recipe_id
    and recipe.user_id = new.user_id;

  if new.recipe_uuid is not null
    and (
      (tg_op = 'INSERT' and new.recipe_uuid is distinct from v_recipe_uuid)
      or (tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid
        and new.recipe_uuid is distinct from v_recipe_uuid)
    )
  then
    raise exception 'recipe history legacy and UUID identities disagree'
      using errcode = '23503';
  end if;

  new.recipe_uuid := v_recipe_uuid;
  return new;
end;
$$;

create function private.sync_recipe_share_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_authenticated_user_id uuid := auth.uid();
  v_source_recipe_uuid uuid;
  v_accepted_recipe_uuid uuid;
begin
  if v_authenticated_user_id is not null
    and v_authenticated_user_id <> new.sender_user_id
    and v_authenticated_user_id <> new.recipient_user_id
  then
    raise exception 'recipe share owner does not match authenticated user'
      using errcode = '42501';
  elsif v_authenticated_user_id is null and session_user <> 'postgres' then
    raise exception 'recipe share synchronization requires an authenticated participant'
      using errcode = '42501';
  end if;

  select recipe.recipe_uuid
  into v_source_recipe_uuid
  from public.recipes as recipe
  where recipe.id = new.source_recipe_id
    and recipe.user_id = new.sender_user_id;

  select recipe.recipe_uuid
  into v_accepted_recipe_uuid
  from public.recipes as recipe
  where recipe.id = new.accepted_recipe_id
    and recipe.user_id = new.recipient_user_id;

  if new.status = 'pending' and v_source_recipe_uuid is null then
    raise exception 'pending share source recipe is unresolved or belongs to another user'
      using errcode = '23503';
  end if;

  if v_authenticated_user_id is not null
    and new.status = 'accepted'
    and new.accepted_recipe_id is not null
    and v_accepted_recipe_uuid is null
  then
    raise exception 'accepted share copy is unresolved or belongs to another user'
      using errcode = '23503';
  end if;

  if new.source_recipe_uuid is not null
    and (
      (tg_op = 'INSERT' and new.source_recipe_uuid is distinct from v_source_recipe_uuid)
      or (tg_op = 'UPDATE' and new.source_recipe_uuid is distinct from old.source_recipe_uuid
        and new.source_recipe_uuid is distinct from v_source_recipe_uuid)
    )
  then
    raise exception 'share source legacy and UUID identities disagree'
      using errcode = '23503';
  end if;

  if new.accepted_recipe_uuid is not null
    and (
      (tg_op = 'INSERT' and new.accepted_recipe_uuid is distinct from v_accepted_recipe_uuid)
      or (tg_op = 'UPDATE' and new.accepted_recipe_uuid is distinct from old.accepted_recipe_uuid
        and new.accepted_recipe_uuid is distinct from v_accepted_recipe_uuid)
    )
  then
    raise exception 'share accepted-copy legacy and UUID identities disagree'
      using errcode = '23503';
  end if;

  new.source_recipe_uuid := v_source_recipe_uuid;
  new.accepted_recipe_uuid := v_accepted_recipe_uuid;

  return new;
end;
$$;

create function private.sync_shopping_list_recipe_uuids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_recipe_uuids uuid[];
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  v_source_recipe_uuids := private.resolve_owned_recipe_uuid_array(
    new.user_id,
    new.source_recipes
  );

  if (tg_op = 'INSERT' and cardinality(new.source_recipe_uuids) > 0
      and new.source_recipe_uuids <> v_source_recipe_uuids)
    or (tg_op = 'UPDATE' and new.source_recipe_uuids is distinct from old.source_recipe_uuids
      and new.source_recipe_uuids <> v_source_recipe_uuids)
  then
    raise exception 'shopping source legacy and UUID identities disagree'
      using errcode = '23503';
  end if;

  new.source_recipe_uuids := v_source_recipe_uuids;
  perform private.validate_recipe_source_items(new.user_id, new.items);
  perform private.validate_recipe_source_items(new.user_id, new.already_have);
  perform private.validate_recipe_source_items(new.user_id, new.excluded);
  new.items := private.enrich_recipe_source_items(new.user_id, new.items);
  new.already_have := private.enrich_recipe_source_items(new.user_id, new.already_have);
  new.excluded := private.enrich_recipe_source_items(new.user_id, new.excluded);
  return new;
end;
$$;

create function private.sync_shopping_contribution_recipe_uuid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipe_uuid uuid;
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);

  select recipe.recipe_uuid
  into v_recipe_uuid
  from public.recipes as recipe
  where recipe.id = new.recipe_id
    and recipe.user_id = new.user_id;

  if v_recipe_uuid is null then
    raise exception 'shopping contribution recipe is unresolved or belongs to another user'
      using errcode = '23503';
  end if;

  if new.recipe_uuid is not null
    and (
      (tg_op = 'INSERT' and new.recipe_uuid <> v_recipe_uuid)
      or (tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid
        and new.recipe_uuid <> v_recipe_uuid)
    )
  then
    raise exception 'shopping contribution recipe identities disagree'
      using errcode = '23503';
  end if;

  new.recipe_uuid := v_recipe_uuid;
  if jsonb_typeof(new.snapshot) = 'object'
    and jsonb_typeof(new.snapshot -> 'items') = 'array'
  then
    perform private.validate_recipe_source_items(new.user_id, new.snapshot -> 'items');
  end if;
  new.snapshot := private.enrich_recipe_contribution_snapshot(new.user_id, new.snapshot);
  return new;
end;
$$;

alter function private.sync_weekly_plan_recipe_uuids() owner to postgres;
alter function private.sync_plan_template_recipe_uuids() owner to postgres;
alter function private.sync_recipe_history_uuid() owner to postgres;
alter function private.sync_recipe_share_uuids() owner to postgres;
alter function private.sync_shopping_list_recipe_uuids() owner to postgres;
alter function private.sync_shopping_contribution_recipe_uuid() owner to postgres;

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

create trigger sync_weekly_plan_recipe_uuids
before insert or update of user_id, recipe_ids, day_assignments, made_recipe_ids,
  recipe_uuids, day_assignment_recipe_uuids, made_recipe_uuids
on public.weekly_plans
for each row execute function private.sync_weekly_plan_recipe_uuids();

create trigger sync_plan_template_recipe_uuids
before insert or update of user_id, recipe_ids, day_assignments,
  recipe_uuids, day_assignment_recipe_uuids
on public.plan_templates
for each row execute function private.sync_plan_template_recipe_uuids();

create trigger sync_recipe_history_uuid
before insert or update of user_id, recipe_id, recipe_uuid
on public.recipe_history
for each row execute function private.sync_recipe_history_uuid();

create trigger sync_recipe_share_uuids
before insert or update of sender_user_id, recipient_user_id, source_recipe_id,
  accepted_recipe_id, status, source_recipe_uuid, accepted_recipe_uuid
on public.recipe_shares
for each row execute function private.sync_recipe_share_uuids();

create trigger sync_shopping_list_recipe_uuids
before insert or update of user_id, items, already_have, excluded, source_recipes,
  source_recipe_uuids
on public.shopping_list
for each row execute function private.sync_shopping_list_recipe_uuids();

create trigger sync_shopping_contribution_recipe_uuid
before insert or update of user_id, recipe_id, recipe_uuid, snapshot
on public.shopping_recipe_contributions
for each row execute function private.sync_shopping_contribution_recipe_uuid();

comment on column public.weekly_plans.recipe_uuids is
  'Stage 2 canonical UUID mirror of ordered active recipe_ids; database-maintained during legacy compatibility.';
comment on column public.weekly_plans.day_assignment_recipe_uuids is
  'Stage 2 canonical UUID-keyed mirror of day_assignments.';
comment on column public.weekly_plans.made_recipe_uuids is
  'Stage 2 canonical UUID mirror of made_recipe_ids.';
comment on column public.plan_templates.recipe_uuids is
  'Stage 2 canonical UUID mirror of ordered template recipe_ids.';
comment on column public.plan_templates.day_assignment_recipe_uuids is
  'Stage 2 canonical UUID-keyed mirror of template day_assignments.';
comment on column public.recipe_history.recipe_uuid is
  'Nullable canonical recipe linkage; legacy recipe_id remains immutable historical evidence.';
comment on column public.recipe_shares.source_recipe_uuid is
  'Nullable sender-owned canonical source linkage; the share snapshot and legacy alias survive deletion.';
comment on column public.recipe_shares.accepted_recipe_uuid is
  'Nullable recipient-owned canonical accepted-copy linkage; never reuses the sender UUID.';
comment on column public.shopping_list.source_recipe_uuids is
  'Stage 2 canonical UUID mirror of operational source_recipes.';
comment on column public.shopping_recipe_contributions.recipe_uuid is
  'Canonical contribution identity; legacy recipe_id remains the Stage 2A compatibility key.';

do $$
begin
  if exists (
    select 1
    from public.weekly_plans as plan
    where plan.recipe_uuids <> private.resolve_owned_recipe_uuid_array(plan.user_id, plan.recipe_ids)
       or plan.day_assignment_recipe_uuids <> private.resolve_owned_recipe_assignment_keys(
         plan.user_id,
         plan.day_assignments
       )
       or plan.made_recipe_uuids <> private.resolve_owned_recipe_uuid_array(
         plan.user_id,
         plan.made_recipe_ids
       )
  ) then
    raise exception 'weekly plan UUID backfill parity failed';
  end if;

  if exists (
    select 1
    from public.plan_templates as template
    where template.recipe_uuids <> private.resolve_owned_recipe_uuid_array(
          template.user_id,
          template.recipe_ids
        )
       or template.day_assignment_recipe_uuids <> private.resolve_owned_recipe_assignment_keys(
          template.user_id,
          template.day_assignments
        )
  ) then
    raise exception 'plan template UUID backfill parity failed';
  end if;

  if exists (
    select 1
    from public.recipe_history as history
    join public.recipes as recipe
      on recipe.id = history.recipe_id
     and recipe.user_id = history.user_id
    where history.recipe_uuid is distinct from recipe.recipe_uuid
  ) or exists (
    select 1
    from public.recipe_history as history
    where history.recipe_uuid is not null
      and not exists (
        select 1
        from public.recipes as recipe
        where recipe.recipe_uuid = history.recipe_uuid
          and recipe.user_id = history.user_id
      )
  ) then
    raise exception 'recipe history UUID backfill parity failed';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    left join public.recipes as source
      on source.id = share.source_recipe_id
     and source.user_id = share.sender_user_id
    left join public.recipes as accepted
      on accepted.id = share.accepted_recipe_id
     and accepted.user_id = share.recipient_user_id
    where share.source_recipe_uuid is distinct from source.recipe_uuid
       or share.accepted_recipe_uuid is distinct from accepted.recipe_uuid
       or (share.status = 'pending' and source.recipe_uuid is null)
  ) then
    raise exception 'recipe share UUID backfill parity failed';
  end if;

  if exists (
    select 1
    from public.shopping_list as shopping
    where shopping.source_recipe_uuids <> private.resolve_owned_recipe_uuid_array(
      shopping.user_id,
      shopping.source_recipes
    )
  ) then
    raise exception 'shopping source UUID backfill parity failed';
  end if;

  if exists (
    select 1
    from public.shopping_recipe_contributions as contribution
    join public.recipes as recipe
      on recipe.id = contribution.recipe_id
     and recipe.user_id = contribution.user_id
    where contribution.recipe_uuid <> recipe.recipe_uuid
  ) or (
    select count(*) from public.shopping_recipe_contributions
  ) <> (
    select count(distinct (user_id, recipe_uuid))
    from public.shopping_recipe_contributions
  ) then
    raise exception 'shopping contribution UUID backfill parity failed';
  end if;
end;
$$;

commit;
