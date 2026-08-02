begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

select extensions.has_column(
  'public', 'user_config', 'exclude_salt_variants',
  'user_config has the Salt variants setting'
);
select extensions.col_not_null(
  'public', 'user_config', 'exclude_salt_variants',
  'Salt variants setting is non-null'
);
select extensions.col_default_is(
  'public', 'user_config', 'exclude_salt_variants', 'false',
  'Salt variants setting defaults to false'
);
select extensions.has_column(
  'public', 'user_config', 'exclude_black_pepper_variants',
  'user_config has the Black pepper variants setting'
);
select extensions.col_not_null(
  'public', 'user_config', 'exclude_black_pepper_variants',
  'Black pepper variants setting is non-null'
);
select extensions.col_default_is(
  'public', 'user_config', 'exclude_black_pepper_variants', 'false',
  'Black pepper variants setting defaults to false'
);

select * from extensions.finish();
rollback;
