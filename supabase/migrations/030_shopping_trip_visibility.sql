begin;

-- Optional trip-scoped purchase choices. No existing document is rewritten.
alter function public.is_shopping_document_v4(jsonb) rename to shopping_document_v4_before_visibility;
alter function public.shopping_document_v4_before_visibility(jsonb) set schema private;
create function public.is_shopping_document_v4(p_document jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare choice record;
begin
  if not private.shopping_document_v4_before_visibility(p_document - 'tripVisibility') then return false; end if;
  if not (p_document ? 'tripVisibility') then return true; end if;
  if jsonb_typeof(p_document->'tripVisibility') is distinct from 'object' then return false; end if;
  for choice in select key, value from jsonb_each(p_document->'tripVisibility') loop
    if length(trim(choice.key)) = 0 or jsonb_typeof(choice.value) is distinct from 'string' or
      choice.value #>> '{}' not in ('items','already_have','excluded') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shopping_document_v4_before_visibility(jsonb) from public, anon, authenticated, service_role;
alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;

create or replace function private.shopping_content(p_document jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('recipeEntries', p_document->'recipeEntries',
    'manualItems', p_document->'manualItems', 'itemOverrides', p_document->'itemOverrides') ||
    case when p_document ? 'acknowledgements' then jsonb_build_object('acknowledgements', p_document->'acknowledgements') else '{}'::jsonb end ||
    case when p_document ? 'tripVisibility' then jsonb_build_object('tripVisibility', p_document->'tripVisibility') else '{}'::jsonb end;
$$;
create or replace function public.shopping_clear_undo_available(p_row public.shopping_list)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(not exists (select 1 from jsonb_object_keys(($1).document->'recipeEntries') k
    where not exists (select 1 from public.recipes r where r.user_id = ($1).user_id and r.recipe_uuid::text = k)) and
    octet_length(($1).document::text) <= 4194304 and
    octet_length((jsonb_build_object('recipeEntries', ($1).document->'recipeEntries',
      'manualItems', ($1).document->'manualItems', 'itemOverrides', ($1).document->'itemOverrides') ||
      case when ($1).document ? 'acknowledgements' then jsonb_build_object('acknowledgements', ($1).document->'acknowledgements') else '{}'::jsonb end ||
      case when ($1).document ? 'tripVisibility' then jsonb_build_object('tripVisibility', ($1).document->'tripVisibility') else '{}'::jsonb end)::text) <= 1048576, false);
$$;

-- Same bounded evidence rule as recoverTripVisibility. Called before deletion
-- removes the source-to-purchase mapping. Conflicting/missing choices are not guessed.
create function private.shopping_recover_trip_visibility(p_document jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  with choices as (
    select i->>'purchaseKey' as key,
      case when o->'suppressed' = 'true' then 'excluded' else o->>'bucket' end as bucket
    from jsonb_each(p_document->'recipeEntries') e
    cross join lateral jsonb_array_elements(e.value->'ingredients') i
    cross join lateral (select p_document->'itemOverrides'->(i->>'aggregateKey') as o) overrides
    where o->'suppressed' = 'true' or o ? 'bucket'
    union all
    select m->'identity'->>'purchaseKey', m->>'bucket'
    from jsonb_array_elements(p_document->'manualItems') m
    where m->'identity'->>'meaning' <> 'legacyIndependent' and m->>'bucket' <> 'items'
  ), proven as (
    select key, min(bucket) as bucket from choices where key is not null
    group by key having count(distinct bucket) = 1
  ), recovered as (
    select coalesce(jsonb_object_agg(key,bucket),'{}') || coalesce(p_document->'tripVisibility','{}') as value from proven
  )
  select case when p_document->>'schemaVersion' = '4' and recovered.value <> '{}'
    then jsonb_set(p_document,'{tripVisibility}',recovered.value) else p_document end from recovered;
$$;
revoke all on function private.shopping_recover_trip_visibility(jsonb) from public, anon, authenticated, service_role;

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
commit;
