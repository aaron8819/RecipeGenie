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
  if v_ledger is distinct from
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017' then
    raise exception 'migration 017 recovery preparation requires the exact post-017 ledger';
  end if;

  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null
     or exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'recipes'
         and column_name in ('ingredients', 'instructions', 'instruction_groups')
     )
     or (
       select count(*)
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'recipes'
         and column_name in ('ingredient_sections', 'instruction_sections')
     ) <> 2 then
    raise exception 'migration 017 recovery preparation requires the canonical post-017 schema';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null then
    raise exception 'migration 017 recovery preparation requires the post-017 validators';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.recipe_history'::regclass
      and a.attname = 'id'
      and not a.attisdropped
      and a.attidentity = 'a'
      and pg_catalog.pg_get_serial_sequence('public.recipe_history', 'id') =
          'public.recipe_history_id_seq'
  ) then
    raise exception 'migration 017 recovery preparation requires recipe_history.id GENERATED ALWAYS identity';
  end if;
end
$$;

drop trigger on_auth_user_created on auth.users;

-- Production 016 uses an owned sequence/default for this column. pg_restore
-- cleans that DEFAULT before replacing the table, which PostgreSQL rejects
-- while the disposable target still marks the column as an identity.
alter table public.recipe_history alter column id drop identity;

alter table public.recipes
  drop constraint recipes_ingredient_sections_valid,
  drop constraint recipes_instruction_sections_valid;

drop function private.recipe_share_snapshot_is_valid(jsonb);
drop function private.recipe_instruction_sections_are_valid(jsonb);
drop function private.recipe_ingredient_sections_are_valid(jsonb);

commit;
