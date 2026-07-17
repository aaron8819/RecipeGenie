begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(23);

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
  E'public.accept_recipe_share(p_share_id uuid)\npublic.apply_recipe_shopping_contribution_command(p_expected_revision bigint, p_contributions jsonb, p_remove_recipe_ids text[], p_projection jsonb, p_contribution_overrides jsonb, p_idempotency_key text, p_command_type text)\npublic.apply_recipe_shopping_contribution_uuid_command(p_expected_revision bigint, p_contributions jsonb, p_remove_recipe_uuids uuid[], p_projection jsonb, p_contribution_overrides jsonb, p_idempotency_key text, p_command_type text)\npublic.handle_new_user()\npublic.toggle_weekly_recipe_made(p_recipe_uuid uuid, p_week_date text, p_is_made_for_week boolean, p_date_made timestamp with time zone)',
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

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'sync_weekly_plan_recipe_uuids',
        'sync_plan_template_recipe_uuids',
        'sync_recipe_history_uuid',
        'sync_recipe_share_uuids',
        'sync_shopping_list_recipe_uuids',
        'sync_shopping_contribution_recipe_uuid'
      )
  ),
  6,
  'all six Stage 2A UUID synchronization wrappers exist'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and not procedure.prosecdef
  ),
  0,
  'every Stage 2A UUID synchronization wrapper is SECURITY DEFINER'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and pg_get_userbyid(procedure.proowner) <> 'postgres'
  ),
  0,
  'Stage 2A UUID synchronization wrappers are owned by postgres'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and not coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  0,
  'Stage 2A UUID synchronization wrappers have an empty search path'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) as privilege
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  0,
  'PUBLIC cannot execute Stage 2A UUID synchronization wrappers'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as application_role(role_name)
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and has_function_privilege(application_role.role_name, procedure.oid, 'EXECUTE')
  ),
  0,
  'application and service roles cannot execute Stage 2A UUID synchronization wrappers directly'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as application_role(role_name)
    where namespace.nspname = 'private'
      and procedure.proname in (
        'resolve_owned_recipe_uuid_array',
        'resolve_owned_recipe_assignment_keys',
        'enrich_recipe_source_array',
        'enrich_recipe_source_items',
        'enrich_recipe_contribution_snapshot',
        'validate_recipe_source_items',
        'assert_uuid_sync_row_owner'
      )
      and has_function_privilege(application_role.role_name, procedure.oid, 'EXECUTE')
  ),
  0,
  'application and service roles cannot execute Stage 2A private helpers'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and procedure.pronargs <> 0
  ),
  0,
  'Stage 2A trigger wrappers accept no caller-selected identity arguments'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and procedure.prorettype <> 'trigger'::regtype
  ),
  0,
  'Stage 2A wrappers expose only trigger return semantics'
);

select extensions.is(
  (
    select count(*)::integer
    from (
      values
        ('sync_weekly_plan_recipe_uuids', 'weekly_plans'),
        ('sync_plan_template_recipe_uuids', 'plan_templates'),
        ('sync_recipe_history_uuid', 'recipe_history'),
        ('sync_recipe_share_uuids', 'recipe_shares'),
        ('sync_shopping_list_recipe_uuids', 'shopping_list'),
        ('sync_shopping_contribution_recipe_uuid', 'shopping_recipe_contributions')
    ) as expected(function_name, table_name)
    left join pg_proc as procedure on procedure.proname = expected.function_name
    left join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace and namespace.nspname = 'private'
    left join pg_trigger as trigger_row
      on trigger_row.tgfoid = procedure.oid and not trigger_row.tgisinternal
    left join pg_class as relation on relation.oid = trigger_row.tgrelid
    where relation.relname is distinct from expected.table_name
  ),
  0,
  'each Stage 2A wrapper is attached only to its intended table'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_trigger as trigger_row
    join pg_proc as procedure on procedure.oid = trigger_row.tgfoid
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and (trigger_row.tgtype <> 23 or trigger_row.tgnargs <> 0)
  ),
  0,
  'Stage 2A wrappers run only as row-level BEFORE INSERT OR UPDATE triggers without arguments'
);

select extensions.is(
  (
    select count(*)::integer
    from (
      values
        ('sync_weekly_plan_recipe_uuids', array['user_id','recipe_ids','day_assignments','made_recipe_ids','recipe_uuids','day_assignment_recipe_uuids','made_recipe_uuids']::text[]),
        ('sync_plan_template_recipe_uuids', array['user_id','recipe_ids','day_assignments','recipe_uuids','day_assignment_recipe_uuids']::text[]),
        ('sync_recipe_history_uuid', array['user_id','recipe_id','recipe_uuid']::text[]),
        ('sync_recipe_share_uuids', array['sender_user_id','recipient_user_id','source_recipe_id','accepted_recipe_id','status','source_recipe_uuid','accepted_recipe_uuid']::text[]),
        ('sync_shopping_list_recipe_uuids', array['user_id','items','already_have','excluded','source_recipes','source_recipe_uuids']::text[]),
        ('sync_shopping_contribution_recipe_uuid', array['user_id','recipe_id','recipe_uuid','snapshot']::text[])
    ) as expected(trigger_name, columns)
    join pg_trigger as trigger_row on trigger_row.tgname = expected.trigger_name
    join pg_class as relation on relation.oid = trigger_row.tgrelid
    where not array(
      select attribute.attname::text
      from pg_attribute as attribute
      where attribute.attrelid = relation.oid
        and attribute.attnum = any(trigger_row.tgattr)
    ) @> expected.columns
  ),
  0,
  'Stage 2A trigger column filters include legacy and UUID identity fields'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and position('public.recipes' in pg_get_functiondef(procedure.oid)) = 0
      and position('private.' in pg_get_functiondef(procedure.oid)) = 0
  ),
  0,
  'hardened wrappers use schema-qualified recipe tables or private helpers'
);

select extensions.ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'ordinary application roles retain no private schema usage'
);

select extensions.is(
  (
    select count(*)::integer
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname like 'sync_%_uuid%'
      and position('private.assert_uuid_sync_row_owner' in pg_get_functiondef(procedure.oid)) = 0
      and procedure.proname <> 'sync_recipe_share_uuids'
  ),
  0,
  'single-owner wrappers explicitly validate the trigger row owner'
);

select * from extensions.finish();

rollback;
