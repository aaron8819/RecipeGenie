begin;

-- Optional field history; existing documents are neither rewritten nor reset.
alter function public.is_shopping_document_v4(jsonb) rename to shopping_document_v4_before_manual_fields;
alter function public.shopping_document_v4_before_manual_fields(jsonb) set schema private;
create function public.is_shopping_document_v4(p_document jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; versions jsonb; field text; stripped jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_document->'manualItems') is distinct from 'array' then return false; end if;
  for item in select value from jsonb_array_elements(p_document->'manualItems') loop
    if item->'identity' ? 'fieldVersions' then
      versions := item->'identity'->'fieldVersions';
      if jsonb_typeof(versions) is distinct from 'object' or
        versions - array['displayName','quantity','guard'] <> '{}' then return false; end if;
      foreach field in array array['displayName','quantity','guard'] loop
        if jsonb_typeof(versions->field) is distinct from 'number' or
          coalesce(versions->>field,'') !~ '^(0|[1-9][0-9]*)$' or
          (versions->>field)::numeric > 9007199254740991 then return false; end if;
      end loop;
    end if;
    stripped := stripped || jsonb_build_array(item #- '{identity,fieldVersions}');
  end loop;
  return private.shopping_document_v4_before_manual_fields(jsonb_set(p_document, '{manualItems}', stripped));
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shopping_document_v4_before_manual_fields(jsonb) from public, anon, authenticated, service_role;
alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;
commit;
