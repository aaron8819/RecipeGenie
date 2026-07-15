-- Make recipe-derived shopping quantities reversible without replacing the
-- existing shopping_list JSON contract used by the UI and manual-item RPCs.

create table public.shopping_recipe_contributions (
  user_id uuid not null references auth.users(id) on delete cascade,
  recipe_id text not null references public.recipes(id) on delete restrict,
  servings integer not null check (servings > 0),
  scale numeric not null check (scale > 0),
  normalization_version integer not null check (normalization_version > 0),
  snapshot jsonb not null check (
    case
      when jsonb_typeof(snapshot) = 'object'
       and jsonb_typeof(snapshot -> 'items') = 'array'
      then jsonb_array_length(snapshot -> 'items') <= 5000
      else false
    end
  ),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create index shopping_recipe_contributions_user_id_idx
  on public.shopping_recipe_contributions(user_id);

alter table public.shopping_recipe_contributions enable row level security;

create policy users_read_own_shopping_recipe_contributions
  on public.shopping_recipe_contributions
  for select
  using (auth.uid() = user_id);

revoke all privileges on table public.shopping_recipe_contributions
  from public, anon, authenticated;
grant select on table public.shopping_recipe_contributions to authenticated;
grant all privileges on table public.shopping_recipe_contributions to service_role;

alter table public.shopping_list
  add column contribution_revision bigint not null default 0,
  add column contribution_overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(contribution_overrides) = 'object'),
  add column legacy_items_preserved boolean not null default true;

create or replace function public.bump_shopping_contribution_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.contribution_revision = old.contribution_revision then
    new.contribution_revision := old.contribution_revision + 1;
  end if;
  return new;
end;
$$;

alter function public.bump_shopping_contribution_revision() owner to postgres;
revoke all privileges on function public.bump_shopping_contribution_revision()
  from public, anon, authenticated, service_role;

create trigger bump_shopping_contribution_revision_on_update
before update on public.shopping_list
for each row execute function public.bump_shopping_contribution_revision();

create table public.shopping_contribution_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  command_type text not null check (command_type in ('add_or_replace', 'remove')),
  command_fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

alter table public.shopping_contribution_commands enable row level security;
revoke all privileges on table public.shopping_contribution_commands
  from public, anon, authenticated;
grant all privileges on table public.shopping_contribution_commands to service_role;

create or replace function public.apply_recipe_shopping_contribution_command(
  p_expected_revision bigint,
  p_contributions jsonb,
  p_remove_recipe_ids text[],
  p_projection jsonb,
  p_contribution_overrides jsonb,
  p_idempotency_key text,
  p_command_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_list public.shopping_list%rowtype;
  v_contribution jsonb;
  v_recipe_id text;
  v_result jsonb;
  v_existing_command_type text;
  v_existing_command_fingerprint text;
  v_command_fingerprint text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_command_type not in ('add_or_replace', 'remove') then
    raise exception 'invalid shopping contribution command type' using errcode = '22023';
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
     or length(p_idempotency_key) > 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_contributions, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_contributions, '[]'::jsonb)) > 100 then
    raise exception 'invalid contribution payload' using errcode = '22023';
  end if;

  if jsonb_typeof(p_projection) is distinct from 'object'
     or jsonb_typeof(p_projection -> 'items') is distinct from 'array'
     or jsonb_typeof(p_projection -> 'already_have') is distinct from 'array'
     or jsonb_typeof(p_projection -> 'excluded') is distinct from 'array'
     or jsonb_typeof(p_projection -> 'source_recipes') is distinct from 'array'
     or jsonb_typeof(p_contribution_overrides) is distinct from 'object' then
    raise exception 'invalid shopping projection' using errcode = '22023';
  end if;

  if jsonb_array_length(p_projection -> 'items') > 10000
     or jsonb_array_length(p_projection -> 'already_have') > 10000
     or jsonb_array_length(p_projection -> 'excluded') > 10000
     or jsonb_array_length(p_projection -> 'source_recipes') > 100 then
    raise exception 'shopping projection is too large' using errcode = '22023';
  end if;

  if (
    select count(distinct value ->> 'recipe_id')
    from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb))
  ) <> jsonb_array_length(coalesce(p_contributions, '[]'::jsonb)) then
    raise exception 'duplicate recipe contribution identity' using errcode = '22023';
  end if;

  select md5(
    p_command_type || '|' ||
    coalesce(array_to_string(p_remove_recipe_ids, ','), '') || '|' ||
    coalesce(
      (
        select string_agg(
          (value ->> 'recipe_id') || ':' || (value ->> 'scale'),
          ',' order by value ->> 'recipe_id'
        )
        from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb))
      ),
      ''
    )
  ) into v_command_fingerprint;

  insert into public.shopping_list (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select *
  into v_list
  from public.shopping_list
  where user_id = v_user_id
  for update;

  select command_type, command_fingerprint
  into v_existing_command_type, v_existing_command_fingerprint
    from public.shopping_contribution_commands
    where user_id = v_user_id
      and idempotency_key = p_idempotency_key;

  if v_existing_command_type is not null then
    if v_existing_command_type <> p_command_type
       or v_existing_command_fingerprint <> v_command_fingerprint then
      raise exception 'idempotency key already used for another request'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'outcome', 'deduplicated',
      'shopping_list', to_jsonb(v_list)
    );
  end if;

  if v_list.contribution_revision <> p_expected_revision then
    raise exception 'shopping contribution revision conflict'
      using errcode = '40001';
  end if;

  for v_contribution in
    select value from jsonb_array_elements(coalesce(p_contributions, '[]'::jsonb))
  loop
    v_recipe_id := nullif(v_contribution ->> 'recipe_id', '');

    if v_recipe_id is null
       or not exists (
         select 1
         from public.recipes
         where id = v_recipe_id
           and user_id = v_user_id
       ) then
      raise exception 'recipe is not owned by authenticated user' using errcode = '42501';
    end if;

    if jsonb_typeof(v_contribution -> 'snapshot') is distinct from 'object'
       or jsonb_typeof(v_contribution -> 'snapshot' -> 'items') is distinct from 'array' then
      raise exception 'invalid recipe contribution' using errcode = '22023';
    end if;

    if jsonb_array_length(v_contribution -> 'snapshot' -> 'items') > 5000
       or coalesce((v_contribution ->> 'servings')::integer, 0) <= 0
       or coalesce((v_contribution ->> 'scale')::numeric, 0) <= 0
       or coalesce((v_contribution ->> 'normalization_version')::integer, 0) <= 0 then
      raise exception 'invalid recipe contribution' using errcode = '22023';
    end if;

    insert into public.shopping_recipe_contributions (
      user_id,
      recipe_id,
      servings,
      scale,
      normalization_version,
      snapshot,
      idempotency_key
    )
    values (
      v_user_id,
      v_recipe_id,
      (v_contribution ->> 'servings')::integer,
      (v_contribution ->> 'scale')::numeric,
      (v_contribution ->> 'normalization_version')::integer,
      v_contribution -> 'snapshot',
      p_idempotency_key
    )
    on conflict (user_id, recipe_id) do update
    set servings = excluded.servings,
        scale = excluded.scale,
        normalization_version = excluded.normalization_version,
        snapshot = excluded.snapshot,
        idempotency_key = excluded.idempotency_key,
        updated_at = now();
  end loop;

  if coalesce(array_length(p_remove_recipe_ids, 1), 0) > 0 then
    foreach v_recipe_id in array p_remove_recipe_ids
    loop
      if exists (
        select 1 from public.recipes
        where id = v_recipe_id and user_id <> v_user_id
      ) then
        raise exception 'recipe is not owned by authenticated user' using errcode = '42501';
      end if;
    end loop;

    delete from public.shopping_recipe_contributions
    where user_id = v_user_id
      and recipe_id = any(p_remove_recipe_ids);
  end if;

  update public.shopping_list as sl
  set items = coalesce(p_projection -> 'items', '[]'::jsonb),
      already_have = coalesce(p_projection -> 'already_have', '[]'::jsonb),
      excluded = coalesce(p_projection -> 'excluded', '[]'::jsonb),
      source_recipes = coalesce(
        array(select jsonb_array_elements_text(coalesce(p_projection -> 'source_recipes', '[]'::jsonb))),
        '{}'::text[]
      ),
      scale = coalesce((p_projection ->> 'scale')::numeric, 1),
      total_servings = coalesce((p_projection ->> 'total_servings')::integer, 0),
      custom_order = coalesce((p_projection ->> 'custom_order')::boolean, false),
      contribution_overrides = p_contribution_overrides,
      contribution_revision = sl.contribution_revision + 1,
      legacy_items_preserved = true,
      generated_at = now()
  where user_id = v_user_id
  returning to_jsonb(sl) into v_result;

  insert into public.shopping_contribution_commands (
    user_id,
    idempotency_key,
    command_type,
    command_fingerprint
  ) values (
    v_user_id,
    p_idempotency_key,
    p_command_type,
    v_command_fingerprint
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'shopping_list', v_result
  );
end;
$$;

alter function public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
) owner to postgres;

revoke all privileges on function public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
) to authenticated;

comment on table public.shopping_recipe_contributions is
  'Authoritative frozen recipe-derived shopping contributions. shopping_list is a compatibility projection.';
comment on column public.shopping_list.contribution_overrides is
  'Manual quantity, presentation, ordering, and lifecycle overrides applied to the derived recipe projection.';
comment on column public.shopping_list.legacy_items_preserved is
  'True when pre-contribution shopping JSON was conservatively retained as legacy/manual state.';

create or replace function public.get_recipe_shopping_contribution_state()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'shopping_list', to_jsonb(sl),
    'contributions', coalesce(
      (
        select jsonb_agg(to_jsonb(contribution) order by contribution.recipe_id)
        from public.shopping_recipe_contributions contribution
        where contribution.user_id = auth.uid()
      ),
      '[]'::jsonb
    )
  )
  from public.shopping_list sl
  where sl.user_id = auth.uid();
$$;

alter function public.get_recipe_shopping_contribution_state() owner to postgres;
revoke all privileges on function public.get_recipe_shopping_contribution_state()
  from public, anon, authenticated, service_role;
grant execute on function public.get_recipe_shopping_contribution_state()
  to authenticated;
