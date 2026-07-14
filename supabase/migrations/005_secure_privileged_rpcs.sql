-- Remove caller-selected identities from user-owned RPCs and reduce elevated
-- execution to the two operations that require an owner boundary.

-- This operation copies a share atomically and must bypass the recipient
-- update policy, so retain SECURITY DEFINER with explicit in-function auth.
alter function public.accept_recipe_share(uuid)
  security definer
  set search_path = '';

revoke all privileges on function public.accept_recipe_share(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_recipe_share(uuid) to authenticated;

-- New-user defaults run from the trusted auth.users trigger, where auth.uid()
-- is intentionally unavailable. Keep the trusted identity in NEW.id and
-- remove the separately callable helper that accepted an arbitrary UUID.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema <> 'auth' or tg_table_name <> 'users' or tg_op <> 'INSERT' then
    raise exception 'handle_new_user must run from the auth.users insert trigger';
  end if;

  begin
    insert into public.user_config (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    insert into public.shopping_list (user_id)
    values (new.id)
    on conflict (user_id) do nothing;

    insert into public.recipes (
      id,
      user_id,
      name,
      category,
      servings,
      favorite,
      tags,
      ingredients,
      instructions
    )
    values
      (
        'mac-and-cheese-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        new.id,
        '4-Ingredient Mac & Cheese',
        'vegetarian',
        4,
        false,
        array['default'],
        '[{"item":"elbow macaroni","unit":"oz","amount":8},{"item":"milk","unit":"cup","amount":2},{"item":"cheddar cheese","unit":"cups","amount":2}]'::jsonb,
        array['Boil pasta.', 'Warm milk.', 'Stir in cheese.', 'Combine and serve.']
      ),
      (
        'beef-and-broccoli-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        new.id,
        'Beef and Broccoli',
        'beef',
        4,
        true,
        array['default'],
        '[{"item":"beef","unit":"lb","amount":1},{"item":"broccoli","unit":"cups","amount":3}]'::jsonb,
        array['Sear beef.', 'Stir-fry broccoli.', 'Combine with sauce.']
      ),
      (
        'turkey-burger-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
        new.id,
        'Turkey Burger',
        'turkey',
        4,
        false,
        array['default'],
        '[{"item":"ground turkey","unit":"lb","amount":1}]'::jsonb,
        array['Form patties.', 'Cook until done.', 'Serve with toppings.']
      )
    on conflict (id) do nothing;
  exception
    when others then
      raise warning 'Could not insert defaults for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

alter function public.handle_new_user() owner to postgres;
revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;

revoke all privileges on function public.insert_default_recipes_for_user(uuid)
  from public, anon, authenticated, service_role;
drop function public.insert_default_recipes_for_user(uuid);

-- Remove every caller-controlled identity overload before publishing the new
-- authenticated-principal contracts.
revoke all privileges on function public.delete_tag(uuid, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.filter_recipes_by_tags(uuid, text[])
  from public, anon, authenticated, service_role;
revoke all privileges on function public.get_recipe_history_stats(uuid)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.merge_tags(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.rename_tag(uuid, text, text)
  from public, anon, authenticated, service_role;

drop function public.delete_tag(uuid, text);
drop function public.filter_recipes_by_tags(uuid, text[]);
drop function public.get_recipe_history_stats(uuid);
drop function public.merge_tags(uuid, text, text);
drop function public.rename_tag(uuid, text, text);

create function public.delete_tag(p_tag text)
returns void
language plpgsql
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.recipes as recipe
  set tags = array_remove(recipe.tags, p_tag)
  where recipe.user_id = v_user_id
    and p_tag = any(recipe.tags);
end;
$$;

create function public.filter_recipes_by_tags(p_tags text[])
returns setof public.recipes
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  return query
  select recipe.*
  from public.recipes as recipe
  where recipe.user_id = v_user_id
    and recipe.tags && p_tags
  order by recipe.name asc;
end;
$$;

create function public.get_recipe_history_stats()
returns table(recipe_id text, times_made integer, last_made timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    history.recipe_id,
    count(*)::integer as times_made,
    max(history.date_made) as last_made
  from public.recipe_history as history
  where history.user_id = v_user_id
  group by history.recipe_id
  order by max(history.date_made) desc;
end;
$$;

create function public.merge_tags(p_source_tag text, p_target_tag text)
returns void
language plpgsql
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.recipes as recipe
  set tags = array(
    select distinct unnest(array_replace(recipe.tags, p_source_tag, p_target_tag))
  )
  where recipe.user_id = v_user_id
    and p_source_tag = any(recipe.tags);
end;
$$;

create function public.rename_tag(p_old_tag text, p_new_tag text)
returns void
language plpgsql
security invoker
set search_path = ''
set row_security = on
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  update public.recipes as recipe
  set tags = array_replace(recipe.tags, p_old_tag, p_new_tag)
  where recipe.user_id = v_user_id
    and p_old_tag = any(recipe.tags);
end;
$$;

alter function public.delete_tag(text) owner to postgres;
alter function public.filter_recipes_by_tags(text[]) owner to postgres;
alter function public.get_recipe_history_stats() owner to postgres;
alter function public.merge_tags(text, text) owner to postgres;
alter function public.rename_tag(text, text) owner to postgres;

revoke all privileges on function public.delete_tag(text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.filter_recipes_by_tags(text[])
  from public, anon, authenticated, service_role;
revoke all privileges on function public.get_recipe_history_stats()
  from public, anon, authenticated, service_role;
revoke all privileges on function public.merge_tags(text, text)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.rename_tag(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.delete_tag(text) to authenticated;
grant execute on function public.filter_recipes_by_tags(text[]) to authenticated;
grant execute on function public.get_recipe_history_stats() to authenticated;
grant execute on function public.merge_tags(text, text) to authenticated;
grant execute on function public.rename_tag(text, text) to authenticated;

-- Require future functions to opt in to Data API execution explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;
