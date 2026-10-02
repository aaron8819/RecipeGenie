import { describe, expect, it } from "vitest"
import { createApplicationChecks, createDatabaseChecks, expectedCatalog } from "./production-checks.mjs"
import { runChecks } from "./runtime.mjs"

const shoppingConstraint = {
  table: "shopping_list",
  type: "c",
  noInherit: false,
  expression: "(is_shopping_document_v2(document) OR is_shopping_document_v3(document) OR is_shopping_document_v4(document))",
  validators: ["public.is_shopping_document_v2", "public.is_shopping_document_v3", "public.is_shopping_document_v4"],
}

function fixtureQuery({ missingTable, missingConstraint, missingIndex, documentConstraint = shoppingConstraint, legacyShoppingConstraint = false } = {}) {
  return async (sql, parameters = []) => {
    if (sql.includes("transaction_read_only")) return [{ read_only: "on" }]
    if (sql.includes("to_regclass('supabase_migrations.schema_migrations')")) return [{ relation: "supabase_migrations.schema_migrations" }]
    if (sql.includes("limit 0")) return []
    if (sql.includes("max(version)")) return [{ latest: parameters[0], matches: 1 }]
    if (sql.includes("as catalog")) return [{
      catalog: {
        ...expectedCatalog,
        tables: expectedCatalog.tables.filter((table) => table !== missingTable),
        // Independent names prevent production expectations from fixing the fixture too.
        constraints: [
          "recipes_pkey", "recipes_recipe_uuid_key", "shopping_list_pkey",
          "pantry_items_user_id_item_key",
          legacyShoppingConstraint ? "shopping_list_document_v3_compatibility_check" : "shopping_list_document_v4_compatibility_check",
        ].filter((constraint) => constraint !== missingConstraint),
        indexes: expectedCatalog.indexes.filter((index) => index !== missingIndex),
        shoppingDocumentConstraint: documentConstraint,
      },
    }]
    if (sql.includes("as retired")) return [{ retired: { recipe_audits: null, legacy_made_rpc: null, obsolete_uuid_text_rpc: null } }]
    if (sql.includes("limit 1")) return []
    throw new Error(`unexpected fixture query: ${sql}`)
  }
}

describe("production database checks", () => {
  it("expects the current Shopping V2/V3/V4 compatibility constraint", () => {
    expect(expectedCatalog.constraints).toContain(
      "shopping_list_document_v4_compatibility_check",
    )
    expect(expectedCatalog.constraints).not.toContain(
      "shopping_list_document_v2_check",
    )
    expect(expectedCatalog.constraints).not.toContain("shopping_list_document_v3_compatibility_check")
  })

  it("passes controlled catalog and read fixtures", async () => {
    const results = await runChecks(createDatabaseChecks("012_enforce_uuid_active_recipe_writes"), {
      query: fixtureQuery(),
    })
    expect(results.every((result) => result.status === "PASS")).toBe(true)
  })

  it("reports a missing critical object as a named failure", async () => {
    const results = await runChecks(createDatabaseChecks("012_enforce_uuid_active_recipe_writes"), {
      query: fixtureQuery({ missingTable: "recipes" }),
    })
    expect(results.find((result) => result.name === "critical-tables-and-columns")).toMatchObject({
      status: "FAIL",
      detail: "missing tables: recipes",
    })
  })

  it.each([
    { missingConstraint: "shopping_list_document_v4_compatibility_check" },
    { legacyShoppingConstraint: true },
    { missingConstraint: "recipes_recipe_uuid_key" },
  ])("rejects missing current constraints, including a V3-only catalog: %o", async (fixture) => {
    const results = await runChecks(createDatabaseChecks("032_planner_mutation_lock_order"), { query: fixtureQuery(fixture) })
    expect(results.find((result) => result.name === "critical-constraints-and-indexes")).toMatchObject({
      status: "FAIL",
      detail: expect.stringContaining("missing constraints:"),
    })
  })

  it("preserves missing-index detection", async () => {
    const results = await runChecks(createDatabaseChecks("032_planner_mutation_lock_order"), {
      query: fixtureQuery({ missingIndex: "recipe_history_recipe_uuid_idx" }),
    })
    expect(results.find((result) => result.name === "critical-constraints-and-indexes")).toMatchObject({
      status: "FAIL",
      detail: "missing indexes: recipe_history_recipe_uuid_idx",
    })
  })

  it.each([
    null,
    { ...shoppingConstraint, table: "recipes" },
    { ...shoppingConstraint, type: "f" },
    { ...shoppingConstraint, noInherit: true },
    { ...shoppingConstraint, validators: ["private.is_shopping_document_v2", "private.is_shopping_document_v3", "private.is_shopping_document_v4"] },
    { ...shoppingConstraint, expression: "true" },
    { ...shoppingConstraint, expression: "(is_shopping_document_v2(document) OR is_shopping_document_v3(document))" },
    { ...shoppingConstraint, expression: "is_shopping_document_v4(document)" },
    { ...shoppingConstraint, expression: shoppingConstraint.expression.replaceAll(" OR ", " AND ") },
    { ...shoppingConstraint, expression: shoppingConstraint.expression.replaceAll("document)", "other_document)") },
    { ...shoppingConstraint, expression: shoppingConstraint.expression.replaceAll("is_shopping_document_", "private.is_shopping_document_") },
    { ...shoppingConstraint, expression: `${shoppingConstraint.expression} OR true` },
  ])("rejects a named V4 constraint with an incorrect contract: %o", async (documentConstraint) => {
    const results = await runChecks(createDatabaseChecks("032_planner_mutation_lock_order"), {
      query: fixtureQuery({ documentConstraint }),
    })
    expect(results.find((result) => result.name === "critical-constraints-and-indexes")).toMatchObject({
      status: "FAIL",
      detail: expect.stringContaining("incorrect constraints: public.shopping_list.shopping_list_document_v4_compatibility_check"),
    })
  })

  it("accepts PostgreSQL public qualification and whitespace without changing the predicate", async () => {
    const results = await runChecks(createDatabaseChecks("032_planner_mutation_lock_order"), {
      query: fixtureQuery({ documentConstraint: {
        ...shoppingConstraint,
        expression: "( public.is_shopping_document_v2(document)\n OR public.is_shopping_document_v3(document) OR public.is_shopping_document_v4(document) )",
      } }),
    })
    expect(results.every((result) => result.status === "PASS")).toBe(true)
  })
})

describe("production application checks", () => {
  const manifest = {
    gitSha: "6b9bdfeba08db9782f28bc54fae760d279ae4988",
    buildTimestamp: "2026-07-18T12:00:00.000Z",
    applicationVersion: "0.1.0",
    expectedLatestMigration: "012_enforce_uuid_active_recipe_writes",
    expectedSupabaseProjectRef: "eyaoahwzixqetjgfghsh",
  }

  it("passes HTTP, manifest, SHA, and project checks with controlled responses", async () => {
    const fetchImpl = async (url) => new Response(
      url.endsWith("/api/version") ? JSON.stringify(manifest) : "ok",
      { status: 200, headers: { "content-type": url.endsWith("/api/version") ? "application/json" : "text/plain" } },
    )
    const application = createApplicationChecks({
      appUrl: "https://recipes.example.com",
      expectedSha: manifest.gitSha,
      expectedProjectRef: manifest.expectedSupabaseProjectRef,
      databaseUrl: `postgresql://postgres.${manifest.expectedSupabaseProjectRef}:password@pooler.supabase.com/postgres`,
      fetchImpl,
    })
    const results = await runChecks(application.checks, {})
    expect(results.every((result) => result.status === "PASS")).toBe(true)
    expect(application.getManifest()).toEqual(manifest)
  })

  it("fails a mismatched explicitly supplied SHA", async () => {
    const fetchImpl = async (url) => new Response(
      url.endsWith("/api/version") ? JSON.stringify(manifest) : "ok",
      { status: 200 },
    )
    const application = createApplicationChecks({
      appUrl: "https://recipes.example.com",
      expectedSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedProjectRef: manifest.expectedSupabaseProjectRef,
      databaseUrl: `postgresql://postgres.${manifest.expectedSupabaseProjectRef}:password@pooler.supabase.com/postgres`,
      fetchImpl,
    })
    const results = await runChecks(application.checks, {})
    expect(results.find((result) => result.name === "deployed-git-sha")?.status).toBe("FAIL")
  })
})
