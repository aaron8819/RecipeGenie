begin;

-- Older validators can return true for JSON null through SQL three-valued
-- logic. Tighten the command boundary without rewriting preserved documents.
create function private.is_shopping_command_document(p_document jsonb, p_version integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_document) = 'object'
    and p_document->'schemaVersion' = to_jsonb(p_version)
    and case p_version when 2 then public.is_shopping_document_v2(p_document)
      when 3 then public.is_shopping_document_v3(p_document) else false end, false);
$$;
revoke all on function private.is_shopping_command_document(jsonb,integer) from public, anon, authenticated, service_role;

-- One owner lock serializes admission, dependency snapshots and commits. No
-- command bodies or documents are duplicated into the bounded receipt slots.
create table private.shopping_protocol (
  user_id uuid primary key references auth.users(id) on delete cascade,
  next_sequence bigint not null default 1 check (next_sequence > 0),
  admission_floor bigint not null default 1 check (admission_floor > 0),
  last_admitted_at timestamptz not null default '-infinity',
  dependency_revision bigint not null default 0,
  clear_inverse jsonb,
  clear_revision bigint,
  clear_expires_at timestamptz,
  check (clear_inverse is null or octet_length(clear_inverse::text) <= 1048576)
);
create table private.shopping_admissions (
  user_id uuid not null references private.shopping_protocol(user_id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  operation_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  receipt jsonb check (receipt is null or (
    jsonb_typeof(receipt) = 'object' and octet_length(receipt::text) <= 2048
  )),
  primary key (user_id, sequence),
  unique (user_id, operation_id)
);
alter table private.shopping_protocol enable row level security;
alter table private.shopping_admissions enable row level security;
revoke all on private.shopping_protocol, private.shopping_admissions
  from public, anon, authenticated, service_role;

create function private.lock_shopping_owner(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is null then raise exception 'authentication required' using errcode = '42501'; end if;
  insert into private.shopping_protocol(user_id) values (p_owner) on conflict do nothing;
  perform 1 from private.shopping_protocol where user_id = p_owner for update;
end;
$$;

create function private.clean_shopping_admissions(p_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_floor bigint;
begin
  -- Callers already hold the owner lock. Only an expired prefix can disappear.
  select coalesce(min(sequence), (select next_sequence from private.shopping_protocol where user_id = p_owner))
    into v_floor from private.shopping_admissions
    where user_id = p_owner and expires_at > clock_timestamp();
  delete from private.shopping_admissions where user_id = p_owner and sequence < v_floor;
  update private.shopping_protocol set admission_floor = greatest(admission_floor, v_floor)
    where user_id = p_owner;
end;
$$;

create function public.shopping_admit(
  p_owner uuid, p_operation uuid, p_hash text, p_recover boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot private.shopping_admissions%rowtype; v_time timestamptz; v_sequence bigint;
begin
  if p_operation is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_recover is null then
    return jsonb_build_object('status', 'InvalidInput');
  end if;
  perform private.lock_shopping_owner(p_owner);
  perform private.clean_shopping_admissions(p_owner);
  select * into v_slot from private.shopping_admissions
    where user_id = p_owner and operation_id = p_operation;
  if found then
    if v_slot.payload_hash <> p_hash then return jsonb_build_object('status', 'PayloadMismatch'); end if;
    return jsonb_build_object('status', 'Admitted', 'sequence', v_slot.sequence::text,
      'expiresAt', v_slot.expires_at);
  end if;
  if p_recover then return jsonb_build_object('status', 'OutcomeUnknown'); end if;
  if (select count(*) from private.shopping_admissions where user_id = p_owner) >= 256 then
    return jsonb_build_object('status', 'RetryCapacity', 'retryAfter',
      (select min(expires_at) from private.shopping_admissions where user_id = p_owner));
  end if;
  select greatest(clock_timestamp(), last_admitted_at), next_sequence into v_time, v_sequence
    from private.shopping_protocol where user_id = p_owner;
  update private.shopping_protocol set next_sequence = next_sequence + 1, last_admitted_at = v_time
    where user_id = p_owner;
  insert into private.shopping_admissions values
    (p_owner, v_sequence, p_operation, p_hash, v_time + interval '15 minutes', null);
  return jsonb_build_object('status', 'Admitted', 'sequence', v_sequence::text,
    'expiresAt', v_time + interval '15 minutes');
end;
$$;

create function private.shopping_ticket(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot private.shopping_admissions%rowtype;
begin
  perform private.clean_shopping_admissions(p_owner);
  if p_sequence < (select admission_floor from private.shopping_protocol where user_id = p_owner) then
    return jsonb_build_object('status', 'RetryExpired');
  end if;
  select * into v_slot from private.shopping_admissions
    where user_id = p_owner and sequence = p_sequence and operation_id = p_operation;
  if not found then return jsonb_build_object('status', 'UnknownAdmission'); end if;
  if p_hash is distinct from v_slot.payload_hash then return jsonb_build_object('status', 'PayloadMismatch'); end if;
  if v_slot.expires_at <= clock_timestamp() then return jsonb_build_object('status', 'RetryExpired'); end if;
  if v_slot.receipt is not null then
    return jsonb_build_object('status', 'AlreadyApplied', 'receipt', v_slot.receipt);
  end if;
  return jsonb_build_object('status', 'Pending');
end;
$$;

create function public.shopping_command_context(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ticket jsonb;
begin
  perform private.lock_shopping_owner(p_owner);
  v_ticket := private.shopping_ticket(p_owner, p_sequence, p_operation, p_hash);
  if v_ticket->>'status' <> 'Pending' then return v_ticket; end if;
  return v_ticket || jsonb_build_object(
    'row', (select to_jsonb(s) from public.shopping_list s where user_id = p_owner),
    'dependencyRevision', (select dependency_revision::text from private.shopping_protocol where user_id = p_owner),
    'pantry', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.pantry_items p where user_id = p_owner),
    'recipes', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.recipes r where user_id = p_owner),
    'inverse', (select case when clear_expires_at > clock_timestamp() then clear_inverse end
      from private.shopping_protocol where user_id = p_owner),
    'inverseRevision', (select clear_revision from private.shopping_protocol where user_id = p_owner)
  );
end;
$$;

-- Dependency mutations do not rewrite Shopping or frozen source evidence.
-- Their epoch is checked with the document revision under the same owner lock.
create function private.shopping_dependency_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := coalesce(new.user_id, old.user_id);
begin
  -- Cascading account removal must not recreate the deleted owner's protocol.
  if not exists (select 1 from auth.users where id = v_owner) then return null; end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'owner cannot change' using errcode = '42501';
  end if;
  perform private.lock_shopping_owner(v_owner);
  update private.shopping_protocol set dependency_revision = dependency_revision + 1 where user_id = v_owner;
  return null;
end;
$$;
create trigger shopping_recipe_dependency after insert or update or delete on public.recipes
  for each row execute function private.shopping_dependency_changed();
create trigger shopping_pantry_dependency after insert or update or delete on public.pantry_items
  for each row execute function private.shopping_dependency_changed();

-- Prepared compatibility validation only. No V4 document writes/conversion are
-- enabled in Slice 6. Raw legacy provenance remains an independent envelope.
create function private.is_shopping_legacy_envelope(p_value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
begin
  return coalesce(jsonb_typeof(p_value) = 'object'
    and p_value ?& array['kind','id','version','raw','displayName','quantity',
      'categoryEvidence','orderEvidence','previousChecked','sourceHistory','unresolvedReasons']
    and p_value->>'kind' = 'legacyIndependent'
    and jsonb_typeof(p_value->'id') = 'string' and length(p_value->>'id') > 0
    and jsonb_typeof(p_value->'version') = 'number'
    and (p_value->>'version')::numeric between 0 and 9007199254740991
    and trunc((p_value->>'version')::numeric) = (p_value->>'version')::numeric
    and jsonb_typeof(p_value->'raw') = 'object'
    and jsonb_typeof(p_value->'displayName') = 'string' and length(trim(p_value->>'displayName')) > 0
    and (p_value->'quantity' = 'null' or private.recipe_quantity_is_valid(p_value->'quantity'))
    and jsonb_typeof(p_value->'categoryEvidence') = 'array'
    and not exists(select 1 from jsonb_array_elements(p_value->'categoryEvidence') as e(value)
      where jsonb_typeof(value) <> 'string' or length(value #>> '{}') = 0)
    and jsonb_typeof(p_value->'orderEvidence') = 'array'
    and not exists(select 1 from jsonb_array_elements(p_value->'orderEvidence') as e(value)
      where jsonb_typeof(value) <> 'array' or exists(select 1 from jsonb_array_elements(value) as s(v)
        where jsonb_typeof(v) <> 'string' or length(v #>> '{}') = 0))
    and jsonb_typeof(p_value->'previousChecked') = 'boolean' and p_value->'sourceHistory' = 'null'
    and jsonb_typeof(p_value->'unresolvedReasons') = 'array' and jsonb_array_length(p_value->'unresolvedReasons') > 0
    and not exists(select 1 from jsonb_array_elements(p_value->'unresolvedReasons') as e(value)
      where jsonb_typeof(value) <> 'string' or length(value #>> '{}') = 0), false);
exception when others then return false;
end;
$$;
revoke all on function private.is_shopping_legacy_envelope(jsonb) from public, anon, authenticated, service_role;

-- The historical deletion implementation is retained internally. Only commit
-- may invoke it; its owner is supplied by authenticated server context.
alter function public.delete_recipe(uuid) rename to shopping_delete_recipe_internal;
alter function public.shopping_delete_recipe_internal(uuid) set schema private;
revoke all on function private.shopping_delete_recipe_internal(uuid) from public, anon, authenticated, service_role;

create function public.shopping_commit(
  p_owner uuid, p_sequence bigint, p_operation uuid, p_hash text,
  p_revision bigint, p_dependency bigint, p_document jsonb, p_outcome text,
  p_action text, p_pantry_item text default null, p_recipe uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ticket jsonb; v_row public.shopping_list%rowtype; v_receipt jsonb;
  v_inverse jsonb; v_pantry public.pantry_items%rowtype; v_added boolean := false;
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
      v_inverse := jsonb_build_object('recipeEntries', v_row.document->'recipeEntries',
        'manualItems', v_row.document->'manualItems', 'itemOverrides', v_row.document->'itemOverrides');
      update private.shopping_protocol set
        clear_inverse = case when v_inverse->'recipeEntries' = '{}' and octet_length(v_inverse::text) <= 1048576 then v_inverse end,
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
    'undoAvailable', p_action = 'complete' and v_inverse->'recipeEntries' = '{}'
      and octet_length(v_inverse::text) <= 1048576);
  update private.shopping_admissions set receipt = v_receipt
    where user_id = p_owner and sequence = p_sequence;
  return jsonb_build_object('status', p_outcome, 'receipt', v_receipt,
    'row', case when v_row.user_id is not null then to_jsonb(v_row) end);
end;
$$;

-- Retain reads. Table- and column-level grants are independent; revoke both.
revoke insert, update, delete, truncate on public.shopping_list from public, anon, authenticated, service_role;
revoke update(document, content_revision) on public.shopping_list from public, anon, authenticated, service_role;
revoke delete on public.recipes from public, anon, authenticated, service_role;
drop policy users_update_own_shopping_document on public.shopping_list;
revoke all on function public.move_shopping_document_item_to_pantry(bigint,jsonb,text,numeric,text)
  from public, anon, authenticated, service_role;

create function public.delete_recipe(p_recipe_uuid uuid) returns uuid
language plpgsql set search_path = '' as $$
begin raise exception 'Shopping protocol updated. Refresh the application before changing recipes.' using errcode = 'P0001'; end;
$$;
revoke all on function public.delete_recipe(uuid) from public, anon, service_role;
grant execute on function public.delete_recipe(uuid) to authenticated;

revoke all on function private.lock_shopping_owner(uuid), private.clean_shopping_admissions(uuid),
  private.shopping_ticket(uuid,bigint,uuid,text), private.shopping_dependency_changed()
  from public, anon, authenticated, service_role;
revoke all on function public.shopping_admit(uuid,uuid,text,boolean),
  public.shopping_command_context(uuid,bigint,uuid,text),
  public.shopping_commit(uuid,bigint,uuid,text,bigint,bigint,jsonb,text,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.shopping_admit(uuid,uuid,text,boolean),
  public.shopping_command_context(uuid,bigint,uuid,text),
  public.shopping_commit(uuid,bigint,uuid,text,bigint,bigint,jsonb,text,text,text,uuid)
  to service_role;

commit;
