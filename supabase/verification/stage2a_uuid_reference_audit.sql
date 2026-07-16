-- Count-only Stage 2A verification. This query emits no recipe, user, planner,
-- shopping, or share content and is safe for linked production verification.

select jsonb_build_object(
  'weekly_membership_mismatches', (
    select count(*)
    from public.weekly_plans as plan
    where plan.recipe_uuids <> private.resolve_owned_recipe_uuid_array(plan.user_id, plan.recipe_ids)
  ),
  'weekly_assignment_mismatches', (
    select count(*)
    from public.weekly_plans as plan
    where plan.day_assignment_recipe_uuids <>
      private.resolve_owned_recipe_assignment_keys(plan.user_id, plan.day_assignments)
  ),
  'weekly_made_state_mismatches', (
    select count(*)
    from public.weekly_plans as plan
    where plan.made_recipe_uuids <>
      private.resolve_owned_recipe_uuid_array(plan.user_id, plan.made_recipe_ids)
  ),
  'template_membership_mismatches', (
    select count(*)
    from public.plan_templates as template
    where template.recipe_uuids <>
      private.resolve_owned_recipe_uuid_array(template.user_id, template.recipe_ids)
  ),
  'template_assignment_mismatches', (
    select count(*)
    from public.plan_templates as template
    where template.day_assignment_recipe_uuids <>
      private.resolve_owned_recipe_assignment_keys(template.user_id, template.day_assignments)
  ),
  'history_resolvable_mismatches', (
    select count(*)
    from public.recipe_history as history
    join public.recipes as recipe
      on recipe.id = history.recipe_id
     and recipe.user_id = history.user_id
    where history.recipe_uuid is distinct from recipe.recipe_uuid
  ),
  'share_source_resolvable_mismatches', (
    select count(*)
    from public.recipe_shares as share
    join public.recipes as recipe
      on recipe.id = share.source_recipe_id
     and recipe.user_id = share.sender_user_id
    where share.source_recipe_uuid is distinct from recipe.recipe_uuid
  ),
  'share_accepted_resolvable_mismatches', (
    select count(*)
    from public.recipe_shares as share
    join public.recipes as recipe
      on recipe.id = share.accepted_recipe_id
     and recipe.user_id = share.recipient_user_id
    where share.accepted_recipe_uuid is distinct from recipe.recipe_uuid
  ),
  'shopping_source_mismatches', (
    select count(*)
    from public.shopping_list as shopping
    where shopping.source_recipe_uuids <>
      private.resolve_owned_recipe_uuid_array(shopping.user_id, shopping.source_recipes)
  ),
  'contribution_identity_mismatches', (
    select count(*)
    from public.shopping_recipe_contributions as contribution
    join public.recipes as recipe
      on recipe.id = contribution.recipe_id
     and recipe.user_id = contribution.user_id
    where contribution.recipe_uuid is distinct from recipe.recipe_uuid
  ),
  'pending_share_unresolved', (
    select count(*)
    from public.recipe_shares
    where status = 'pending'
      and source_recipe_uuid is null
  )
) as stage2a_uuid_reference_audit;
