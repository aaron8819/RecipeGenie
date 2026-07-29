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

  if exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'ingredients') = 'array'
          then share.source_recipe_snapshot->'ingredients'
        else '[]'::jsonb
      end
    ) as ingredient
    where share.status = 'pending'
      and (
        (
          ingredient ? 'quantityV1'
          and (
            jsonb_typeof(ingredient->'quantityV1') <> 'object'
            or jsonb_typeof(ingredient->'quantityV1'->'version') <> 'number'
            or ingredient->'quantityV1'->>'version' <> '1'
            or jsonb_typeof(ingredient->'quantityV1'->'kind') <> 'string'
            or ingredient->'quantityV1'->>'kind'
              not in ('exact','range','qualitative','unparsed')
            or jsonb_typeof(ingredient->'quantityV1'->'authored') <> 'string'
            or length(ingredient->'quantityV1'->>'authored') > 128
            or jsonb_typeof(ingredient->'quantityV1'->'source') <> 'string'
            or ingredient->'quantityV1'->>'source'
              not in ('authored','original-text','legacy-synthesized')
          )
        )
        or (
          ingredient ? 'packageV1'
          and (
            jsonb_typeof(ingredient->'packageV1') <> 'object'
            or jsonb_typeof(ingredient->'packageV1'->'version') <> 'number'
            or ingredient->'packageV1'->>'version' <> '1'
            or jsonb_typeof(ingredient->'packageV1'->'count') <> 'object'
            or jsonb_typeof(ingredient->'packageV1'->'size') <> 'object'
            or jsonb_typeof(ingredient->'packageV1'->'size'->'value') <> 'object'
            or jsonb_typeof(ingredient->'packageV1'->'size'->'lexeme') <> 'string'
            or jsonb_typeof(ingredient->'packageV1'->'size'->'unit') <> 'string'
            or jsonb_typeof(
              ingredient->'packageV1'->'size'->'authoredUnit'
            ) <> 'string'
            or jsonb_typeof(ingredient->'packageV1'->'type') <> 'string'
            or jsonb_typeof(ingredient->'packageV1'->'authoredType') <> 'string'
          )
        )
      )
  ) or exists (
    select 1
    from public.recipe_shares as share
    where share.status = 'pending'
      and jsonb_typeof(share.source_recipe_snapshot->'yield_metadata') = 'object'
      and (
        jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'->'version'
        ) <> 'number'
        or share.source_recipe_snapshot->'yield_metadata'->>'version' <> '1'
        or jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'->'authoredText'
        ) <> 'string'
        or length(
          share.source_recipe_snapshot->'yield_metadata'->>'authoredText'
        ) > 256
        or jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'->'kind'
        ) <> 'string'
        or share.source_recipe_snapshot->'yield_metadata'->>'kind'
          not in ('servings','portions','items','other')
        or jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'->'scalingBasis'
        ) <> 'object'
      )
  ) then
    raise exception 'pending recipe-share structured metadata is incompatible with migration 014 validation';
  end if;
end
$migration_014_preflight$;

rollback;
