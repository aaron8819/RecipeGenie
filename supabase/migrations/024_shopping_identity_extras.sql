begin;

-- Additive format support only. Existing rows/defaults are not converted by
-- migration or read. Conversion is an owner/revision-bound admitted command.
create function public.is_shopping_document_v4(p_document jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_base jsonb; v_entries jsonb := '{}'; v_manuals jsonb := '[]';
  v_entry record; v_item jsonb; v_source jsonb; v_identity jsonb;
  v_evidence jsonb; v_defaults jsonb; v_unresolved jsonb; v_sequence record;
  v_key text; v_seen text[] := '{}'; v_categories text[]; v_pinned jsonb; v_value record;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or p_document->'schemaVersion' is distinct from '4' then return false; end if;
  v_evidence := p_document->'placementEvidence';
  if jsonb_typeof(v_evidence) is distinct from 'object' or v_evidence - array['defaults','unresolved','resolved'] <> '{}' then return false; end if;
  v_defaults := v_evidence->'defaults'; v_unresolved := v_evidence->'unresolved';
  if jsonb_typeof(v_defaults) is distinct from 'object' or jsonb_typeof(v_unresolved) is distinct from 'object' or jsonb_typeof(v_evidence->'resolved') is distinct from 'object' then return false; end if;
  for v_entry in select key, value from jsonb_each(p_document->'recipeEntries') loop
    v_source := v_entry.value->'sourceEvidence';
    if jsonb_typeof(v_source) is distinct from 'object' or
      v_source - array['version','history','sourceRevision','yieldEvidence','originalEntry','occurrences'] <> '{}' or
      jsonb_typeof(v_source->'version') is distinct from 'number' or coalesce(v_source->>'version','') !~ '^(0|[1-9][0-9]*)$' or (v_source->>'version')::numeric > 9007199254740991 or
      coalesce(v_source->>'history','') not in ('captured','reconstructed') or
      jsonb_typeof(v_source->'occurrences') is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_source->'occurrences') <> jsonb_array_length(v_entry.value->'ingredients') then return false; end if;
    if v_source ? 'originalEntry' and jsonb_typeof(v_source->'originalEntry') <> 'object' then return false; end if;
    if v_source->>'history' = 'captured' then
      if jsonb_typeof(v_source->'yieldEvidence') is distinct from 'object' or
        jsonb_typeof(v_source->'yieldEvidence'->'servings') is distinct from 'number' or
        (v_source->'yieldEvidence'->>'servings')::numeric <= 0 or not (v_source->'yieldEvidence' ? 'metadata') then return false; end if;
    elsif v_source->'yieldEvidence' is distinct from 'null' then return false; end if;
    if v_source->>'history' = 'captured' then
      if jsonb_typeof(v_source->'sourceRevision') is distinct from 'string' or length(trim(v_source->>'sourceRevision')) = 0 then return false; end if;
    elsif v_source->'sourceRevision' is distinct from 'null' then return false; end if;
    if exists (select 1 from jsonb_array_elements(v_source->'occurrences') o where
      jsonb_typeof(o) <> 'object' or o - array['id','section','ordinal','raw'] <> '{}' or
      jsonb_typeof(o->'id') is distinct from 'string' or length(trim(o->>'id')) = 0 or not (o ? 'raw') or jsonb_typeof(o->'ordinal') is distinct from 'number' or coalesce(o->>'ordinal','') !~ '^(0|[1-9][0-9]*)$' or
      (o->>'ordinal')::numeric > 9007199254740991 or
      (o->'section' is distinct from 'null' and jsonb_typeof(o->'section') is distinct from 'string')) then return false; end if;
    if (select count(*) <> count(distinct o->>'id') from jsonb_array_elements(v_source->'occurrences') o) then return false; end if;
    v_entries := v_entries || jsonb_build_object(v_entry.key, v_entry.value - 'sourceEvidence');
  end loop;
  for v_item in select value from jsonb_array_elements(p_document->'manualItems') loop
    v_identity := v_item->'identity';
    if jsonb_typeof(v_identity) is distinct from 'object' or
      v_identity - array['purchaseKey','policyVersion','version','meaning','legacy','conversion','removed'] <> '{}' or
      jsonb_typeof(v_identity->'purchaseKey') is distinct from 'string' or length(trim(v_identity->>'purchaseKey')) = 0 or
      jsonb_typeof(v_identity->'policyVersion') is distinct from 'string' or length(trim(v_identity->>'policyVersion')) = 0 or
      jsonb_typeof(v_identity->'version') is distinct from 'number' or coalesce(v_identity->>'version','') !~ '^(0|[1-9][0-9]*)$' or (v_identity->>'version')::numeric > 9007199254740991 or
      coalesce(v_identity->>'meaning','') not in ('extra','reminder','legacyIndependent') or
      (v_identity ? 'removed' and jsonb_typeof(v_identity->'removed') <> 'boolean') then return false; end if;
    if v_identity->>'meaning' = 'legacyIndependent' then
      if not private.is_shopping_legacy_envelope(v_identity->'legacy') then return false; end if;
    elsif v_identity ? 'legacy' then return false; end if;
    if v_identity ? 'conversion' and not private.is_shopping_legacy_envelope(v_identity->'conversion') then return false; end if;
    v_manuals := v_manuals || jsonb_build_array(v_item - 'identity');
  end loop;
  v_base := (p_document - 'placementEvidence') || jsonb_build_object('schemaVersion',3,'recipeEntries',v_entries,'manualItems',v_manuals);
  if not private.is_shopping_command_document(v_base,3) then return false; end if;
  v_categories := array['produce','deli','bakery','protein','dairy','pantry','frozen','misc'];
  select v_categories || coalesce(array_agg('custom_' || (c->>'id')), '{}') into v_categories
    from jsonb_array_elements(p_document->'preferences'->'customCategories') c;
  for v_sequence in select key, value from jsonb_each(p_document->'preferences'->'ingredientOrderByCategory') loop
    if not (v_sequence.key = any(v_categories)) then return false; end if;
    for v_key in select jsonb_array_elements_text(v_sequence.value) loop
      v_pinned := v_defaults->v_key;
      if v_key = any(v_seen) or jsonb_typeof(v_pinned) is distinct from 'object' or
        v_pinned - array['categoryKey','policyVersion'] <> '{}' or
        not coalesce(v_pinned->>'categoryKey' = any(v_categories),false) or
        jsonb_typeof(v_pinned->'policyVersion') is distinct from 'string' or length(trim(v_pinned->>'policyVersion')) = 0 or
        v_sequence.key is distinct from coalesce(p_document->'preferences'->'categoryByIngredient'->>v_key,v_pinned->>'categoryKey') then return false; end if;
      v_seen := array_append(v_seen,v_key);
    end loop;
  end loop;
  if exists (select 1 from jsonb_object_keys(v_defaults) k where not (k = any(v_seen))) then return false; end if;
  if exists (select 1 from jsonb_object_keys(p_document->'preferences'->'categoryByIngredient') k where not (k = any(v_seen))) then return false; end if;
  for v_value in select key,value from jsonb_each((v_evidence->'resolved') || v_unresolved) loop
    if (v_unresolved ? v_value.key and v_value.key = any(v_seen)) or jsonb_typeof(v_value.value) is distinct from 'object' or
      v_value.value - array['categories','sequences'] <> '{}' or
      jsonb_typeof(v_value.value->'categories') is distinct from 'array' or
      jsonb_typeof(v_value.value->'sequences') is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_array_elements(v_value.value->'categories') c where jsonb_typeof(c) <> 'string' or length(trim(c #>> '{}')) = 0) then return false; end if;
    if exists(select 1 from jsonb_each(v_value.value->'sequences') s where jsonb_typeof(s.value) <> 'array') then return false; end if;
    for v_sequence in select key,value from jsonb_each(v_value.value->'sequences') loop
      if exists(select 1 from jsonb_array_elements(v_sequence.value) k where jsonb_typeof(k) <> 'string' or length(trim(k #>> '{}')) = 0) then return false; end if;
    end loop;
  end loop;
  if exists (select 1 from jsonb_each(v_entries) e cross join lateral jsonb_array_elements(e.value->'ingredients') i
    where not ((i->>'purchaseKey') = any(v_seen) or v_unresolved ? (i->>'purchaseKey'))) then return false; end if;
  if exists (select 1 from jsonb_array_elements(p_document->'manualItems') m where m->'identity'->>'meaning' <> 'legacyIndependent'
    and not ((m->'identity'->>'purchaseKey') = any(v_seen) or v_unresolved ? (m->'identity'->>'purchaseKey'))) then return false; end if;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;

alter table public.shopping_list drop constraint shopping_list_document_v3_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;
-- NOT VALID preserves pre-existing unsupported evidence. Every new write is
-- still checked. The command boundary refuses unsupported preimages.

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
    if not (private.is_shopping_command_document(p_document, 3) or public.is_shopping_document_v4(p_document))
      or octet_length(p_document::text) > 4194304 then
      raise exception 'invalid Shopping document' using errcode = '23514';
    end if;
    if v_row.user_id is not null and not (
      private.is_shopping_command_document(v_row.document, 2) or private.is_shopping_command_document(v_row.document, 3) or public.is_shopping_document_v4(v_row.document)
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
