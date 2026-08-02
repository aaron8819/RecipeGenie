alter table public.user_config
  add column exclude_salt_variants boolean not null default false,
  add column exclude_black_pepper_variants boolean not null default false;
