alter table public.user_config
  add column if not exists shopping_item_order jsonb not null default '{}'::jsonb;
