-- Count-only Stage 2C verification. Emits no identities or application content.

select jsonb_build_object(
  'compatibility_alias_lookups', coalesce((
    select sum(lookup_count) from private.recipe_identity_compat_usage
  ), 0),
  'weekly_membership_mismatches', (
    select count(*) from public.weekly_plans as plan
    where plan.recipe_ids <> private.resolve_owned_recipe_legacy_array(
      plan.user_id, plan.recipe_uuids
    )
  ),
  'weekly_assignment_mismatches', (
    select count(*) from public.weekly_plans as plan
    where coalesce(plan.day_assignments, '{}'::jsonb) <>
      private.resolve_owned_recipe_legacy_assignments(
        plan.user_id, plan.day_assignment_recipe_uuids
      )
  ),
  'weekly_made_state_mismatches', (
    select count(*) from public.weekly_plans as plan
    where plan.made_recipe_ids <> private.resolve_owned_recipe_legacy_array(
      plan.user_id, plan.made_recipe_uuids
    )
  ),
  'template_membership_mismatches', (
    select count(*) from public.plan_templates as template
    where template.recipe_ids <> private.resolve_owned_recipe_legacy_array(
      template.user_id, template.recipe_uuids
    )
  ),
  'template_assignment_mismatches', (
    select count(*) from public.plan_templates as template
    where coalesce(template.day_assignments, '{}'::jsonb) <>
      private.resolve_owned_recipe_legacy_assignments(
        template.user_id, template.day_assignment_recipe_uuids
      )
  ),
  'history_live_link_mismatches', (
    select count(*) from public.recipe_history as history
    join public.recipes as recipe
      on recipe.recipe_uuid = history.recipe_uuid
     and recipe.user_id = history.user_id
    where history.recipe_id <> recipe.id
  ),
  'pending_share_unresolved', (
    select count(*) from public.recipe_shares
    where status = 'pending' and source_recipe_uuid is null
  ),
  'shopping_source_mismatches', (
    select count(*) from public.shopping_list as shopping
    where shopping.source_recipes <> private.resolve_owned_recipe_legacy_array(
      shopping.user_id, shopping.source_recipe_uuids
    )
  ),
  'contribution_identity_mismatches', (
    select count(*) from public.shopping_recipe_contributions as contribution
    join public.recipes as recipe
      on recipe.recipe_uuid = contribution.recipe_uuid
     and recipe.user_id = contribution.user_id
    where contribution.recipe_id <> recipe.id
  ),
  'legacy_made_overloads', (
    select count(*) where to_regprocedure(
      'public.toggle_weekly_recipe_made(text,text,boolean,timestamp with time zone)'
    ) is not null
  ),
  'legacy_shopping_command_grants', (
    select count(*) where has_function_privilege(
      'authenticated',
      'public.apply_recipe_shopping_contribution_command(bigint,jsonb,text[],jsonb,jsonb,text,text)',
      'EXECUTE'
    )
  ),
  'authenticated_recipe_table_delete_grants', (
    select count(*) where has_table_privilege(
      'authenticated', 'public.recipes', 'DELETE'
    )
  ),
  'historical_unresolved_history', (
    select count(*) from public.recipe_history
    where recipe_uuid is null and nullif(recipe_id, '') is not null
  ),
  'historical_unresolved_share_sources', (
    select count(*) from public.recipe_shares
    where status <> 'pending' and source_recipe_uuid is null
  )
) as stage2c_uuid_active_write_audit;
