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

  if v_share.source_recipe_snapshot = '{}'::jsonb then
    v_name := 'Shared Recipe';
    v_category := 'uncategorized';
    v_servings := 4;
  else
  if jsonb_typeof(v_share.source_recipe_snapshot) <> 'object' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if not (v_share.source_recipe_snapshot ? 'name')
     or not (v_share.source_recipe_snapshot ? 'category')
     or not (v_share.source_recipe_snapshot ? 'servings')
     or jsonb_typeof(v_share.source_recipe_snapshot->'name') <> 'string'
     or length(v_share.source_recipe_snapshot->>'name') > 512
     or nullif(trim(v_share.source_recipe_snapshot->>'name'), '') is null
     or jsonb_typeof(v_share.source_recipe_snapshot->'category') <> 'string'
     or length(v_share.source_recipe_snapshot->>'category') > 128
     or nullif(trim(v_share.source_recipe_snapshot->>'category'), '') is null
     or jsonb_typeof(v_share.source_recipe_snapshot->'servings') <> 'number'
     or (v_share.source_recipe_snapshot->>'servings') !~ '^(?:[1-9][0-9]{0,3}|10000)$' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if not (v_share.source_recipe_snapshot ? 'tags')
     or not (v_share.source_recipe_snapshot ? 'ingredients')
     or not (v_share.source_recipe_snapshot ? 'instructions')
     or jsonb_typeof(v_share.source_recipe_snapshot->'tags') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'tags') > 100
     or jsonb_typeof(v_share.source_recipe_snapshot->'ingredients') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'ingredients') > 500
     or jsonb_typeof(v_share.source_recipe_snapshot->'instructions') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'instructions') > 2000 then
    raise exception 'Invalid recipe snapshot';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'tags') as entry
    where jsonb_typeof(entry) <> 'string'
       or length(entry #>> '{}') > 128
  ) or exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'instructions') as entry
    where jsonb_typeof(entry) <> 'string'
       or length(entry #>> '{}') > 10000
  ) or exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'ingredients') as ingredient
    where jsonb_typeof(ingredient) <> 'object'
       or not (ingredient ? 'item')
       or not (ingredient ? 'amount')
       or not (ingredient ? 'unit')
       or jsonb_typeof(ingredient->'item') <> 'string'
       or nullif(trim(ingredient->>'item'), '') is null
       or length(ingredient->>'item') > 512
       or jsonb_typeof(ingredient->'unit') <> 'string'
       or length(ingredient->>'unit') > 64
       or (
         jsonb_typeof(ingredient->'amount') not in ('number', 'string', 'null')
       )
       or (
         ingredient ? 'quantityV1'
         and jsonb_typeof(ingredient->'quantityV1') <> 'object'
       )
       or (
         ingredient ? 'packageV1'
         and jsonb_typeof(ingredient->'packageV1') <> 'object'
       )
  ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'yield_metadata'
     and jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata') not in ('object', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;
  if jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata') = 'object'
     and (
       not (v_share.source_recipe_snapshot->'yield_metadata' ? 'version')
       or not (v_share.source_recipe_snapshot->'yield_metadata' ? 'authoredText')
       or not (v_share.source_recipe_snapshot->'yield_metadata' ? 'kind')
       or not (v_share.source_recipe_snapshot->'yield_metadata' ? 'scalingBasis')
       or v_share.source_recipe_snapshot->'yield_metadata'->>'version' <> '1'
       or jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata'->'authoredText') <> 'string'
       or length(v_share.source_recipe_snapshot->'yield_metadata'->>'authoredText') > 256
       or v_share.source_recipe_snapshot->'yield_metadata'->>'kind'
         not in ('servings', 'portions', 'items', 'other')
       or jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata'->'scalingBasis') <> 'object'
     ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'image_url'
     and jsonb_typeof(v_share.source_recipe_snapshot->'image_url') not in ('string', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;
  if exists (
    select 1
    from unnest(array['prep_time_minutes', 'cook_time_minutes', 'total_time_minutes']) as field_name
    where v_share.source_recipe_snapshot ? field_name
      and jsonb_typeof(v_share.source_recipe_snapshot->field_name) <> 'null'
      and (
        jsonb_typeof(v_share.source_recipe_snapshot->field_name) <> 'number'
        or (v_share.source_recipe_snapshot->>field_name) !~ '^[0-9]{1,9}$'
      )
  ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'notes'
     and jsonb_typeof(v_share.source_recipe_snapshot->'notes') <> 'array' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if jsonb_typeof(v_share.source_recipe_snapshot->'notes') = 'array'
     and (
       jsonb_array_length(v_share.source_recipe_snapshot->'notes') > 2000
       or exists (
         select 1
         from jsonb_array_elements(v_share.source_recipe_snapshot->'notes') as entry
         where jsonb_typeof(entry) <> 'string'
            or length(entry #>> '{}') > 10000
       )
     ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'instruction_groups'
     and jsonb_typeof(v_share.source_recipe_snapshot->'instruction_groups')
       not in ('array', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;

  v_name := trim(v_share.source_recipe_snapshot->>'name');
  v_category := trim(v_share.source_recipe_snapshot->>'category');
  v_servings := (v_share.source_recipe_snapshot->>'servings')::integer;
  end if;

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
