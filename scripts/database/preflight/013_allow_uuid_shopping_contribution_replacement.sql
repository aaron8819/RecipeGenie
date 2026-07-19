\set ON_ERROR_STOP on

-- Read-only, count-only preflight for migration 013. This emits no customer data.
begin transaction read only;

do $migration_013_preflight$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '001','002','003','004','005','006','007','008','009','010','011','012'
  ];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;

  select array_agg(version order by version)
    into actual_versions
  from supabase_migrations.schema_migrations;
  if actual_versions is distinct from expected_versions then
    raise exception 'remote migration ledger must be exactly 001 through 012 and migration 013 must be absent';
  end if;

  if to_regprocedure('private.sync_shopping_contribution_recipe_uuid()') is null
     or to_regprocedure(
       'public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)'
     ) is null then
    raise exception 'expected migration-012 shopping contribution functions are missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where trigger.tgname = 'sync_shopping_contribution_recipe_uuid'
      and namespace.nspname = 'public'
      and relation.relname = 'shopping_recipe_contributions'
      and not trigger.tgisinternal
      and trigger.tgenabled <> 'D'
  ) then
    raise exception 'expected migration-012 shopping contribution trigger is missing or disabled';
  end if;

  if exists (
    select 1
    from public.shopping_recipe_contributions as contribution
    left join public.recipes as recipe
      on recipe.user_id = contribution.user_id
     and recipe.id = contribution.recipe_id
     and recipe.recipe_uuid = contribution.recipe_uuid
    where nullif(contribution.recipe_id, '') is null
       or contribution.recipe_uuid is null
       or recipe.recipe_uuid is null
  ) then
    raise exception 'shopping contribution recipe identity is unresolved, mismatched, or cross-owner';
  end if;
end
$migration_013_preflight$;

rollback;
