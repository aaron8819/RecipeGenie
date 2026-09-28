begin;

-- Add optional monotonic field history without rewriting accepted documents.
alter function public.is_shopping_document_v4(jsonb) rename to shopping_document_v4_before_organization;
alter function public.shopping_document_v4_before_organization(jsonb) set schema private;
create function public.is_shopping_document_v4(p_document jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  if p_document ? 'organizationVersions' then
    if jsonb_typeof(p_document->'organizationVersions') is distinct from 'object' then return false; end if;
    for k, v in select key, value from jsonb_each(p_document->'organizationVersions') loop
      if length(trim(k)) = 0 or jsonb_typeof(v) is distinct from 'number'
        or v::text !~ '^[0-9]+$' or v::numeric > 9007199254740991 then return false; end if;
    end loop;
  end if;
  return private.shopping_document_v4_before_organization(p_document - 'organizationVersions');
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shopping_document_v4_before_organization(jsonb) from public, anon, authenticated, service_role;
alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;
commit;
