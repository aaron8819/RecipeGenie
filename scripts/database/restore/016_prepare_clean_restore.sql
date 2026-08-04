\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_ledger text;
begin
  select string_agg(version, ',' order by version)
    into v_ledger
    from supabase_migrations.schema_migrations;
  if v_ledger is distinct from '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016' then
    raise exception 'migration 016 recovery preparation requires the exact post-016 ledger';
  end if;
  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'recipes'
          and column_name = 'ingredient_sections'
     )
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'recipes'
          and column_name = 'instruction_sections'
     ) then
    raise exception 'migration 016 recovery preparation requires the canonical post-016 schema';
  end if;
end
$$;

drop trigger on_auth_user_created on auth.users;

alter table public.recipes
  drop constraint recipes_ingredient_sections_valid,
  drop constraint recipes_instruction_sections_valid;

drop function private.recipe_share_snapshot_is_valid(jsonb);
drop function private.recipe_notes_from_legacy(jsonb, text[]);
drop function private.recipe_instruction_sections_flatten(jsonb);
drop function private.recipe_instruction_sections_from_groups(jsonb);
drop function private.recipe_instruction_sections_from_flat(text[]);
drop function private.recipe_ingredient_sections_flatten(jsonb);
drop function private.recipe_ingredient_sections_from_legacy(jsonb);
drop function private.recipe_instruction_sections_are_valid(jsonb);
drop function private.recipe_ingredient_sections_are_valid(jsonb);

commit;
