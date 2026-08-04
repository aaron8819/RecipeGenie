const check = (name, severity, why, remediation, sql) => ({
  name, severity, why, remediation, sql,
})

export const AUDIT_CHECKS = [
  check(
    "orphaned-user-ownership",
    "ERROR",
    "Every owner reference is constrained to an existing auth.users row.",
    "Identify the missing principal and decide whether the application row should be exported, reassigned, or removed through an authorized maintenance procedure.",
    `with invalid as (
      select 'recipe:' || recipe_uuid::text as identifier from public.recipes r
        where not exists (select 1 from auth.users u where u.id = r.user_id)
      union all select 'pantry:' || id::text from public.pantry_items p
        where not exists (select 1 from auth.users u where u.id = p.user_id)
      union all select 'history:' || id::text from public.recipe_history h
        where not exists (select 1 from auth.users u where u.id = h.user_id)
      union all select 'share:' || id::text from public.recipe_shares s
        where not exists (select 1 from auth.users u where u.id = s.sender_user_id)
           or not exists (select 1 from auth.users u where u.id = s.recipient_user_id)
      union all select 'contribution:' || recipe_uuid::text from public.shopping_recipe_contributions c
        where not exists (select 1 from auth.users u where u.id = c.user_id)
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "invalid-recipe-and-ingredient-shape",
    "ERROR",
    "The recipe editor and shopping generator require nonblank recipe fields, positive servings, canonical ingredient sections, and touched ingredient rows with valid item/amount/unit combinations.",
    "Open each recipe in the editor, correct the flagged fields, and save through the normal application path.",
    `with invalid as (
      select distinct r.recipe_uuid::text as identifier
      from public.recipes r
      left join lateral jsonb_array_elements(
        case when jsonb_typeof(r.ingredient_sections) = 'array'
          then r.ingredient_sections else '[]'::jsonb end
      ) section on true
      left join lateral jsonb_array_elements(
        case when jsonb_typeof(section.value->'ingredients') = 'array'
          then section.value->'ingredients' else '[]'::jsonb end
      ) ingredient on true
      where trim(r.name) = '' or trim(r.category) = '' or r.servings <= 0
        or jsonb_typeof(r.ingredient_sections) <> 'array'
        or (section.value is not null and (
          jsonb_typeof(section.value) <> 'object'
          or not (section.value ?& array['label', 'ingredients'])
          or exists (
            select 1 from jsonb_object_keys(section.value) as key
            where key <> all(array['label', 'ingredients'])
          )
          or jsonb_typeof(section.value->'label') not in ('string', 'null')
          or jsonb_typeof(section.value->'ingredients') <> 'array'
          or jsonb_array_length(section.value->'ingredients') = 0
        ))
        or (ingredient.value is not null and (
          jsonb_typeof(ingredient.value) <> 'object'
          or (coalesce(trim(ingredient.value->>'item'), '') = '' and (
            coalesce(trim(ingredient.value->>'unit'), '') <> ''
            or jsonb_typeof(ingredient.value->'amount') not in ('null')
            or coalesce(trim(ingredient.value->>'modifier'), '') <> ''
          ))
          or (coalesce(trim(ingredient.value->>'unit'), '') <> '' and
              (ingredient.value->'amount' is null or jsonb_typeof(ingredient.value->'amount') <> 'number'))
          or (jsonb_typeof(ingredient.value->'amount') = 'number' and (ingredient.value->>'amount')::numeric <= 0)
        ))
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "duplicate-exact-recipe-ingredients",
    "WARNING",
    "The recipe editor defines exact duplicate ingredients by normalized group, item, amount, unit, and modifier and offers deterministic removal.",
    "Review the duplicate rows in the recipe editor and use its exact-duplicate cleanup when appropriate.",
    `with identities as (
      select r.recipe_uuid,
        lower(regexp_replace(trim(coalesce(section.value->>'label', '')), '\\s+', ' ', 'g')) as group_key,
        lower(regexp_replace(trim(i.value->>'item'), '\\s+', ' ', 'g')) as item_key,
        coalesce(i.value->>'amount', '') as amount_key,
        lower(trim(coalesce(i.value->>'unit', ''))) as unit_key,
        lower(regexp_replace(trim(coalesce(i.value->>'modifier', '')), '\\s+', ' ', 'g')) as modifier_key
      from public.recipes r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.ingredient_sections) = 'array'
          then r.ingredient_sections else '[]'::jsonb end
      ) section
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(section.value->'ingredients') = 'array'
          then section.value->'ingredients' else '[]'::jsonb end
      ) i
      where jsonb_typeof(i.value) = 'object' and coalesce(trim(i.value->>'item'), '') <> ''
    ), invalid as (
      select recipe_uuid::text as identifier from identities
      group by recipe_uuid, group_key, item_key, amount_key, unit_key, modifier_key having count(*) > 1
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select distinct identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "invalid-or-duplicate-pantry-identities",
    "ERROR",
    "Pantry membership is keyed by a trimmed, case-insensitive item identity in application lifecycle checks.",
    "Merge duplicate pantry entries or remove blank entries through the Pantry UI after confirming the intended canonical name.",
    `with invalid as (
      select ((array_agg(id order by id))[1])::text as identifier from public.pantry_items
      group by user_id, lower(regexp_replace(trim(item), '\\s+', ' ', 'g'))
      having trim(lower(regexp_replace(trim(item), '\\s+', ' ', 'g'))) = '' or count(*) > 1
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "planner-and-template-recipe-identity",
    "ERROR",
    "Planner and template UUID references must resolve to recipes owned by the same user and their legacy mirrors must remain synchronized.",
    "Inspect the affected plan/template and recipe ownership, then use an explicitly reviewed reconciliation procedure; do not edit arrays ad hoc.",
    `with invalid as (
      select 'weekly:' || left(md5(p.user_id::text || ':' || p.week_date::text), 16) as identifier
      from public.weekly_plans p
      where p.recipe_ids <> private.resolve_owned_recipe_legacy_array(p.user_id, p.recipe_uuids)
         or coalesce(p.day_assignments, '{}'::jsonb) <> private.resolve_owned_recipe_legacy_assignments(p.user_id, p.day_assignment_recipe_uuids)
         or p.made_recipe_ids <> private.resolve_owned_recipe_legacy_array(p.user_id, p.made_recipe_uuids)
      union all
      select 'template:' || t.id::text from public.plan_templates t
      where t.recipe_ids <> private.resolve_owned_recipe_legacy_array(t.user_id, t.recipe_uuids)
         or coalesce(t.day_assignments, '{}'::jsonb) <> private.resolve_owned_recipe_legacy_assignments(t.user_id, t.day_assignment_recipe_uuids)
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "history-and-share-identity",
    "ERROR",
    "Live history and share UUID links must resolve to a same-owner recipe and agree with the compatibility identity; pending and accepted share states require their corresponding UUID links.",
    "Review the source/accepted recipe and share owner before resolving the state through the normal share or history workflow.",
    `with invalid as (
      select 'history:' || h.id::text as identifier from public.recipe_history h
      join public.recipes r on r.recipe_uuid = h.recipe_uuid
      where r.user_id <> h.user_id or r.id <> h.recipe_id
      union all
      select 'share:' || s.id::text from public.recipe_shares s
      where (s.status = 'pending' and s.source_recipe_uuid is null)
         or (s.status = 'accepted' and (s.accepted_recipe_uuid is null or s.responded_at is null))
         or (s.status in ('declined', 'canceled') and s.responded_at is null)
         or (s.accepted_recipe_uuid is not null and not exists (
           select 1 from public.recipes r where r.recipe_uuid = s.accepted_recipe_uuid and r.user_id = s.recipient_user_id
         ))
         or (s.status = 'pending' and not exists (
           select 1 from public.recipes r where r.recipe_uuid = s.source_recipe_uuid and r.user_id = s.sender_user_id
         ))
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "shopping-contribution-authority",
    "ERROR",
    "Each frozen contribution must resolve to one same-owner recipe, agree across UUID/legacy identities, and contain a valid single-recipe snapshot.",
    "Re-add or remove the affected recipe through the shopping contribution command after reviewing the frozen snapshot; do not patch the projection directly.",
    `with invalid as (
      select c.recipe_uuid::text as identifier
      from public.shopping_recipe_contributions c
      left join public.recipes r on r.recipe_uuid = c.recipe_uuid and r.user_id = c.user_id
      where r.recipe_uuid is null or r.id <> c.recipe_id
        or jsonb_typeof(c.snapshot) <> 'object'
        or jsonb_typeof(c.snapshot->'items') <> 'array'
        or exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(c.snapshot->'items') = 'array' then c.snapshot->'items' else '[]'::jsonb end
          ) item
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(item.value->'sources') = 'array' then item.value->'sources' else '[]'::jsonb end
          ) source
          where nullif(source.value->>'recipeUuid', '') is distinct from c.recipe_uuid::text
        )
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "shopping-projection-lifecycle",
    "ERROR",
    "Shopping source mirrors must resolve to same-owner recipes, and one row identity cannot occupy active, pantry/already-have, and excluded buckets simultaneously.",
    "Regenerate the list from authoritative contributions or use the normal restore/remove lifecycle action after reviewing manual overrides.",
    `with bucket_rows as (
      select s.user_id, 'shopping:' || left(md5(s.user_id::text), 16) as identifier,
        item.value->>'rowId' as row_id, bucket.name
      from public.shopping_list s
      cross join lateral (values ('items', s.items), ('already_have', s.already_have), ('excluded', s.excluded)) bucket(name, value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(bucket.value) = 'array' then bucket.value else '[]'::jsonb end
      ) item
      where nullif(item.value->>'rowId', '') is not null
    ), invalid as (
      select 'shopping:' || left(md5(s.user_id::text), 16) as identifier
      from public.shopping_list s
      where s.source_recipes <> private.resolve_owned_recipe_legacy_array(s.user_id, s.source_recipe_uuids)
      union all
      select identifier from bucket_rows group by user_id, identifier, row_id having count(distinct name) > 1
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select distinct identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  check(
    "shopping-projection-totals",
    "WARNING",
    "The authoritative contribution command stores total servings as the sum of active contribution servings.",
    "Re-run an idempotent contribution command from fresh state to rebuild the compatibility projection after reviewing concurrent/manual changes.",
    `with invalid as (
      select 'shopping:' || left(md5(s.user_id::text), 16) as identifier
      from public.shopping_list s
      left join lateral (
        select coalesce(sum(c.servings), 0)::integer as expected_servings
        from public.shopping_recipe_contributions c where c.user_id = s.user_id
      ) totals on true
      where coalesce(s.total_servings, 0) <> totals.expected_servings
        and exists (select 1 from public.shopping_recipe_contributions c where c.user_id = s.user_id)
    ) select count(*)::integer as record_count,
      coalesce((select array_agg(identifier) from (select identifier from invalid order by identifier limit $1) samples), '{}'::text[]) as sample_ids
    from invalid`,
  ),
  {
    name: "recipe-import-record-state",
    severity: "INFO",
    why: "Recipe import is a stateless authenticated HTTP parsing flow; the repository defines no import-record table or persisted import-state machine.",
    remediation: "No data remediation applies. Investigate request logs for individual import failures.",
    skip: "no persistent import records exist in the current architecture",
  },
]

export async function executeAuditChecks(query, sampleLimit, definitions = AUDIT_CHECKS) {
  const results = []
  for (const definition of definitions) {
    if (definition.skip) {
      results.push({
        check: definition.name,
        status: "SKIP",
        severity: definition.severity,
        affectedRecordCount: 0,
        representativeIdentifiers: [],
        whyInvalid: definition.why,
        suggestedRemediation: definition.remediation,
        skipReason: definition.skip,
      })
      continue
    }
    const rows = await query(definition.sql, [sampleLimit])
    const recordCount = Number(rows[0]?.record_count || 0)
    results.push({
      check: definition.name,
      status: recordCount ? "FINDING" : "CLEAN",
      severity: definition.severity,
      affectedRecordCount: recordCount,
      representativeIdentifiers: rows[0]?.sample_ids || [],
      whyInvalid: definition.why,
      suggestedRemediation: definition.remediation,
    })
  }
  return results
}

export function printAuditResults(results, output = console.log) {
  for (const result of results) {
    output(`${result.status.padEnd(7)} [${result.severity}] ${result.check}`)
    output(`  Affected: ${result.affectedRecordCount}`)
    output(`  Representatives: ${result.representativeIdentifiers.join(", ") || "none"}`)
    output(`  Why: ${result.whyInvalid}`)
    output(`  Remediation: ${result.suggestedRemediation}`)
    if (result.skipReason) output(`  Skipped: ${result.skipReason}`)
  }
}
