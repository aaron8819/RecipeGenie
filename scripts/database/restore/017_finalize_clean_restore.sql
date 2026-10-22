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
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016' then
    raise exception 'migration 017 recovery finalization requires the restored post-016 ledger';
  end if;

  if to_regprocedure('public.handle_new_user()') is null
     or (
       select count(*)
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'recipes'
         and column_name in (
           'ingredients', 'instructions', 'instruction_groups',
           'ingredient_sections', 'instruction_sections'
         )
     ) <> 5 then
    raise exception 'migration 017 recovery finalization requires the restored post-016 schema';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = 'public.recipe_history'::regclass
      and a.attname = 'id'
      and not a.attisdropped
      and a.attidentity = ''
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) ~
          '^nextval\(''(public\.)?recipe_history_id_seq''::regclass\)$'
      and pg_catalog.pg_get_serial_sequence('public.recipe_history', 'id') =
          'public.recipe_history_id_seq'
  ) then
    raise exception 'migration 017 recovery finalization requires the restored recipe_history.id sequence default';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and not tgisinternal
  ) then
    raise exception 'auth user trigger already exists before recovery finalization';
  end if;
end
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

commit;
