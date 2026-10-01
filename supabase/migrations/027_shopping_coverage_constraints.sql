begin;

-- V2 bases retain alternative constraints and unknown-package tokens. V1
-- runtime bases omitted that evidence, including after sources were removed.
-- Keep all saved evidence and acknowledgement versions unchanged. The V2
-- application requires one explicit recheck for ambiguous V1 coverage; it
-- never fabricates alternatives or upgrades an old quantitative guarantee.
alter function public.is_shopping_document_v4(jsonb) rename to shopping_document_v4_coverage_v1;
alter function public.shopping_document_v4_coverage_v1(jsonb) set schema private;

create function public.is_shopping_document_v4(p_document jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare v_validation jsonb := p_document; k text; a jsonb;
begin
  if jsonb_typeof(p_document->'acknowledgements') = 'object' then
    for k, a in select key, value from jsonb_each(p_document->'acknowledgements') loop
      if a->'basis'->'comparisonVersion' = '2'::jsonb then
        -- Shape validation only. Persisted evidence is never rewritten.
        v_validation := jsonb_set(v_validation,
          array['acknowledgements', k, 'basis', 'comparisonVersion'], '1'::jsonb);
      end if;
    end loop;
  end if;
  return private.shopping_document_v4_coverage_v1(v_validation);
exception when others then return false;
end;
$$;
revoke all on function public.is_shopping_document_v4(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.shopping_document_v4_coverage_v1(jsonb) from public, anon, authenticated, service_role;
alter table public.shopping_list drop constraint shopping_list_document_v4_compatibility_check;
alter table public.shopping_list add constraint shopping_list_document_v4_compatibility_check check (
  public.is_shopping_document_v2(document) or public.is_shopping_document_v3(document) or public.is_shopping_document_v4(document)
) not valid;

commit;
