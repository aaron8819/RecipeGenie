\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\if :{?expected_recipe_count}
\else
  \echo 'expected_recipe_count is required'
  \quit 2
\endif

\if :{?expected_share_count}
\else
  \echo 'expected_share_count is required'
  \quit 2
\endif

begin transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select
  set_config('recipe_genie.expected_recipe_count', :'expected_recipe_count', true)
    as recipe_count_setting,
  set_config('recipe_genie.expected_share_count', :'expected_share_count', true)
    as share_count_setting
\gset

do $$
declare
  v_ledger text;
  v_recipe_count bigint;
  v_share_count bigint;
  v_expected_recipe_count bigint;
  v_expected_share_count bigint;
  v_invalid_share_count bigint;
begin
  select string_agg(version, ',' order by version)
    into v_ledger
    from supabase_migrations.schema_migrations;

  if v_ledger is distinct from '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015' then
    raise exception 'restored migration ledger is not the exact pre-016 baseline';
  end if;

  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null
     or to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'restored recovery tables are incomplete';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'recipes'
       and column_name in ('ingredient_sections', 'instruction_sections')
  ) then
    raise exception 'restored recipes table contains post-016 canonical columns';
  end if;

  if (
    select count(*)
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'recipes'
       and (
         (column_name = 'ingredients' and data_type = 'jsonb')
         or (column_name = 'instructions' and data_type = 'ARRAY' and udt_name = '_text')
         or (column_name = 'instruction_groups' and data_type = 'jsonb')
         or (column_name = 'notes' and data_type = 'jsonb')
       )
  ) <> 4 then
    raise exception 'restored recipes table lacks the required pre-016 legacy structure columns';
  end if;

  if to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null
     or to_regprocedure('public.accept_recipe_share(uuid)') is null
     or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'restored pre-016 validators or RPCs are incomplete';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_record
      join pg_catalog.pg_class relation_record
        on relation_record.oid = trigger_record.tgrelid
      join pg_catalog.pg_namespace relation_namespace
        on relation_namespace.oid = relation_record.relnamespace
      join pg_catalog.pg_proc function_record
        on function_record.oid = trigger_record.tgfoid
      join pg_catalog.pg_namespace function_namespace
        on function_namespace.oid = function_record.pronamespace
     where not trigger_record.tgisinternal
       and trigger_record.tgname = 'on_auth_user_created'
       and relation_namespace.nspname = 'auth'
       and relation_record.relname = 'users'
       and function_namespace.nspname = 'public'
       and function_record.proname = 'handle_new_user'
       and function_record.pronargs = 0
  ) then
    raise exception 'restored auth user trigger is not bound to public.handle_new_user()';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is not null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is not null
     or exists (
       select 1
         from pg_catalog.pg_constraint
        where conrelid = 'public.recipes'::regclass
          and conname in ('recipes_ingredient_sections_valid', 'recipes_instruction_sections_valid')
     ) then
    raise exception 'restored schema retains post-016 validators or constraints';
  end if;

  v_expected_recipe_count := current_setting(
    'recipe_genie.expected_recipe_count'
  )::bigint;
  v_expected_share_count := current_setting(
    'recipe_genie.expected_share_count'
  )::bigint;

  select count(*) into v_recipe_count from public.recipes;
  select count(*) into v_share_count from public.recipe_shares;
  select count(*)
    into v_invalid_share_count
    from public.recipe_shares
   where source_recipe_snapshot is null
      or jsonb_typeof(source_recipe_snapshot) <> 'object'
      or not private.recipe_share_snapshot_is_valid(source_recipe_snapshot);

  if v_recipe_count <> v_expected_recipe_count
     or v_share_count <> v_expected_share_count
     or v_invalid_share_count <> 0 then
    raise exception 'restored aggregate recovery state does not match the backup evidence';
  end if;
end
$$;

select json_build_object(
  'ledgerBaselineExact', true,
  'legacyColumnsPresent', true,
  'canonicalColumnsAbsent', true,
  'requiredFunctionsPresent', true,
  'authTriggerPresent', true,
  'recipeCountMatched', true,
  'shareCountMatched', true,
  'shareSnapshotsValid', true
)::text;

rollback;
