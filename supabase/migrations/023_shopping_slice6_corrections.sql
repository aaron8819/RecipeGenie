-- F1: TRUNCATE is a separate privilege and bypasses DELETE row triggers.
-- No supported recipe operation needs it. This closes SQL-role access; no
-- exposed REST TRUNCATE exploit was demonstrated by the Slice 6 review.
begin;
revoke truncate on public.recipes from public, anon, authenticated, service_role;

-- Include PUBLIC and inheritance in the postcondition. Unexpected inherited
-- authority must be inspected, not silently revoked from an unrelated role.
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
      and has_table_privilege(oid, 'public.recipes', 'TRUNCATE')
  ) then
    raise exception 'application role retains inherited recipes TRUNCATE privilege';
  end if;
end;
$$;
-- F3: PostgREST computed field on the RLS-filtered row, also used by the
-- owner-locked command snapshot. JSONB preserves numeric scale that a browser
-- JSON parse cannot see; eligibility must use the actual persisted bytes.
create function public.shopping_clear_undo_available(p_row public.shopping_list)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(($1).document->'recipeEntries' = '{}'::jsonb and
    octet_length(($1).document::text) <= 4194304 and
    octet_length(jsonb_build_object('recipeEntries', ($1).document->'recipeEntries',
      'manualItems', ($1).document->'manualItems',
      'itemOverrides', ($1).document->'itemOverrides')::text) <= 1048576, false);
$$;
revoke all on function public.shopping_clear_undo_available(public.shopping_list) from public, anon;
grant execute on function public.shopping_clear_undo_available(public.shopping_list) to authenticated, service_role;

create or replace function public.shopping_command_context(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ticket jsonb;
begin
  perform private.lock_shopping_owner(p_owner);
  v_ticket := private.shopping_ticket(p_owner, p_sequence, p_operation, p_hash);
  if v_ticket->>'status' <> 'Pending' then return v_ticket; end if;
  return v_ticket || jsonb_build_object(
    'row', (select to_jsonb(s) || jsonb_build_object('shopping_clear_undo_available', public.shopping_clear_undo_available(s)) from public.shopping_list s where user_id = p_owner),
    'dependencyRevision', (select dependency_revision::text from private.shopping_protocol where user_id = p_owner),
    'pantry', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.pantry_items p where user_id = p_owner),
    'recipes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.recipes r where user_id = p_owner),
    'inverse', (select case when clear_expires_at > clock_timestamp() then clear_inverse end
      from private.shopping_protocol where user_id = p_owner),
    'inverseRevision', (select clear_revision from private.shopping_protocol where user_id = p_owner)
  );
end;
$$;


-- Keep stored inverse and receipt eligibility identical to the read/plan boundary.

create or replace function public.shopping_commit(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text,
  p_revision bigint, p_dependency bigint, p_document jsonb, p_outcome text,
  p_action text, p_pantry_item text default null, p_recipe uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ticket jsonb; v_row public.shopping_list%rowtype; v_receipt jsonb;
  v_inverse jsonb; v_pantry public.pantry_items%rowtype; v_added boolean := false; v_undo_available boolean := false;
  v_previous_claims text := current_setting('request.jwt.claim.sub', true);
begin
  perform private.lock_shopping_owner(p_owner);
  v_ticket := private.shopping_ticket(p_owner, p_sequence, p_operation, p_hash);
  if v_ticket->>'status' <> 'Pending' then return v_ticket; end if;
  select * into v_row from public.shopping_list where user_id = p_owner for update;
  if v_row.content_revision is distinct from p_revision or p_dependency is distinct from
    (select dependency_revision from private.shopping_protocol where user_id = p_owner) then
    return jsonb_build_object('status', 'Replan');
  end if;
  if p_outcome is null or p_outcome not in
    ('Applied','Unchanged','Conflict','TargetGone','InvalidInput','UnsupportedDocument','UndoUnavailable')
    or p_action is null or p_action not in ('mutation','complete','restoreContent','pantry','deleteRecipe') then
    raise exception 'invalid commit result' using errcode = '23514';
  end if;
  if p_outcome = 'Applied' then
    if not private.is_shopping_command_document(p_document, 3)
      or octet_length(p_document::text) > 4194304 then
      raise exception 'invalid Shopping document' using errcode = '23514';
    end if;
    if v_row.user_id is not null and not (
      private.is_shopping_command_document(v_row.document, 2) or private.is_shopping_command_document(v_row.document, 3)
    ) then raise exception 'unsupported Shopping document' using errcode = '23514'; end if;
    if p_action = 'complete' then
      v_undo_available := public.shopping_clear_undo_available(v_row);
      v_inverse := jsonb_build_object('recipeEntries', v_row.document->'recipeEntries',
        'manualItems', v_row.document->'manualItems', 'itemOverrides', v_row.document->'itemOverrides');
      update private.shopping_protocol set
        clear_inverse = case when v_undo_available then v_inverse end,
        clear_revision = coalesce(p_revision, 0) + 1,
        clear_expires_at = clock_timestamp() + interval '10 minutes' where user_id = p_owner;
    elsif p_action = 'restoreContent' then
      select clear_inverse into v_inverse from private.shopping_protocol where user_id = p_owner
        and clear_revision = p_revision and clear_expires_at > clock_timestamp();
      if v_inverse is null or v_inverse->'recipeEntries' <> '{}' then
        raise exception 'clear inverse unavailable' using errcode = '40001';
      end if;
      if p_document->'manualItems' <> v_inverse->'manualItems'
        or p_document->'itemOverrides' <> v_inverse->'itemOverrides'
        or p_document->'recipeEntries' <> '{}' then
        raise exception 'invalid clear inverse' using errcode = '23514';
      end if;
      update private.shopping_protocol set clear_inverse = null where user_id = p_owner;
    end if;
    if p_action = 'pantry' then
      if p_pantry_item is null or length(trim(p_pantry_item)) not between 1 and 512 then
        raise exception 'invalid pantry target' using errcode = '23514';
      end if;
      insert into public.pantry_items(user_id, item) values(p_owner, lower(trim(p_pantry_item)))
        on conflict (user_id, item) do nothing returning * into v_pantry;
      v_added := found;
      if not v_added then select * into v_pantry from public.pantry_items
        where user_id = p_owner and item = lower(trim(p_pantry_item)); end if;
    end if;
    if p_action = 'deleteRecipe' then
      -- auth.uid is established only inside this non-client-callable function.
      perform set_config('request.jwt.claim.sub', p_owner::text, true);
      perform private.shopping_delete_recipe_internal(p_recipe);
      perform set_config('request.jwt.claim.sub', coalesce(v_previous_claims, ''), true);
      select * into v_row from public.shopping_list where user_id = p_owner;
    else
      insert into public.shopping_list(user_id, document, content_revision)
        values(p_owner, p_document, coalesce(p_revision, 0) + 1)
        on conflict (user_id) do update set document = excluded.document,
          content_revision = excluded.content_revision returning * into v_row;
    end if;
  end if;
  v_receipt := jsonb_build_object('outcome', p_outcome, 'revision', coalesce(v_row.content_revision, 0),
    'pantryId', v_pantry.id, 'pantryWasAdded', v_added,
    'undoAvailable', p_action = 'complete' and v_undo_available);
  update private.shopping_admissions set receipt = v_receipt
    where user_id = p_owner and sequence = p_sequence;
  return jsonb_build_object('status', p_outcome, 'receipt', v_receipt,
    'row', case when v_row.user_id is not null then to_jsonb(v_row) end);
end;
$$;


commit;
