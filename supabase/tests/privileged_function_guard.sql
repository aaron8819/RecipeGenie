begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(8);

select extensions.is(
  (
    select string_agg(
      format(
        '%I.%I(%s)',
        namespace.nspname,
        procedure.proname,
        pg_get_function_identity_arguments(procedure.oid)
      ),
      E'\n'
      order by procedure.proname
    )
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
  ),
  E'public.accept_recipe_share(p_share_id uuid)\npublic.apply_recipe_shopping_contribution_command(p_expected_revision bigint, p_contributions jsonb, p_remove_recipe_ids text[], p_projection jsonb, p_contribution_overrides jsonb, p_idempotency_key text, p_command_type text)\npublic.handle_new_user()',
  'only reviewed SECURITY DEFINER functions exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and not coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  0,
  'every SECURITY DEFINER function has an empty search_path'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  0,
  'PUBLIC cannot execute SECURITY DEFINER functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  0,
  'anon cannot execute SECURITY DEFINER functions'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral unnest(coalesce(procedure.proargnames, '{}'::text[])) as argument(name)
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and argument.name ~* '^p_(user|account)_id$'
  ),
  0,
  'SECURITY DEFINER functions do not accept caller-selected identities'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and procedure.proname <> 'handle_new_user'
      and (
        position('auth.uid()' in lower(pg_get_functiondef(procedure.oid))) = 0
        or position(' is null' in lower(pg_get_functiondef(procedure.oid))) = 0
      )
  ),
  0,
  'user-facing SECURITY DEFINER functions require a non-null auth.uid()'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral unnest(coalesce(procedure.proargnames, '{}'::text[])) as argument(name)
    where namespace.nspname = 'public'
      and argument.name ~* '^p_(user|account)_id$'
  ),
  0,
  'public RPCs do not expose caller-selected identity parameters'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and pg_get_userbyid(procedure.proowner) <> 'postgres'
  ),
  0,
  'reviewed SECURITY DEFINER functions have the expected owner'
);

select * from extensions.finish();

rollback;
