import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const preflightPath = join(
  process.cwd(),
  "../supabase/verification/canonical_recipe_structure_preflight.sql"
)
const sql = readFileSync(preflightPath, "utf8")

describe("canonical recipe structure preflight", () => {
  it("is structurally read-only and always rolls back", () => {
    expect(sql).toContain("set default_transaction_read_only = on;")
    expect(sql).toContain("begin transaction read only;")
    expect(sql.indexOf("set default_transaction_read_only = on;")).toBeLessThan(
      sql.indexOf("do $guards$")
    )
    expect(sql).toContain("set local statement_timeout = '30s';")
    expect(sql).toContain("set local lock_timeout = '5s';")
    expect(sql.match(/\brollback;/gu)?.length).toBeGreaterThanOrEqual(3)
    expect(sql).not.toMatch(/\b(?:insert|update|delete|truncate|alter|drop|copy)\b/iu)
  })

  it("guards the production identity, schema, validators, and migration tip", () => {
    expect(sql).toContain("expected_project_ref is required")
    expect(sql).toContain("eyaoahwzixqetjgfghsh")
    expect(sql).toContain("migration ledger must be exactly 001 through 015")
    expect(sql).toContain("private.recipe_ingredient_is_valid(jsonb)")
    expect(sql).toContain("private.recipe_instruction_groups_are_valid(jsonb)")
    expect(sql).toContain("private.recipe_share_snapshot_is_valid(jsonb)")
  })

  it("emits one aggregate result without selecting identity or recipe content", () => {
    expect(sql).toContain("select :'canonical_structure_result'::jsonb;")
    expect(sql).toContain("'rows_cannot_convert_without_remediation'")
    expect(sql).toContain("'convertible_share_snapshots'")
    expect(sql).toContain("'ingredient_serialized_bytes'")
    expect(sql).not.toMatch(
      /\b(?:user_id|email|recipe_uuid|accepted_recipe_uuid|source_recipe_uuid)\b/iu
    )
    expect(sql).not.toMatch(/recipe\.(?:name|id|image_url|category|tags)/iu)
  })

  it("self-checks clean and conflicting synthetic fixture classifications", () => {
    expect(sql).toContain("canonical_recipe_structure_fixture_mode")
    expect(sql).toContain("canonical_recipe_structure_fixture_failure")
    expect(sql).toContain("->>'total_recipe_rows')::integer = 5")
    expect(sql).toContain("->>'flat_only_instruction_rows')::integer = 2")
    expect(sql).toContain("->>'grouped_only_instruction_rows')::integer = 1")
    expect(sql).toContain("->>'equivalent_dual_instruction_rows')::integer = 1")
    expect(sql).toContain("->>'conflicting_dual_instruction_rows')::integer = 1")
    expect(sql).toContain("->>'entirely_empty_recipe_rows')::integer = 1")
    expect(sql).toContain("raise exception 'canonical recipe structure preflight found malformed or conflicting rows'")
  })
})
