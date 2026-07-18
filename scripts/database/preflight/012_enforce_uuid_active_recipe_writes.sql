\set ON_ERROR_STOP on

-- Read-only, count-only preflight for migration 012. This emits no customer data.
begin transaction read only;

do $migration_012_preflight$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '001','002','003','004','005','006','007','008','009','010','011'
  ];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;

  select array_agg(version order by version)
    into actual_versions
  from supabase_migrations.schema_migrations;
  if actual_versions is distinct from expected_versions then
    raise exception 'remote migration ledger must be exactly 001 through 011';
  end if;

  if to_regprocedure(
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)'
  ) is null then
    raise exception 'migration 011 canonical made-state function is missing';
  end if;
  if to_regprocedure('public.resolve_recipe_identity(uuid,text)') is null
     or to_regprocedure(
       'public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)'
     ) is null
     or to_regprocedure('private.resolve_owned_recipe_uuid_array(uuid,text[])') is null
     or to_regprocedure('private.resolve_owned_recipe_assignment_keys(uuid,jsonb)') is null then
    raise exception 'expected pre-012 compatibility function is missing';
  end if;
  if exists (
    select required.trigger_name
    from (values
      ('prevent_recipe_uuid_update', 'recipes'),
      ('prevent_recipe_identity_change', 'recipes'),
      ('sync_weekly_plan_recipe_uuids', 'weekly_plans'),
      ('sync_plan_template_recipe_uuids', 'plan_templates'),
      ('sync_recipe_history_uuid', 'recipe_history'),
      ('sync_recipe_share_uuids', 'recipe_shares'),
      ('sync_shopping_list_recipe_uuids', 'shopping_list'),
      ('sync_shopping_contribution_recipe_uuid', 'shopping_recipe_contributions')
    ) as required(trigger_name, table_name)
    where not exists (
      select 1
      from pg_trigger as trigger
      join pg_class as relation on relation.oid = trigger.tgrelid
      join pg_namespace as namespace on namespace.oid = relation.relnamespace
      where trigger.tgname = required.trigger_name
        and relation.relname = required.table_name
        and namespace.nspname = 'public'
        and not trigger.tgisinternal
    )
  ) then raise exception 'expected pre-012 trigger is missing'; end if;
  if exists (
    select required.name
    from unnest(array[
      'recipes_recipe_uuid_key',
      'recipe_history_recipe_uuid_idx',
      'recipe_shares_source_recipe_uuid_idx',
      'recipe_shares_accepted_recipe_uuid_idx'
    ]) as required(name)
    where to_regclass('public.' || required.name) is null
  ) then raise exception 'expected pre-012 identity index is missing'; end if;
  if exists (
    select required.name
    from unnest(array[
      'recipes','weekly_plans','plan_templates','recipe_history',
      'recipe_shares','shopping_list','shopping_recipe_contributions'
    ]) as required(name)
    left join pg_class as relation
      on relation.oid = to_regclass('public.' || required.name)
    left join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where relation.oid is null or namespace.nspname <> 'public' or not relation.relrowsecurity
  ) then raise exception 'expected application RLS state is missing'; end if;

  if exists (
    select 1 from public.recipes
    where recipe_uuid is null or nullif(id, '') is null
  ) or exists (
    select recipe_uuid from public.recipes
    group by recipe_uuid having count(*) <> 1
  ) then raise exception 'active recipe UUID/text identity parity failed'; end if;

  if exists (
    select 1 from public.weekly_plans as plan
    cross join lateral unnest(plan.recipe_ids) as legacy_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = legacy_id
    )
  ) then raise exception 'unresolved weekly recipe membership remains'; end if;

  if exists (
    select 1 from public.weekly_plans as plan
    cross join lateral jsonb_object_keys(coalesce(plan.day_assignments, '{}'::jsonb)) as legacy_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = legacy_id
    )
  ) then raise exception 'unresolved weekly assignment key remains'; end if;

  if exists (
    select 1 from public.weekly_plans as plan
    cross join lateral unnest(coalesce(plan.made_recipe_ids, '{}'::text[])) as legacy_id
    where not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = plan.user_id and recipe.id = legacy_id
    )
  ) then raise exception 'unresolved weekly made-recipe reference remains'; end if;

  if exists (
    select 1 from public.weekly_plans as plan
    where plan.recipe_uuids <> private.resolve_owned_recipe_uuid_array(plan.user_id, plan.recipe_ids)
       or plan.day_assignment_recipe_uuids <>
          private.resolve_owned_recipe_assignment_keys(plan.user_id, plan.day_assignments)
       or plan.made_recipe_uuids <>
          private.resolve_owned_recipe_uuid_array(plan.user_id, plan.made_recipe_ids)
  ) then raise exception 'weekly planner legacy/canonical mirrors are not aligned'; end if;

  if exists (
    select 1 from public.plan_templates as template
    where template.recipe_uuids <>
          private.resolve_owned_recipe_uuid_array(template.user_id, template.recipe_ids)
       or template.day_assignment_recipe_uuids <>
          private.resolve_owned_recipe_assignment_keys(template.user_id, template.day_assignments)
  ) then raise exception 'template legacy/canonical mirrors are not aligned'; end if;

  if exists (
    select 1 from public.recipe_history as history
    join public.recipes as recipe
      on recipe.id = history.recipe_id and recipe.user_id = history.user_id
    where history.recipe_uuid is distinct from recipe.recipe_uuid
  ) then raise exception 'recipe history resolvable identity mismatch remains'; end if;
  if exists (
    select 1 from public.recipe_shares as share
    join public.recipes as recipe
      on recipe.id = share.source_recipe_id and recipe.user_id = share.sender_user_id
    where share.source_recipe_uuid is distinct from recipe.recipe_uuid
  ) or exists (
    select 1 from public.recipe_shares as share
    join public.recipes as recipe
      on recipe.id = share.accepted_recipe_id and recipe.user_id = share.recipient_user_id
    where share.accepted_recipe_uuid is distinct from recipe.recipe_uuid
  ) or exists (
    select 1 from public.recipe_shares
    where status = 'pending' and source_recipe_uuid is null
  ) then raise exception 'recipe share identity mismatch remains'; end if;
  if exists (
    select 1 from public.shopping_list as shopping
    where shopping.source_recipe_uuids <>
      private.resolve_owned_recipe_uuid_array(shopping.user_id, shopping.source_recipes)
  ) then raise exception 'shopping source identity mismatch remains'; end if;
  if exists (
    select 1 from public.shopping_recipe_contributions as contribution
    join public.recipes as recipe
      on recipe.id = contribution.recipe_id and recipe.user_id = contribution.user_id
    where contribution.recipe_uuid is distinct from recipe.recipe_uuid
  ) then raise exception 'shopping contribution identity mismatch remains'; end if;

  if exists (
    select 1
    from public.shopping_list as shopping
    cross join lateral (values
      (shopping.items), (shopping.already_have), (shopping.excluded)
    ) as field(value)
    where jsonb_typeof(coalesce(field.value, '[]'::jsonb)) <> 'array'
  ) or exists (
    select 1
    from public.shopping_list as shopping
    cross join lateral (values
      (shopping.items), (shopping.already_have), (shopping.excluded)
    ) as field(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(field.value) = 'array' then field.value else '[]'::jsonb end
    ) as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or (item.value ? 'sources' and jsonb_typeof(item.value -> 'sources') <> 'array')
  ) or exists (
    select 1
    from public.shopping_list as shopping
    cross join lateral (values
      (shopping.items), (shopping.already_have), (shopping.excluded)
    ) as field(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(field.value) = 'array' then field.value else '[]'::jsonb end
    ) as item(value)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(item.value -> 'sources') = 'array'
        then item.value -> 'sources' else '[]'::jsonb end
    ) as source(value)
    where jsonb_typeof(source.value) <> 'object'
  ) then raise exception 'shopping recipe source JSON structure is incompatible with migration 012'; end if;

  if exists (
    select 1
    from public.shopping_list as shopping
    cross join lateral (values
      (shopping.items), (shopping.already_have), (shopping.excluded)
    ) as field(value)
    cross join lateral jsonb_array_elements(coalesce(field.value, '[]'::jsonb)) as item(value)
    cross join lateral jsonb_array_elements(coalesce(item.value -> 'sources', '[]'::jsonb)) as source(value)
    left join public.recipes as recipe
      on recipe.user_id = shopping.user_id
     and recipe.recipe_uuid = case
       when source.value ->> 'recipeUuid' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (source.value ->> 'recipeUuid')::uuid
       else null
     end
    where nullif(source.value ->> 'recipeUuid', '') is not null
      and (
        source.value ->> 'recipeUuid' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or recipe.recipe_uuid is null
        or (coalesce(nullif(source.value ->> 'recipeId', ''), nullif(source.value ->> 'legacyRecipeId', '')) is not null
          and recipe.id is distinct from coalesce(nullif(source.value ->> 'recipeId', ''), nullif(source.value ->> 'legacyRecipeId', '')))
      )
  ) or exists (
    select 1
    from public.shopping_list as shopping
    cross join lateral (values
      (shopping.items), (shopping.already_have), (shopping.excluded)
    ) as field(value)
    cross join lateral jsonb_array_elements(coalesce(field.value, '[]'::jsonb)) as item(value)
    cross join lateral jsonb_array_elements(coalesce(item.value -> 'sources', '[]'::jsonb)) as source(value)
    join public.recipes as recipe
      on recipe.user_id = shopping.user_id
     and recipe.id = coalesce(nullif(source.value ->> 'recipeId', ''), nullif(source.value ->> 'legacyRecipeId', ''))
    where nullif(source.value ->> 'recipeUuid', '') is null
  ) then raise exception 'shopping recipe source UUID metadata is unresolved, malformed, or cross-owner'; end if;

  if exists (
    select 1
    from public.weekly_plans as plan
    cross join lateral unnest(plan.recipe_ids) with ordinality as legacy(value, position)
    join lateral unnest(plan.recipe_uuids) with ordinality as canonical(value, position)
      on canonical.position = legacy.position
    join public.recipes as recipe
      on recipe.id = legacy.value and recipe.recipe_uuid = canonical.value
    where recipe.user_id <> plan.user_id
  ) then raise exception 'cross-owner weekly reference remains'; end if;

  if exists (
    select 1 from public.weekly_plans as plan
    where cardinality(plan.recipe_ids) <> cardinality(plan.recipe_uuids)
       or cardinality(plan.made_recipe_ids) <> cardinality(plan.made_recipe_uuids)
  ) then raise exception 'planner array mirror cardinality differs'; end if;
end
$migration_012_preflight$;

-- Reviewed operators also run the repository Stage 2A count-only audit and require
-- every counter to be zero. Duplicate memberships are valid only when both ordered
-- mirrors retain identical duplicate multiplicity; the equality checks above enforce it.
\ir ../../../supabase/verification/stage2a_uuid_reference_audit.sql
\ir ../../../supabase/verification/active_planner_reference_audit.sql

rollback;
