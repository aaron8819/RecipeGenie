\set ON_ERROR_STOP on

begin transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_ledger text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;

  select string_agg(version, ',' order by version)
  into v_ledger
  from supabase_migrations.schema_migrations;
  if v_ledger is distinct from
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016' then
    raise exception 'migration 017 requires the exact ledger through 016';
  end if;

  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null then
    raise exception 'migration 017 requires the canonical recipe tables';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and (
        (column_name = 'ingredients' and data_type = 'jsonb' and is_nullable = 'NO')
        or (column_name = 'instructions' and data_type = 'ARRAY'
          and udt_name = '_text' and is_nullable = 'NO')
        or (column_name = 'instruction_groups' and data_type = 'jsonb')
        or (column_name = 'ingredient_sections' and data_type = 'jsonb'
          and is_nullable = 'NO')
        or (column_name = 'instruction_sections' and data_type = 'jsonb'
          and is_nullable = 'NO')
      )
  ) <> 5 then
    raise exception 'migration 017 requires the exact post-016 recipe columns';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null
     or to_regprocedure('private.recipe_ingredient_sections_from_legacy(jsonb)') is null
     or to_regprocedure('private.recipe_ingredient_sections_flatten(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_from_flat(text[])') is null
     or to_regprocedure('private.recipe_instruction_sections_from_groups(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_flatten(jsonb)') is null
     or to_regprocedure('private.recipe_notes_from_legacy(jsonb,text[])') is null
     or to_regprocedure('private.recipe_instruction_groups_are_valid(jsonb)') is null
     or to_regprocedure('public.accept_recipe_share(uuid)') is null
     or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'migration 017 requires the exact post-016 functions';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname in (
        'recipes_ingredient_sections_valid',
        'recipes_instruction_sections_valid'
      )
  ) <> 2 then
    raise exception 'migration 017 requires the canonical recipe constraints';
  end if;

  if exists (
    select 1 from public.recipes
    where not private.recipe_ingredient_sections_are_valid(ingredient_sections)
       or not private.recipe_instruction_sections_are_valid(instruction_sections)
  ) then
    raise exception 'migration 017 found invalid canonical recipes';
  end if;

  if exists (
    select 1 from public.recipe_shares
    where not private.recipe_share_snapshot_is_valid(source_recipe_snapshot)
  ) then
    raise exception 'migration 017 found invalid canonical share snapshots';
  end if;
end;
$preflight$;

rollback;
