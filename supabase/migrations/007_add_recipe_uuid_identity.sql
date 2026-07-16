-- Stage 1 of the recipe identity migration.
--
-- Keep the legacy text primary key and every existing reference intact while
-- assigning each recipe its permanent opaque identity. A later application
-- stage will move references to recipe_uuid before the legacy key is retired.

alter table public.recipes
  add column recipe_uuid uuid;

update public.recipes
set recipe_uuid = gen_random_uuid()
where recipe_uuid is null;

alter table public.recipes
  alter column recipe_uuid set default gen_random_uuid(),
  alter column recipe_uuid set not null;

alter table public.recipes
  add constraint recipes_recipe_uuid_key unique (recipe_uuid);

comment on column public.recipes.recipe_uuid is
  'Permanent opaque recipe identity. Stage 1 keeps recipes.id as an immutable legacy compatibility key.';

comment on column public.recipes.id is
  'Legacy recipe identity retained temporarily for compatibility. New canonical identity is recipe_uuid.';

create function public.prevent_recipe_uuid_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.recipe_uuid is distinct from old.recipe_uuid then
    raise exception 'recipe_uuid is immutable';
  end if;
  return new;
end;
$$;

alter function public.prevent_recipe_uuid_update() owner to postgres;
revoke all privileges on function public.prevent_recipe_uuid_update()
  from public, anon, authenticated, service_role;

create trigger prevent_recipe_uuid_update
before update of recipe_uuid on public.recipes
for each row execute function public.prevent_recipe_uuid_update();

do $$
begin
  if exists (select 1 from public.recipes where recipe_uuid is null) then
    raise exception 'recipe UUID backfill left NULL identities';
  end if;

  if (select count(*) from public.recipes)
     <> (select count(distinct recipe_uuid) from public.recipes) then
    raise exception 'recipe UUID backfill is not one-to-one';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'recipes'
      and constraint_row.contype = 'u'
      and pg_get_constraintdef(constraint_row.oid) ilike '%name%'
  ) then
    raise exception 'recipe names must remain non-unique';
  end if;
end;
$$;
