begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(33);

select extensions.ok(
  to_regprocedure('public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)') is not null,
  'canonical UUID/date made-state overload exists'
);
select extensions.ok(
  to_regprocedure('public.toggle_weekly_recipe_made(uuid,text,boolean,timestamp with time zone)') is null,
  'defective UUID/text overload is absent'
);
select extensions.ok(
  to_regprocedure('public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)') is null,
  'legacy made-state overload is absent'
);
select extensions.is(
  pg_get_function_result(
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)'::regprocedure
  ),
  'TABLE(action text, recipe_uuid uuid, week_date date, made_recipe_uuids uuid[], history_date_made timestamp with time zone)',
  'canonical result preserves a date-typed week contract'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)',
    'EXECUTE'
  ),
  'authenticated may execute canonical made-state command'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)',
    'EXECUTE'
  ),
  'anonymous cannot execute canonical made-state command'
);
select extensions.ok(
  not has_function_privilege(
    'service_role',
    'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role has no direct canonical made-state grant'
);
insert into auth.users(id, email) values
  ('81000000-0000-4000-8000-000000000001', 'made-state-a@example.test'),
  ('82000000-0000-4000-8000-000000000002', 'made-state-b@example.test');

insert into public.recipes(
  id, recipe_uuid, user_id, name, category, servings,
  ingredient_sections, instruction_sections
) values
  ('made-a-target', '81111111-1111-4111-8111-111111111111',
    '81000000-0000-4000-8000-000000000001', 'Target', 'test', 1, '[]', '[]'),
  ('made-a-unrelated', '81222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000001', 'Unrelated', 'test', 1, '[]', '[]'),
  ('made-b-target', '82333333-3333-4333-8333-333333333333',
    '82000000-0000-4000-8000-000000000002', 'Other owner', 'test', 1, '[]', '[]');

insert into public.weekly_plans(
  user_id, week_date, recipe_uuids, day_assignment_recipe_uuids, made_recipe_uuids
) values
  (
    '81000000-0000-4000-8000-000000000001', date '2026-07-20',
    array['81111111-1111-4111-8111-111111111111'::uuid, '81222222-2222-4222-8222-222222222222'::uuid],
    '{"81111111-1111-4111-8111-111111111111":2,"81222222-2222-4222-8222-222222222222":4}',
    array['81222222-2222-4222-8222-222222222222'::uuid]
  ),
  ('81000000-0000-4000-8000-000000000001', date '2026-08-01',
    array['81111111-1111-4111-8111-111111111111'::uuid], '{}', '{}'),
  ('81000000-0000-4000-8000-000000000001', date '2026-12-31',
    array['81111111-1111-4111-8111-111111111111'::uuid], '{}', '{}'),
  ('81000000-0000-4000-8000-000000000001', date '2027-01-01',
    array['81111111-1111-4111-8111-111111111111'::uuid], '{}', '{}'),
  ('81000000-0000-4000-8000-000000000001', date '2028-02-29',
    array['81111111-1111-4111-8111-111111111111'::uuid], '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);

select extensions.lives_ok($$
  select public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-07-20', true, timestamptz '2026-07-20 12:00:00+00'
  )
$$, 'UUID/date mark-made succeeds');
select extensions.is(
  (select made_recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['81222222-2222-4222-8222-222222222222'::uuid, '81111111-1111-4111-8111-111111111111'::uuid],
  'UUID made-state appends target without disturbing unrelated order'
);
select extensions.is(
  (select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['made-a-unrelated', 'made-a-target'],
  'legacy made-state mirror appends matching compatibility alias'
);
select extensions.is(
  (select count(*)::integer from unnest((select made_recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20')) value where value = '81111111-1111-4111-8111-111111111111'),
  1,
  'UUID made-state contains target exactly once'
);
select extensions.is(
  (select count(*)::integer from unnest((select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20')) value where value = 'made-a-target'),
  1,
  'legacy made-state contains target exactly once'
);
select extensions.ok(
  exists(
    select 1 from public.recipe_history
    where user_id = auth.uid()
      and recipe_uuid = '81111111-1111-4111-8111-111111111111'
      and recipe_id = 'made-a-target'
      and date_made = timestamptz '2026-07-20 12:00:00+00'
  ),
  'history preserves canonical UUID linkage and legacy evidence'
);
select extensions.is(
  (select recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['81111111-1111-4111-8111-111111111111'::uuid, '81222222-2222-4222-8222-222222222222'::uuid],
  'made-state command leaves planner membership unchanged'
);
select extensions.is(
  (select day_assignment_recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  '{"81111111-1111-4111-8111-111111111111":2,"81222222-2222-4222-8222-222222222222":4}'::jsonb,
  'made-state command leaves planner assignments unchanged'
);

select extensions.lives_ok($$
  select public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-07-20', true, timestamptz '2026-07-20 13:00:00+00'
  )
$$, 'repeated UUID/date mark-made succeeds');
select extensions.is(
  (select count(*)::integer from unnest((select made_recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20')) value where value = '81111111-1111-4111-8111-111111111111'),
  1,
  'repeated mark does not duplicate UUID made-state'
);
select extensions.is(
  (select count(*)::integer from unnest((select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20')) value where value = 'made-a-target'),
  1,
  'repeated mark does not duplicate legacy made-state'
);
select extensions.is(
  (select count(*)::integer from public.recipe_history where user_id = auth.uid() and recipe_uuid = '81111111-1111-4111-8111-111111111111'),
  2,
  'repeated mark retains existing event-history behavior'
);

select extensions.lives_ok($$
  select public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-07-20', false, null
  )
$$, 'UUID/date unmark succeeds');
select extensions.is(
  (select made_recipe_uuids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['81222222-2222-4222-8222-222222222222'::uuid],
  'UUID unmark removes only the intended target'
);
select extensions.is(
  (select made_recipe_ids from public.weekly_plans where user_id = auth.uid() and week_date = date '2026-07-20'),
  array['made-a-unrelated'],
  'legacy unmark mirror removes only the intended alias'
);
select extensions.is(
  (select count(*)::integer from public.recipe_history where user_id = auth.uid() and recipe_uuid = '81111111-1111-4111-8111-111111111111'),
  1,
  'unmark removes only the latest matching history event'
);
select extensions.ok(
  exists(
    select 1 from public.recipe_history
    where user_id = auth.uid()
      and recipe_uuid = '81111111-1111-4111-8111-111111111111'
      and recipe_id = 'made-a-target'
  ),
  'remaining history retains UUID and legacy linkage'
);

select extensions.throws_ok($$
  select public.toggle_weekly_recipe_made(
    '82333333-3333-4333-8333-333333333333'::uuid,
    date '2026-07-20', true, null
  )
$$, '23503', 'recipe UUID is unresolved or belongs to another user',
  'cross-owner UUID rejects');
select extensions.throws_ok($$
  select public.toggle_weekly_recipe_made(
    '81999999-9999-4999-8999-999999999999'::uuid,
    date '2026-07-20', true, null
  )
$$, '23503', 'recipe UUID is unresolved or belongs to another user',
  'unresolved UUID rejects');
select extensions.throws_ok($$
  select public.toggle_weekly_recipe_made(
    'not-a-uuid'::uuid, date '2026-07-20', true, null
  )
$$, '22P02', 'invalid input syntax for type uuid: "not-a-uuid"',
  'malformed UUID rejects at the type boundary');

select extensions.is(
  (select week_date from public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-08-01', true, null
  )),
  date '2026-08-01',
  'month-boundary calendar date remains exact'
);
select extensions.is(
  (select week_date from public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-12-31', true, null
  )),
  date '2026-12-31',
  'year-end calendar date remains exact'
);
select extensions.is(
  (select week_date from public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2027-01-01', true, null
  )),
  date '2027-01-01',
  'year-boundary calendar date remains exact'
);
select extensions.is(
  (select week_date from public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2028-02-29', true, null
  )),
  date '2028-02-29',
  'valid leap-day calendar date remains exact'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select extensions.throws_ok($$
  select public.toggle_weekly_recipe_made(
    '81111111-1111-4111-8111-111111111111'::uuid,
    date '2026-07-20', true, null
  )
$$, '42501', 'permission denied for function toggle_weekly_recipe_made',
  'anonymous canonical invocation rejects');
reset role;
select extensions.ok(
  (
    select procedure.prosecdef
      and pg_get_userbyid(procedure.proowner) = 'postgres'
      and coalesce(procedure.proconfig, '{}'::text[]) @> array['search_path=""']
    from pg_proc as procedure
    where procedure.oid = 'public.toggle_weekly_recipe_made(uuid,date,boolean,timestamp with time zone)'::regprocedure
  ),
  'canonical function has reviewed definer owner and search path'
);
select * from extensions.finish();
rollback;
