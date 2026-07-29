\set ON_ERROR_STOP on

-- Read-only, count-only preflight for migration 014. This emits no customer data.
begin transaction read only;

do $migration_014_preflight$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '001','002','003','004','005','006','007','008','009','010','011','012','013'
  ];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;

  select array_agg(version order by version)
    into actual_versions
  from supabase_migrations.schema_migrations;
  if actual_versions is distinct from expected_versions then
    raise exception 'remote migration ledger must be exactly 001 through 013 and migration 014 must be absent';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and column_name = 'yield_metadata'
  ) then
    raise exception 'recipes.yield_metadata already exists';
  end if;

  if to_regprocedure('public.accept_recipe_share(uuid)') is null then
    raise exception 'expected recipe-share acceptance function is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'accept_recipe_share'
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ) then
    raise exception 'recipe-share acceptance function security contract is incompatible with migration 014';
  end if;

  if exists (
    select 1
    from public.recipe_shares
    where status = 'pending'
      and (
        jsonb_typeof(source_recipe_snapshot) <> 'object'
        or not (source_recipe_snapshot ? 'name')
        or not (source_recipe_snapshot ? 'category')
        or not (source_recipe_snapshot ? 'servings')
        or jsonb_typeof(source_recipe_snapshot->'tags') <> 'array'
        or jsonb_typeof(source_recipe_snapshot->'ingredients') <> 'array'
        or jsonb_typeof(source_recipe_snapshot->'instructions') <> 'array'
      )
  ) then
    raise exception 'pending recipe-share snapshots are incompatible with migration 014 validation';
  end if;
end
$migration_014_preflight$;

rollback;
