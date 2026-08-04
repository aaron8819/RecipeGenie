begin;

create or replace function private.recipe_ingredient_sections_are_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_value) <> 'array'
     or jsonb_array_length(p_value) > 500 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_value) as section
    where jsonb_typeof(section) <> 'object'
       or not (section ?& array['label', 'ingredients'])
       or exists (
         select 1 from jsonb_object_keys(section) as key
         where key <> all(array['label', 'ingredients'])
       )
       or jsonb_typeof(section->'label') not in ('string', 'null')
       or (
         jsonb_typeof(section->'label') = 'string'
         and (
           length(section->>'label') not between 1 and 128
           or section->>'label' <> trim(section->>'label')
         )
       )
       or jsonb_typeof(section->'ingredients') <> 'array'
       or jsonb_array_length(section->'ingredients') = 0
  ) then
    return false;
  end if;

  select coalesce(sum(jsonb_array_length(section->'ingredients')), 0)
  into v_count
  from jsonb_array_elements(p_value) as section;
  if v_count > 500 then return false; end if;

  return not exists (
    select 1
    from jsonb_array_elements(p_value) as section
    cross join lateral jsonb_array_elements(section->'ingredients') as ingredient
    where ingredient ? 'groupLabel'
       or not private.recipe_ingredient_is_valid(ingredient)
  );
exception when others then
  return false;
end;
$$;

create or replace function private.recipe_instruction_sections_are_valid(
  p_value jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_value) <> 'array'
     or jsonb_array_length(p_value) > 500 then
    return false;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_value) as section
    where jsonb_typeof(section) <> 'object'
       or not (section ?& array['label', 'steps'])
       or exists (
         select 1 from jsonb_object_keys(section) as key
         where key <> all(array['label', 'steps'])
       )
       or jsonb_typeof(section->'label') not in ('string', 'null')
       or (
         jsonb_typeof(section->'label') = 'string'
         and (
           length(section->>'label') not between 1 and 128
           or section->>'label' <> trim(section->>'label')
         )
       )
       or jsonb_typeof(section->'steps') <> 'array'
       or jsonb_array_length(section->'steps') = 0
  ) then
    return false;
  end if;

  select coalesce(sum(jsonb_array_length(section->'steps')), 0)
  into v_count
  from jsonb_array_elements(p_value) as section;
  if v_count > 2000 then return false; end if;

  return not exists (
    select 1
    from jsonb_array_elements(p_value) as section
    cross join lateral jsonb_array_elements(section->'steps') as step
    where jsonb_typeof(step) <> 'string'
       or length(step #>> '{}') > 10000
       or step #>> '{}' <> trim(step #>> '{}')
       or nullif(step #>> '{}', '') is null
  );
exception when others then
  return false;
end;
$$;

create or replace function private.recipe_ingredient_sections_from_legacy(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_value) <> 'array'
     or jsonb_array_length(p_value) > 500
     or exists (
       select 1
       from jsonb_array_elements(p_value) as ingredient
       where not private.recipe_ingredient_is_valid(ingredient)
          or (
            ingredient ? 'groupLabel'
            and jsonb_typeof(ingredient->'groupLabel') not in ('string', 'null')
          )
     ) then
    raise exception 'legacy ingredient structure is malformed';
  end if;

  with items as (
    select
      item_order,
      ingredient - 'groupLabel' as ingredient,
      case
        when jsonb_typeof(ingredient->'groupLabel') = 'string'
          then nullif(trim(ingredient->>'groupLabel'), '')
        else null
      end as label
    from jsonb_array_elements(p_value) with ordinality
      as source(ingredient, item_order)
  ), boundaries as (
    select *,
      case
        when item_order = 1
          or label is distinct from lag(label) over (order by item_order)
        then 1 else 0
      end as starts_run
    from items
  ), numbered as (
    select *, sum(starts_run) over (order by item_order) as run_number
    from boundaries
  ), runs as (
    select
      run_number,
      min(item_order) as first_item,
      min(label) as label,
      jsonb_agg(ingredient order by item_order) as ingredients
    from numbered
    group by run_number
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('label', label, 'ingredients', ingredients)
      order by first_item
    ),
    '[]'::jsonb
  )
  into v_result
  from runs;

  if not private.recipe_ingredient_sections_are_valid(v_result) then
    raise exception 'converted ingredient sections are invalid';
  end if;
  return v_result;
end;
$$;

create or replace function private.recipe_instruction_sections_from_flat(
  p_value text[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sections jsonb := '[]'::jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_label text := null;
  v_line text;
  v_trimmed text;
  v_candidate text;
  v_words text[];
begin
  if p_value is null
     or cardinality(p_value) > 2000
     or exists (select 1 from unnest(p_value) as step where step is null)
     or exists (select 1 from unnest(p_value) as step where length(step) > 10000)
     then
    raise exception 'legacy flat instructions are malformed';
  end if;

  foreach v_line in array p_value loop
    v_trimmed := trim(v_line);
    if v_trimmed = '' then continue; end if;

    if lower(regexp_replace(v_trimmed, '[:\-–—]+$', '')) = 'notes' then
      exit;
    end if;

    v_candidate := regexp_replace(v_trimmed, ':[[:space:]]*$', '');
    v_words := regexp_split_to_array(trim(v_candidate), '[[:space:]]+');
    if right(v_trimmed, 1) = ':'
       and cardinality(v_words) between 1 and 6
       and v_trimmed !~ '[.!?(),0-9]' then
      if jsonb_array_length(v_steps) > 0 then
        v_sections := v_sections || jsonb_build_array(
          jsonb_build_object('label', v_label, 'steps', v_steps)
        );
      end if;
      v_label := nullif(trim(v_candidate), '');
      v_steps := '[]'::jsonb;
      continue;
    end if;

    v_trimmed := trim(regexp_replace(
      v_trimmed,
      '^[[:space:]]*(?:[0-9]+[.)]|[-*•])[[:space:]]+',
      ''
    ));
    if v_trimmed <> '' then
      v_steps := v_steps || jsonb_build_array(v_trimmed);
    end if;
  end loop;

  if jsonb_array_length(v_steps) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object('label', v_label, 'steps', v_steps)
    );
  end if;
  if not private.recipe_instruction_sections_are_valid(v_sections) then
    raise exception 'converted flat instruction sections are invalid';
  end if;
  return v_sections;
end;
$$;

create or replace function private.recipe_instruction_sections_from_groups(
  p_value jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_value) <> 'array'
     or jsonb_array_length(p_value) > 500
     or exists (
       select 1
       from jsonb_array_elements(p_value) as group_value
       where jsonb_typeof(group_value) <> 'object'
          or not (group_value ? 'steps')
          or exists (
            select 1 from jsonb_object_keys(group_value) as key
            where key <> all(array['label', 'steps'])
          )
          or (
            group_value ? 'label'
            and jsonb_typeof(group_value->'label') not in ('string', 'null')
          )
          or (
            jsonb_typeof(group_value->'label') = 'string'
            and length(group_value->>'label') > 128
          )
          or jsonb_typeof(group_value->'steps') <> 'array'
          or exists (
            select 1 from jsonb_array_elements(group_value->'steps') as step
            where jsonb_typeof(step) <> 'string'
               or length(step #>> '{}') > 10000
          )
     ) then
    raise exception 'legacy instruction groups are malformed';
  end if;

  with groups as (
    select group_value, group_order
    from jsonb_array_elements(p_value) with ordinality
      as source(group_value, group_order)
  ), normalized as (
    select
      group_order,
      case
        when jsonb_typeof(group_value->'label') = 'string'
          then nullif(trim(group_value->>'label'), '')
        else null
      end as label,
      coalesce((
        select jsonb_agg(to_jsonb(trim(step #>> '{}')) order by step_order)
        from jsonb_array_elements(group_value->'steps') with ordinality
          as steps(step, step_order)
        where nullif(trim(step #>> '{}'), '') is not null
      ), '[]'::jsonb) as steps
    from groups
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('label', label, 'steps', steps)
      order by group_order) filter (where jsonb_array_length(steps) > 0),
    '[]'::jsonb
  )
  into v_result
  from normalized;

  if not private.recipe_instruction_sections_are_valid(v_result) then
    raise exception 'converted grouped instruction sections are invalid';
  end if;
  return v_result;
end;
$$;

create or replace function private.recipe_instruction_sections_flatten(
  p_value jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(step order by section_order, step_order), '[]'::jsonb)
  from jsonb_array_elements(p_value) with ordinality
    as sections(section_value, section_order)
  cross join lateral jsonb_array_elements(section_value->'steps') with ordinality
    as steps(step, step_order)
$$;

create or replace function private.recipe_notes_from_legacy(
  p_notes jsonb,
  p_instructions text[]
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_notes_index integer;
begin
  if jsonb_typeof(p_notes) <> 'array'
     or jsonb_array_length(p_notes) > 2000
     or exists (
       select 1 from jsonb_array_elements(p_notes) as note
       where jsonb_typeof(note) <> 'string'
          or length(note #>> '{}') > 10000
          or nullif(trim(note #>> '{}'), '') is null
     ) then
    raise exception 'legacy notes are malformed';
  end if;

  select coalesce(jsonb_agg(to_jsonb(trim(note #>> '{}')) order by note_order), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(p_notes) with ordinality as notes(note, note_order);
  if jsonb_array_length(v_result) > 0 then return v_result; end if;

  select instruction_order into v_notes_index
  from unnest(p_instructions) with ordinality as lines(line, instruction_order)
  where lower(regexp_replace(trim(line), '[:\-–—]+$', '')) = 'notes'
  order by instruction_order
  limit 1;
  if v_notes_index is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(to_jsonb(trim(line)) order by instruction_order), '[]'::jsonb)
  into v_result
  from unnest(p_instructions) with ordinality as lines(line, instruction_order)
  where instruction_order > v_notes_index and nullif(trim(line), '') is not null;
  return v_result;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.recipes
    where private.recipe_ingredient_sections_from_legacy(ingredients) is null
       or private.recipe_instruction_sections_from_flat(instructions) is null
       or private.recipe_notes_from_legacy(notes, instructions) is null
       or (
         instruction_groups is not null
         and private.recipe_instruction_sections_from_groups(instruction_groups) is null
       )
  ) then
    raise exception 'canonical recipe conversion precondition failed';
  end if;

  if exists (
    select 1 from public.recipes
    where instruction_groups is not null
      and jsonb_array_length(
        private.recipe_instruction_sections_from_groups(instruction_groups)
      ) > 0
      and private.recipe_instruction_sections_flatten(
        private.recipe_instruction_sections_from_groups(instruction_groups)
      ) <> private.recipe_instruction_sections_flatten(
        private.recipe_instruction_sections_from_flat(instructions)
      )
  ) then
    raise exception 'conflicting legacy instruction representations';
  end if;

  if exists (
    select 1 from public.recipe_shares
    where source_recipe_snapshot = '{}'::jsonb
       or not private.recipe_share_snapshot_is_valid(source_recipe_snapshot)
       or private.recipe_ingredient_sections_from_legacy(
         source_recipe_snapshot->'ingredients'
       ) is null
       or private.recipe_instruction_sections_from_flat(
         array(
           select jsonb_array_elements_text(
             source_recipe_snapshot->'instructions'
           )
         )
       ) is null
       or (
         jsonb_typeof(source_recipe_snapshot->'instruction_groups') = 'array'
         and private.recipe_instruction_sections_from_groups(
           source_recipe_snapshot->'instruction_groups'
         ) is null
       )
  ) then
    raise exception 'canonical share conversion precondition failed';
  end if;

  if exists (
    select 1 from public.recipe_shares
    where jsonb_typeof(source_recipe_snapshot->'instruction_groups') = 'array'
      and jsonb_array_length(
        private.recipe_instruction_sections_from_groups(
          source_recipe_snapshot->'instruction_groups'
        )
      ) > 0
      and private.recipe_instruction_sections_flatten(
        private.recipe_instruction_sections_from_groups(
          source_recipe_snapshot->'instruction_groups'
        )
      ) <> private.recipe_instruction_sections_flatten(
        private.recipe_instruction_sections_from_flat(
          array(
            select jsonb_array_elements_text(
              source_recipe_snapshot->'instructions'
            )
          )
        )
      )
  ) then
    raise exception 'conflicting legacy share instruction representations';
  end if;
end;
$$;

alter table public.recipes
  add column if not exists ingredient_sections jsonb,
  add column if not exists instruction_sections jsonb;

update public.recipes
set
  ingredient_sections = private.recipe_ingredient_sections_from_legacy(ingredients),
  instruction_sections = case
    when instruction_groups is not null
      and jsonb_array_length(
        private.recipe_instruction_sections_from_groups(instruction_groups)
      ) > 0
      then private.recipe_instruction_sections_from_groups(instruction_groups)
    else private.recipe_instruction_sections_from_flat(instructions)
  end,
  notes = private.recipe_notes_from_legacy(notes, instructions);

update public.recipe_shares
set source_recipe_snapshot =
  source_recipe_snapshot
    - 'ingredients'
    - 'instructions'
    - 'instruction_groups'
  || jsonb_build_object(
    'ingredient_sections',
      private.recipe_ingredient_sections_from_legacy(
        source_recipe_snapshot->'ingredients'
      ),
    'instruction_sections',
      case
        when jsonb_typeof(source_recipe_snapshot->'instruction_groups') = 'array'
          and jsonb_array_length(
            private.recipe_instruction_sections_from_groups(
              source_recipe_snapshot->'instruction_groups'
            )
          ) > 0
          then private.recipe_instruction_sections_from_groups(
            source_recipe_snapshot->'instruction_groups'
          )
        else private.recipe_instruction_sections_from_flat(
          array(
            select jsonb_array_elements_text(
              source_recipe_snapshot->'instructions'
            )
          )
        )
      end
  );

alter table public.recipes
  alter column ingredient_sections set default '[]'::jsonb,
  alter column ingredient_sections set not null,
  alter column instruction_sections set default '[]'::jsonb,
  alter column instruction_sections set not null;

alter table public.recipes
  add constraint recipes_ingredient_sections_valid
    check (private.recipe_ingredient_sections_are_valid(ingredient_sections)),
  add constraint recipes_instruction_sections_valid
    check (private.recipe_instruction_sections_are_valid(instruction_sections));

create or replace function private.recipe_share_snapshot_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array[
       'name','category','servings','tags',
       'ingredient_sections','instruction_sections'
     ])
     or p_value ?| array['ingredients','instructions','instruction_groups']
     or jsonb_typeof(p_value->'name') <> 'string'
     or length(p_value->>'name') not between 1 and 512
     or nullif(trim(p_value->>'name'), '') is null
     or jsonb_typeof(p_value->'category') <> 'string'
     or length(p_value->>'category') not between 1 and 128
     or nullif(trim(p_value->>'category'), '') is null
     or jsonb_typeof(p_value->'servings') <> 'number'
     or (p_value->>'servings') !~ '^(?:[1-9][0-9]{0,3}|10000)$'
     or jsonb_typeof(p_value->'tags') <> 'array'
     or jsonb_array_length(p_value->'tags') > 100
     or not private.recipe_ingredient_sections_are_valid(
       p_value->'ingredient_sections'
     )
     or not private.recipe_instruction_sections_are_valid(
       p_value->'instruction_sections'
     ) then
    return false;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_value->'tags') as entry
    where jsonb_typeof(entry) <> 'string'
       or length(entry #>> '{}') > 128
       or nullif(trim(entry #>> '{}'), '') is null
  ) then return false; end if;

  if p_value ? 'yield_metadata'
     and jsonb_typeof(p_value->'yield_metadata') not in ('object', 'null') then
    return false;
  end if;
  if jsonb_typeof(p_value->'yield_metadata') = 'object'
     and not private.recipe_yield_metadata_is_valid(p_value->'yield_metadata') then
    return false;
  end if;
  if p_value ? 'image_url'
     and jsonb_typeof(p_value->'image_url') not in ('string', 'null') then
    return false;
  end if;
  if jsonb_typeof(p_value->'image_url') = 'string'
     and length(p_value->>'image_url') > 8192 then return false; end if;

  if exists (
    select 1
    from unnest(array[
      'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes'
    ]) as field_name
    where p_value ? field_name
      and jsonb_typeof(p_value->field_name) <> 'null'
      and (
        jsonb_typeof(p_value->field_name) <> 'number'
        or (p_value->>field_name) !~ '^[0-9]{1,9}$'
      )
  ) then return false; end if;

  if p_value ? 'notes'
     and jsonb_typeof(p_value->'notes') not in ('array', 'null') then
    return false;
  end if;
  if jsonb_typeof(p_value->'notes') = 'array'
     and (
       jsonb_array_length(p_value->'notes') > 2000
       or exists (
         select 1 from jsonb_array_elements(p_value->'notes') as entry
         where jsonb_typeof(entry) <> 'string'
            or length(entry #>> '{}') > 10000
            or nullif(trim(entry #>> '{}'), '') is null
       )
     ) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

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
  v_tags text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  select * into v_share
  from public.recipe_shares
  where id = p_share_id and recipient_user_id = v_user_id
  for update;
  if not found then raise exception 'Share not found'; end if;
  if v_share.status = 'accepted' and v_share.accepted_recipe_uuid is not null then
    return v_share.accepted_recipe_uuid;
  end if;
  if v_share.status <> 'pending' then raise exception 'Share is no longer pending'; end if;
  if not private.recipe_share_snapshot_is_valid(v_share.source_recipe_snapshot) then
    raise exception 'Invalid recipe snapshot';
  end if;

  select coalesce(array_agg(value), '{}'::text[])
  into v_tags
  from jsonb_array_elements_text(v_share.source_recipe_snapshot->'tags');

  insert into public.recipes(
    id, recipe_uuid, user_id, name, category, servings, yield_metadata,
    favorite, tags, ingredient_sections, instruction_sections, image_url,
    prep_time_minutes, cook_time_minutes, total_time_minutes, notes
  ) values (
    v_new_recipe_uuid::text,
    v_new_recipe_uuid,
    v_user_id,
    trim(v_share.source_recipe_snapshot->>'name'),
    trim(v_share.source_recipe_snapshot->>'category'),
    (v_share.source_recipe_snapshot->>'servings')::integer,
    v_share.source_recipe_snapshot->'yield_metadata',
    false,
    v_tags,
    v_share.source_recipe_snapshot->'ingredient_sections',
    v_share.source_recipe_snapshot->'instruction_sections',
    nullif(trim(v_share.source_recipe_snapshot->>'image_url'), ''),
    nullif(v_share.source_recipe_snapshot->>'prep_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'cook_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'total_time_minutes', '')::integer,
    coalesce(v_share.source_recipe_snapshot->'notes', '[]'::jsonb)
  );

  update public.recipe_shares
  set status = 'accepted', accepted_recipe_uuid = v_new_recipe_uuid,
      responded_at = now()
  where id = v_share.id;
  return v_new_recipe_uuid;
end;
$$;

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
    insert into public.user_config(user_id) values (new.id)
      on conflict (user_id) do nothing;
    insert into public.shopping_list(user_id) values (new.id)
      on conflict (user_id) do nothing;
    insert into public.recipes(
      id, recipe_uuid, user_id, name, category, servings, favorite, tags,
      ingredient_sections, instruction_sections
    )
    select seed.recipe_uuid::text, seed.recipe_uuid, new.id, seed.name,
      seed.category, seed.servings, seed.favorite, seed.tags,
      jsonb_build_array(jsonb_build_object(
        'label', null, 'ingredients', seed.ingredients
      )),
      jsonb_build_array(jsonb_build_object(
        'label', null, 'steps', to_jsonb(seed.instructions)
      ))
    from (
      values
        (gen_random_uuid(), '4-Ingredient Mac & Cheese', 'vegetarian', 4, false,
          array['default'],
          '[{"item":"elbow macaroni","unit":"oz","amount":8},{"item":"milk","unit":"cup","amount":2},{"item":"cheddar cheese","unit":"cups","amount":2}]'::jsonb,
          array['Boil pasta.', 'Warm milk.', 'Stir in cheese.', 'Combine and serve.']),
        (gen_random_uuid(), 'Beef and Broccoli', 'beef', 4, true,
          array['default'],
          '[{"item":"beef","unit":"lb","amount":1},{"item":"broccoli","unit":"cups","amount":3}]'::jsonb,
          array['Sear beef.', 'Stir-fry broccoli.', 'Combine with sauce.']),
        (gen_random_uuid(), 'Turkey Burger', 'turkey', 4, false,
          array['default'],
          '[{"item":"ground turkey","unit":"lb","amount":1}]'::jsonb,
          array['Form patties.', 'Cook until done.', 'Serve with toppings.'])
    ) as seed(
      recipe_uuid, name, category, servings, favorite, tags,
      ingredients, instructions
    );
  exception when others then
    raise warning 'Could not insert defaults for user %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

alter function private.recipe_ingredient_sections_are_valid(jsonb) owner to postgres;
alter function private.recipe_instruction_sections_are_valid(jsonb) owner to postgres;
alter function private.recipe_ingredient_sections_from_legacy(jsonb) owner to postgres;
alter function private.recipe_instruction_sections_from_flat(text[]) owner to postgres;
alter function private.recipe_instruction_sections_from_groups(jsonb) owner to postgres;
alter function private.recipe_instruction_sections_flatten(jsonb) owner to postgres;
alter function private.recipe_notes_from_legacy(jsonb, text[]) owner to postgres;
alter function private.recipe_share_snapshot_is_valid(jsonb) owner to postgres;
alter function public.accept_recipe_share(uuid) owner to postgres;
alter function public.handle_new_user() owner to postgres;

revoke all privileges on function
  private.recipe_ingredient_sections_are_valid(jsonb),
  private.recipe_instruction_sections_are_valid(jsonb),
  private.recipe_ingredient_sections_from_legacy(jsonb),
  private.recipe_instruction_sections_from_flat(text[]),
  private.recipe_instruction_sections_from_groups(jsonb),
  private.recipe_instruction_sections_flatten(jsonb),
  private.recipe_notes_from_legacy(jsonb, text[]),
  private.recipe_share_snapshot_is_valid(jsonb)
from public, anon, authenticated, service_role;
revoke all privileges on function public.accept_recipe_share(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  private.recipe_ingredient_sections_are_valid(jsonb),
  private.recipe_instruction_sections_are_valid(jsonb)
to authenticated, service_role;
grant execute on function public.accept_recipe_share(uuid) to authenticated;
revoke all privileges on function public.handle_new_user()
  from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1 from public.recipes
    where not private.recipe_ingredient_sections_are_valid(ingredient_sections)
       or not private.recipe_instruction_sections_are_valid(instruction_sections)
  ) then
    raise exception 'canonical recipe postcondition failed';
  end if;
  if exists (
    select 1 from public.recipe_shares
    where not private.recipe_share_snapshot_is_valid(source_recipe_snapshot)
  ) then
    raise exception 'canonical share postcondition failed';
  end if;
end;
$$;

comment on column public.recipes.ingredients is
  'Stale compatibility residue after canonical section cutover; runtime must not read or write.';
comment on column public.recipes.instructions is
  'Stale compatibility residue after canonical section cutover; runtime must not read or write.';
comment on column public.recipes.instruction_groups is
  'Stale compatibility residue after canonical section cutover; runtime must not read or write.';
comment on column public.recipes.ingredient_sections is
  'Authoritative ordered ingredient sections.';
comment on column public.recipes.instruction_sections is
  'Authoritative ordered instruction sections.';

commit;
