begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);
select extensions.ok(not has_function_privilege('anon', 'public.replace_planned_recipe(date,uuid,uuid,integer,integer,uuid[],uuid[],jsonb,text)', 'execute'), 'anonymous swap denied');
select extensions.ok(not (select prosecdef from pg_proc where oid = 'public.replace_planned_recipe(date,uuid,uuid,integer,integer,uuid[],uuid[],jsonb,text)'::regprocedure), 'swap uses caller RLS');
insert into auth.users(id,email) values ('91000000-0000-4000-8000-000000000001','swap-guard@example.test'),('92000000-0000-4000-8000-000000000002','swap-other@example.test');
insert into public.recipes(id,recipe_uuid,user_id,name,category,servings,ingredient_sections,instruction_sections) values
('old','91111111-1111-4111-8111-111111111111','91000000-0000-4000-8000-000000000001','Old','Dinner',4,'[{"label":null,"ingredients":[{"item":"milk","amount":1,"unit":"cup"}]}]','[{"label":null,"steps":["Cook"]}]'),
('new','91222222-2222-4222-8222-222222222222','91000000-0000-4000-8000-000000000001','New','Dinner',4,'[{"label":null,"ingredients":[{"item":"milk","amount":1,"unit":"cup"}]}]','[{"label":null,"steps":["Cook"]}]'),
('foreign','92222222-2222-4222-8222-222222222222','92000000-0000-4000-8000-000000000002','Foreign','Dinner',4,'[{"label":null,"ingredients":[{"item":"milk","amount":1,"unit":"cup"}]}]','[{"label":null,"steps":["Cook"]}]');
insert into public.weekly_plans(user_id,week_date,recipe_uuids,day_assignment_recipe_uuids,scale)
values ('91000000-0000-4000-8000-000000000001','2026-09-28','{91111111-1111-4111-8111-111111111111}','{"91111111-1111-4111-8111-111111111111":1}',1.5);
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
insert into public.recipe_history(user_id,recipe_uuid,date_made) values(auth.uid(),'91111111-1111-4111-8111-111111111111','2026-10-01T12:00:00-05:00');
select extensions.throws_ok($$select public.replace_planned_recipe('2026-09-28','91111111-1111-4111-8111-111111111111','91222222-2222-4222-8222-222222222222',4,1,'{91111111-1111-4111-8111-111111111111}','{}','{"91111111-1111-4111-8111-111111111111":1}','America/Chicago')$$,'P0001','A cooked meal cannot be swapped.','history-only cooking rejects stale swap');
select extensions.is((select recipe_uuids::text from public.weekly_plans where user_id=auth.uid()),'{91111111-1111-4111-8111-111111111111}','rejected swap preserves membership');
select extensions.is((select scale from public.weekly_plans where user_id=auth.uid()),1.5::numeric,'rejected swap preserves scale');
select extensions.is((select count(*)::integer from public.recipe_history where user_id=auth.uid()),1,'rejected swap preserves history');
delete from public.recipe_history where user_id=auth.uid();
select extensions.throws_ok($$select public.replace_planned_recipe('2026-09-28','91111111-1111-4111-8111-111111111111','92222222-2222-4222-8222-222222222222',4,1,'{91111111-1111-4111-8111-111111111111}','{}','{"91111111-1111-4111-8111-111111111111":1}','America/Chicago')$$,'42501','Replacement recipe not found.','foreign replacement denied');
select extensions.throws_ok($$select public.replace_planned_recipe('2026-09-28','91111111-1111-4111-8111-111111111111','91222222-2222-4222-8222-222222222222',4,2,'{91111111-1111-4111-8111-111111111111}','{}','{"91111111-1111-4111-8111-111111111111":1}','America/Chicago')$$,'P0001','The plan changed while saving. Close and reopen Swap meal to review it.','stale assignment rejected');
select extensions.lives_ok($$select public.replace_planned_recipe('2026-09-28','91111111-1111-4111-8111-111111111111','91222222-2222-4222-8222-222222222222',4,1,'{91111111-1111-4111-8111-111111111111}','{}','{"91111111-1111-4111-8111-111111111111":1}','America/Chicago')$$,'uncooked swap succeeds');
select extensions.is((select day_assignment_recipe_uuids->>'91222222-2222-4222-8222-222222222222' from public.weekly_plans where user_id=auth.uid()),'4','chosen day saved');
select * from extensions.finish();
rollback;
