begin;

-- Read-only provenance under the existing owner lock. Only an Applied receipt
-- for the canonical initialization command at the exact current revision proves
-- no later document write. Missing/pruned history is deliberately not proof.
-- No document/schema/default rewrite and no new callable authority.
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
    'inverseRevision', (select clear_revision from private.shopping_protocol where user_id = p_owner)
  );
end;
$$;
revoke all on function public.shopping_command_context(uuid,bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.shopping_command_context(uuid,bigint,uuid,text) to service_role;
commit;
