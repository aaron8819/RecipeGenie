-- Preserve UUID authority when an upsert updates only contribution content.
-- The legacy command helper uses ON CONFLICT DO UPDATE without rewriting the
-- already-canonical identity columns, so an unchanged valid pair must remain
-- acceptable while legacy-only and mismatched identity changes still reject.
create or replace function private.sync_shopping_contribution_recipe_uuid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legacy_changed boolean;
  v_uuid_changed boolean;
  v_expected_legacy text;
  v_internal_uuid_command boolean := coalesce(
    current_setting('recipe_genie.uuid_command', true), ''
  ) = 'on' or (auth.uid() is null and session_user = 'postgres');
begin
  perform private.assert_uuid_sync_row_owner(new.user_id);
  v_legacy_changed := (tg_op = 'INSERT' and nullif(new.recipe_id, '') is not null)
    or (tg_op = 'UPDATE' and new.recipe_id is distinct from old.recipe_id);
  v_uuid_changed := (tg_op = 'INSERT' and new.recipe_uuid is not null)
    or (tg_op = 'UPDATE' and new.recipe_uuid is distinct from old.recipe_uuid);

  if v_uuid_changed then
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe UUID is required' using errcode = '22023';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if v_legacy_changed and new.recipe_id <> v_expected_legacy then
      raise exception 'shopping contribution identities disagree' using errcode = '23503';
    end if;
    new.recipe_id := v_expected_legacy;
  elsif tg_op = 'UPDATE' and not v_legacy_changed then
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe UUID is required' using errcode = '22023';
    end if;
    v_expected_legacy := private.resolve_owned_recipe_legacy_id(new.user_id, new.recipe_uuid);
    if new.recipe_id is distinct from v_expected_legacy then
      raise exception 'shopping contribution identities disagree' using errcode = '23503';
    end if;
  elsif v_internal_uuid_command and v_legacy_changed then
    select recipe.recipe_uuid into new.recipe_uuid
    from public.recipes as recipe
    where recipe.user_id = new.user_id and recipe.id = new.recipe_id;
    if new.recipe_uuid is null then
      raise exception 'shopping contribution recipe is unresolved or belongs to another user'
        using errcode = '23503';
    end if;
  else
    raise exception 'shopping contribution recipe UUID is required' using errcode = '22023';
  end if;

  if jsonb_typeof(new.snapshot) = 'object'
    and jsonb_typeof(new.snapshot -> 'items') = 'array' then
    new.snapshot := jsonb_set(
      new.snapshot, '{items}',
      private.compat_recipe_source_items_from_uuid(new.user_id, new.snapshot -> 'items'), true
    );
    perform private.validate_recipe_source_items(new.user_id, new.snapshot -> 'items');
  end if;
  new.snapshot := private.enrich_recipe_contribution_snapshot(new.user_id, new.snapshot);
  return new;
end;
$$;

alter function private.sync_shopping_contribution_recipe_uuid() owner to postgres;
revoke all privileges on function private.sync_shopping_contribution_recipe_uuid()
  from public, anon, authenticated, service_role;
