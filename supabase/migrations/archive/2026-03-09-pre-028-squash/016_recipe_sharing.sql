-- Recipe sharing (copy-on-accept) between existing users

create table if not exists public.recipe_shares (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_email text not null,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  source_recipe_id text not null,
  source_recipe_snapshot jsonb not null,
  message text null,
  status text not null default 'pending',
  accepted_recipe_id text null,
  created_at timestamptz not null default now(),
  responded_at timestamptz null,
  constraint recipe_shares_status_check
    check (status in ('pending', 'accepted', 'declined', 'canceled')),
  constraint recipe_shares_no_self_share_check
    check (sender_user_id <> recipient_user_id),
  constraint recipe_shares_message_length_check
    check (message is null or char_length(message) <= 300)
);

create index if not exists idx_recipe_shares_recipient_status_created
  on public.recipe_shares (recipient_user_id, status, created_at desc);

create index if not exists idx_recipe_shares_sender_created
  on public.recipe_shares (sender_user_id, created_at desc);

create unique index if not exists idx_recipe_shares_pending_dedupe
  on public.recipe_shares (sender_user_id, recipient_user_id, source_recipe_id)
  where status = 'pending';

alter table public.recipe_shares enable row level security;

drop policy if exists users_own_recipe_shares_select on public.recipe_shares;
create policy users_own_recipe_shares_select
  on public.recipe_shares for select
  using (
    auth.uid() = sender_user_id
    or auth.uid() = recipient_user_id
  );

drop policy if exists users_create_recipe_shares on public.recipe_shares;
create policy users_create_recipe_shares
  on public.recipe_shares for insert
  with check (auth.uid() = sender_user_id);

drop policy if exists recipients_respond_recipe_shares on public.recipe_shares;
create policy recipients_respond_recipe_shares
  on public.recipe_shares for update
  using (
    auth.uid() = recipient_user_id
    and status = 'pending'
  )
  with check (
    auth.uid() = recipient_user_id
    and status in ('accepted', 'declined')
    and responded_at is not null
  );

drop policy if exists senders_cancel_recipe_shares on public.recipe_shares;
create policy senders_cancel_recipe_shares
  on public.recipe_shares for update
  using (
    auth.uid() = sender_user_id
    and status = 'pending'
  )
  with check (
    auth.uid() = sender_user_id
    and status = 'canceled'
    and responded_at is not null
  );

-- Accept a pending share by copying the recipe snapshot into the recipient's
-- own recipe library. Function is idempotent: repeat calls return the same
-- accepted_recipe_id once accepted.
create or replace function public.accept_recipe_share(p_share_id uuid)
returns text
language plpgsql
security definer
set search_path = public
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
    image_url
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
    v_image_url
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

grant execute on function public.accept_recipe_share(uuid) to authenticated;
