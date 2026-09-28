begin;

-- Row metadata is read-only to clients under the existing writer fence.
alter table public.shopping_list
  add column trip_revision bigint not null default 0,
  add column trip_id uuid not null default gen_random_uuid(),
  add column content_epoch bigint not null default 0 check (content_epoch >= 0);
alter table private.shopping_protocol
  add column clear_trip uuid,
  add column clear_epoch bigint;

create function private.shopping_content(p_document jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('recipeEntries', p_document->'recipeEntries',
    'manualItems', p_document->'manualItems', 'itemOverrides', p_document->'itemOverrides') ||
    case when p_document ? 'acknowledgements' then jsonb_build_object('acknowledgements', p_document->'acknowledgements') else '{}'::jsonb end;
$$;
revoke all on function private.shopping_content(jsonb) from public, anon, authenticated, service_role;

create function private.shopping_content_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb;
begin
  v_old := private.shopping_content(old.document);
  v_new := private.shopping_content(new.document);
  -- Independent legacy category repair is organization, not a need edit.
  if old.document->>'schemaVersion' = '4' and new.document->>'schemaVersion' = '4' then
    v_old := jsonb_set(v_old, '{manualItems}', coalesce((select jsonb_agg(m - 'categoryKey') from jsonb_array_elements(v_old->'manualItems') m), '[]'));
    v_new := jsonb_set(v_new, '{manualItems}', coalesce((select jsonb_agg(m - 'categoryKey') from jsonb_array_elements(v_new->'manualItems') m), '[]'));
  end if;
  new.trip_revision := case when new.trip_id <> old.trip_id then new.content_revision else old.trip_revision end;
  new.content_epoch := old.content_epoch + case when v_old is distinct from v_new or new.trip_id <> old.trip_id then 1 else 0 end;
  return new;
end;
$$;
revoke all on function private.shopping_content_changed() from public, anon, authenticated, service_role;
create trigger shopping_content_epoch before update on public.shopping_list
  for each row execute function private.shopping_content_changed();

-- Preserve the accepted V4 validator; extend it only for optional coverage.
alter function public.is_shopping_document_v4(jsonb) rename to shopping_document_v4_without_coverage;
alter function public.shopping_document_v4_without_coverage(jsonb) set schema private;
create function public.is_shopping_document_v4(p_document jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare a jsonb; b jsonb; p jsonb; x numeric; y numeric;
begin
  if not private.shopping_document_v4_without_coverage(p_document - 'acknowledgements') then return false; end if;
  if not (p_document ? 'acknowledgements') then return true; end if;
  if jsonb_typeof(p_document->'acknowledgements') is distinct from 'object' then return false; end if;
  for a in select value from jsonb_each(p_document->'acknowledgements') loop
    if jsonb_typeof(a) is distinct from 'object' or a - array['version','basis'] <> '{}' or
      jsonb_typeof(a->'version') is distinct from 'number' or coalesce(a->>'version','') !~ '^(0|[1-9][0-9]*)$' or
      (a->>'version')::numeric > 9007199254740991 then return false; end if;
    b := a->'basis';
    if b = 'null' then continue; end if;
    if b->'comparisonVersion' is distinct from '1' or jsonb_typeof(b->'parts') is distinct from 'array' then return false; end if;
    for p in select value from jsonb_array_elements(b->'parts') loop
      if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'purchaseKey') is distinct from 'string' or
        length(p->>'purchaseKey') = 0 or jsonb_typeof(p->'materialKey') is distinct from 'string' or
        jsonb_typeof(p->'unit') is distinct from 'string' then return false; end if;
      if p->>'kind' in ('scalar','package') then
        x := private.recipe_quantity_rational_value(p->'amount',false);
        if x is null or x < 0 then return false; end if;
        if p->>'kind' = 'package' and (private.recipe_quantity_rational_value(p->'size',true) is null or
          jsonb_typeof(p->'descriptor') is distinct from 'string' or length(p->>'descriptor') = 0 or
          jsonb_typeof(p->'sizeUnit') is distinct from 'string' or length(p->>'sizeUnit') = 0) then return false; end if;
      elsif p->>'kind' = 'range' then
        x := private.recipe_quantity_rational_value(p->'minimum',false);
        y := private.recipe_quantity_rational_value(p->'maximum',false);
        if x is null or y is null or x < 0 or x > y then return false; end if;
      elsif p->>'kind' = 'token' then
        if jsonb_typeof(p->'token') is distinct from 'string' or length(p->>'token') = 0 then return false; end if;
      else return false;
      end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;
alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;

create or replace function public.shopping_clear_undo_available(p_row public.shopping_list)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(not exists (select 1 from jsonb_object_keys(($1).document->'recipeEntries') k
    where not exists (select 1 from public.recipes r where r.user_id = ($1).user_id and r.recipe_uuid::text = k)) and
    octet_length(($1).document::text) <= 4194304 and
    octet_length((jsonb_build_object('recipeEntries', ($1).document->'recipeEntries',
      'manualItems', ($1).document->'manualItems', 'itemOverrides', ($1).document->'itemOverrides') ||
      case when ($1).document ? 'acknowledgements' then jsonb_build_object('acknowledgements', ($1).document->'acknowledgements') else '{}'::jsonb end)::text) <= 1048576, false);
$$;


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
    'lastWriteWasInitialization', exists (
      select 1 from public.shopping_list s
      join private.shopping_admissions a on a.user_id = s.user_id
      where s.user_id = p_owner and s.content_revision > 0
        and a.receipt->>'outcome' = 'Applied'
        and a.receipt->>'revision' = s.content_revision::text
        and a.payload_hash = encode(extensions.digest(
          '{"mutation":{"type":"initialize"},"observedRevision":' ||
          (s.content_revision - 1)::text || ',"protocol":1}', 'sha256'), 'hex')
    ),
    'dependencyRevision', (select dependency_revision::text from private.shopping_protocol where user_id = p_owner),
    'pantry', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.pantry_items p where user_id = p_owner),
    'recipes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.recipes r where user_id = p_owner),
    'inverse', (select case when clear_expires_at > clock_timestamp() then clear_inverse end
      from private.shopping_protocol where user_id = p_owner),
    'inverseRevision', (select clear_revision from private.shopping_protocol where user_id = p_owner),
    'inverseTrip', (select clear_trip from private.shopping_protocol where user_id = p_owner),
    'inverseEpoch', (select clear_epoch from private.shopping_protocol where user_id = p_owner)
  );
end;
$$;
revoke all on function public.shopping_command_context(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.shopping_command_context(uuid,bigint,uuid,text) to service_role;

create or replace function public.shopping_commit(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text,
  p_revision bigint, p_dependency bigint, p_document jsonb, p_outcome text,
  p_action text, p_pantry_item text default null, p_recipe uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ticket jsonb; v_row public.shopping_list%rowtype; v_receipt jsonb;
  v_inverse jsonb; v_pantry public.pantry_items%rowtype; v_added boolean := false; v_undo_available boolean := false;
  v_trip uuid; v_content jsonb;
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
    ('Applied','Unchanged','Conflict','TargetGone','InvalidInput','UnsupportedDocument','UndoUnavailable','TripEnded','SourceUnavailable','RequirementChanged')
    or p_action is null or p_action not in ('initialize','mutation','complete','restoreContent','pantry','deleteRecipe') then
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
    -- This lock is also acquired before recipe deletion. Dependency revision
    -- is checked above; current existence is checked here, inside the write.
    -- Initialization preserves old evidence (including unavailable references);
    -- ordinary edits cannot turn preserved evidence into a new contribution.
    if p_action <> 'initialize' and exists (select 1 from jsonb_object_keys(p_document->'recipeEntries') k
      where (p_action = 'restoreContent' or p_document->'recipeEntries'->k is distinct from v_row.document->'recipeEntries'->k)
      and not exists (select 1 from public.recipes r where r.user_id = p_owner and r.recipe_uuid::text = k)) then
      p_outcome := 'SourceUnavailable';
    end if;
    if p_action = 'restoreContent' then
      select clear_inverse into v_inverse from private.shopping_protocol where user_id = p_owner
        and clear_trip = v_row.trip_id and clear_epoch = v_row.content_epoch
        and clear_expires_at > clock_timestamp();
      if v_inverse is null then p_outcome := 'UndoUnavailable';
      else
        v_content := private.shopping_content(p_document);
        -- Category fallback for independent legacy rows is the only permitted
        -- adaptation. Never restore organization or revive a deleted category.
        if p_document->>'schemaVersion' = '4' then
          v_content := jsonb_set(v_content, '{manualItems}', coalesce((select jsonb_agg(m - 'categoryKey') from jsonb_array_elements(v_content->'manualItems') m), '[]'));
          v_inverse := jsonb_set(v_inverse, '{manualItems}', coalesce((select jsonb_agg(m - 'categoryKey') from jsonb_array_elements(v_inverse->'manualItems') m), '[]'));
        end if;
        if v_content is distinct from v_inverse or p_document->'preferences' is distinct from v_row.document->'preferences'
          or p_document->'placementEvidence' is distinct from v_row.document->'placementEvidence' then
          raise exception 'invalid clear inverse' using errcode = '23514';
        end if;
      end if;
    end if;
    if p_outcome = 'Applied' then
      v_trip := case when p_action in ('complete','restoreContent') then gen_random_uuid() else coalesce(v_row.trip_id,gen_random_uuid()) end;
      if p_action = 'complete' then
        v_undo_available := public.shopping_clear_undo_available(v_row);
        update private.shopping_protocol set
          clear_inverse = case when v_undo_available then private.shopping_content(v_row.document) end,
          clear_revision = coalesce(p_revision,0) + 1, clear_trip = v_trip,
          clear_epoch = v_row.content_epoch + 1,
          clear_expires_at = clock_timestamp() + interval '10 minutes' where user_id = p_owner;
      elsif p_action = 'restoreContent' then
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
      insert into public.shopping_list(user_id, document, content_revision, trip_id)
        values(p_owner, p_document, coalesce(p_revision, 0) + 1, v_trip)
        on conflict (user_id) do update set document = excluded.document,
          content_revision = excluded.content_revision, trip_id = excluded.trip_id returning * into v_row;
    end if;
  end if;
  end if;
  v_receipt := jsonb_build_object('outcome', p_outcome, 'revision', coalesce(v_row.content_revision, 0),
    'contentEpoch', v_row.content_epoch, 'tripId', v_row.trip_id,
    'pantryId', v_pantry.id, 'pantryWasAdded', v_added,
    'undoAvailable', p_action = 'complete' and v_undo_available);
  update private.shopping_admissions set receipt = v_receipt
    where user_id = p_owner and sequence = p_sequence;
  return jsonb_build_object('status', p_outcome, 'receipt', v_receipt,
    'row', case when v_row.user_id is not null then to_jsonb(v_row) end);
end;
$$;



notify pgrst, 'reload schema';
commit;
