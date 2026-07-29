-- Additive recipe yield metadata; historical ingredient JSON remains untouched.
begin;

alter table public.recipes
  add column yield_metadata jsonb;

comment on column public.recipes.yield_metadata is
  'Versioned authored yield, exact value or range, kind, and explicit scaling basis. The servings column remains the compatibility projection.';

create or replace function public.accept_recipe_share(p_share_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.recipe_shares%rowtype;
  v_new_recipe_uuid uuid := gen_random_uuid();
  v_name text;
  v_category text;
  v_servings integer;
  v_tags text[];
  v_instructions text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select *
  into v_share
  from public.recipe_shares
  where id = p_share_id
    and recipient_user_id = v_user_id
  for update;

  if not found then raise exception 'Share not found'; end if;
  if v_share.status = 'accepted' and v_share.accepted_recipe_uuid is not null then
    return v_share.accepted_recipe_uuid;
  end if;
  if v_share.status <> 'pending' then
    raise exception 'Share is no longer pending';
  end if;

  v_name := coalesce(
    nullif(trim(v_share.source_recipe_snapshot->>'name'), ''),
    'Shared Recipe'
  );
  v_category := coalesce(
    nullif(trim(v_share.source_recipe_snapshot->>'category'), ''),
    'uncategorized'
  );
  v_servings := coalesce(
    (v_share.source_recipe_snapshot->>'servings')::integer,
    4
  );

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

  insert into public.recipes(
    id,
    recipe_uuid,
    user_id,
    name,
    category,
    servings,
    yield_metadata,
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
  ) values (
    v_new_recipe_uuid::text,
    v_new_recipe_uuid,
    v_user_id,
    v_name,
    v_category,
    v_servings,
    v_share.source_recipe_snapshot->'yield_metadata',
    false,
    v_tags,
    coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb),
    v_instructions,
    nullif(trim(v_share.source_recipe_snapshot->>'image_url'), ''),
    nullif(v_share.source_recipe_snapshot->>'prep_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'cook_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'total_time_minutes', '')::integer,
    coalesce(v_share.source_recipe_snapshot->'notes', '[]'::jsonb),
    v_share.source_recipe_snapshot->'instruction_groups'
  );

  update public.recipe_shares
  set
    status = 'accepted',
    accepted_recipe_uuid = v_new_recipe_uuid,
    responded_at = now()
  where id = v_share.id;

  return v_new_recipe_uuid;
end;
$$;

alter function public.accept_recipe_share(uuid) owner to postgres;
revoke all privileges on function public.accept_recipe_share(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_recipe_share(uuid) to authenticated;

commit;
