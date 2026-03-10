alter table public.recipes
  add column if not exists prep_time_minutes integer,
  add column if not exists cook_time_minutes integer,
  add column if not exists total_time_minutes integer,
  add column if not exists notes jsonb not null default '[]'::jsonb,
  add column if not exists instruction_groups jsonb;

create or replace function public.accept_recipe_share(p_share_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_share public.recipe_shares%rowtype;
  v_name text;
  v_category text;
  v_servings integer;
  v_image_url text;
  v_tags text[];
  v_instructions text[];
  v_ingredients jsonb;
  v_notes jsonb;
  v_instruction_groups jsonb;
  v_prep_time_minutes integer;
  v_cook_time_minutes integer;
  v_total_time_minutes integer;
  v_base_id text;
  v_new_recipe_id text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select *
  into v_share
  from public.recipe_shares
  where id = p_share_id
    and recipient_user_id = v_user_id
  for update;

  if not found then
    raise exception 'Share not found';
  end if;

  if v_share.status = 'accepted' and v_share.accepted_recipe_id is not null then
    return v_share.accepted_recipe_id;
  end if;

  if v_share.status <> 'pending' then
    raise exception 'Share is no longer pending';
  end if;

  v_name := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'name'), ''), 'Shared Recipe');
  v_category := coalesce(
    nullif(trim(v_share.source_recipe_snapshot->>'category'), ''),
    'uncategorized'
  );
  v_servings := coalesce((v_share.source_recipe_snapshot->>'servings')::integer, 4);
  v_image_url := nullif(trim(v_share.source_recipe_snapshot->>'image_url'), '');
  v_ingredients := coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb);
  v_notes := coalesce(v_share.source_recipe_snapshot->'notes', '[]'::jsonb);
  v_instruction_groups := v_share.source_recipe_snapshot->'instruction_groups';
  v_prep_time_minutes := nullif(v_share.source_recipe_snapshot->>'prep_time_minutes', '')::integer;
  v_cook_time_minutes := nullif(v_share.source_recipe_snapshot->>'cook_time_minutes', '')::integer;
  v_total_time_minutes := nullif(v_share.source_recipe_snapshot->>'total_time_minutes', '')::integer;

  select coalesce(array_agg(value), '{}'::text[])
  into v_tags
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'tags', '[]'::jsonb)
  );

  select coalesce(array_agg(value), '{}'::text[])
  into v_instructions
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'instructions', '[]'::jsonb)
  );

  v_base_id := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_id := trim(both '-' from v_base_id);
  if v_base_id = '' then
    v_base_id := 'shared-recipe';
  end if;
  v_new_recipe_id := v_base_id || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.recipes (
    id,
    user_id,
    name,
    category,
    servings,
    favorite,
    tags,
    ingredients,
    instructions,
    image_url,
    prep_time_minutes,
    cook_time_minutes,
    total_time_minutes,
    notes,
    instruction_groups
  )
  values (
    v_new_recipe_id,
    v_user_id,
    v_name,
    v_category,
    v_servings,
    false,
    v_tags,
    v_ingredients,
    v_instructions,
    v_image_url,
    v_prep_time_minutes,
    v_cook_time_minutes,
    v_total_time_minutes,
    v_notes,
    v_instruction_groups
  );

  update public.recipe_shares
  set
    status = 'accepted',
    accepted_recipe_id = v_new_recipe_id,
    responded_at = now()
  where id = v_share.id;

  return v_new_recipe_id;
end;
$$;
