-- Reconcile production drift caused by the abandoned recipe-audit branch and
-- legacy bootstrap changes. Every destructive change is guarded so this
-- migration aborts instead of discarding live application data.

do $$
declare
  table_name text;
  recipe_audits_has_rows boolean := false;
begin
  if to_regclass('public.recipe_audits') is not null then
    execute 'select exists (select 1 from public.recipe_audits)'
      into recipe_audits_has_rows;

    if recipe_audits_has_rows then
      raise exception 'Cannot drop public.recipe_audits: the table contains rows';
    end if;
  end if;

  foreach table_name in array array[
    'pantry_items',
    'recipe_history',
    'recipes',
    'shopping_list',
    'user_config',
    'weekly_plans'
  ]
  loop
    if exists (
      select 1
      from public.pantry_items
      where table_name = 'pantry_items' and user_id is null
    ) or exists (
      select 1
      from public.recipe_history
      where table_name = 'recipe_history' and user_id is null
    ) or exists (
      select 1
      from public.recipes
      where table_name = 'recipes' and user_id is null
    ) or exists (
      select 1
      from public.shopping_list
      where table_name = 'shopping_list' and user_id is null
    ) or exists (
      select 1
      from public.user_config
      where table_name = 'user_config' and user_id is null
    ) or exists (
      select 1
      from public.weekly_plans
      where table_name = 'weekly_plans' and user_id is null
    ) then
      raise exception 'Cannot restore %.user_id: NULL values exist', table_name;
    end if;
  end loop;

  if exists (
    select user_id from public.shopping_list group by user_id having count(*) > 1
  ) then
    raise exception 'Cannot restore shopping_list_pkey: duplicate user_id values exist';
  end if;

  if exists (
    select user_id from public.user_config group by user_id having count(*) > 1
  ) then
    raise exception 'Cannot restore user_config_pkey: duplicate user_id values exist';
  end if;
end $$;

drop table if exists public.recipe_audits;

alter table public.pantry_items
  alter column user_id drop default,
  alter column user_id set not null;

alter table public.recipe_history
  alter column user_id drop default,
  alter column user_id set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipe_history'
      and column_name = 'id'
      and is_identity = 'YES'
      and identity_generation = 'BY DEFAULT'
  ) then
    alter table public.recipe_history alter column id set generated always;
  end if;
end $$;

alter table public.recipes
  alter column user_id drop default,
  alter column user_id set not null;

alter table public.weekly_plans
  alter column user_id drop default,
  alter column user_id set not null;

do $$
declare
  target_table text;
  primary_key_name text;
  primary_key_columns text[];
begin
  foreach target_table in array array['shopping_list', 'user_config']
  loop
    select c.conname, array_agg(a.attname::text order by key_column.ordinality)
      into primary_key_name, primary_key_columns
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join unnest(c.conkey) with ordinality as key_column(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = key_column.attnum
    where n.nspname = 'public'
      and t.relname = target_table
      and c.contype = 'p'
    group by c.conname;

    if primary_key_name is not null and primary_key_columns <> array['user_id'] then
      execute format(
        'alter table public.%I drop constraint %I',
        target_table,
        primary_key_name
      );
      primary_key_name := null;
    end if;

    execute format(
      'alter table public.%I alter column user_id drop default',
      target_table
    );
    execute format(
      'alter table public.%I alter column user_id set not null',
      target_table
    );
    execute format(
      'alter table public.%I drop column if exists id',
      target_table
    );

    if primary_key_name is null then
      execute format(
        'alter table public.%I add constraint %I primary key (user_id)',
        target_table,
        target_table || '_pkey'
      );
    end if;
  end loop;
end $$;

alter table public.user_config
  alter column shopping_item_order set default '{}'::jsonb,
  alter column shopping_item_order set not null;
