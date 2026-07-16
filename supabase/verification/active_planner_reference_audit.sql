-- Count-only Stage 2 gate. This query never returns planner identifiers or contents.
with unresolved as (
  select 'recipe_ids'::text as field_name
  from public.weekly_plans as wp
  cross join lateral unnest(wp.recipe_ids) as recipe_id
  where not exists (
    select 1
    from public.recipes as r
    where r.user_id = wp.user_id and r.id = recipe_id
  )
  union all
  select 'assignment_keys'
  from public.weekly_plans as wp
  cross join lateral jsonb_object_keys(coalesce(wp.day_assignments, '{}'::jsonb)) as assignment_key
  where not exists (
    select 1
    from public.recipes as r
    where r.user_id = wp.user_id and r.id = assignment_key
  )
  union all
  select 'made_recipe_ids'
  from public.weekly_plans as wp
  cross join lateral unnest(coalesce(wp.made_recipe_ids, '{}'::text[])) as recipe_id
  where not exists (
    select 1
    from public.recipes as r
    where r.user_id = wp.user_id and r.id = recipe_id
  )
)
select
  count(*) filter (where field_name = 'recipe_ids') as unresolved_recipe_ids_memberships,
  count(*) filter (where field_name = 'assignment_keys') as unresolved_assignment_keys,
  count(*) filter (where field_name = 'made_recipe_ids') as unresolved_made_recipe_ids
from unresolved;
