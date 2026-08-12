import { describe, expect, it } from "vitest"
import { createApplicationChecks, createDatabaseChecks, expectedCatalog } from "./production-checks.mjs"
import { runChecks } from "./runtime.mjs"

function fixtureQuery({ missingTable } = {}) {
  return async (sql, parameters = []) => {
    if (sql.includes("transaction_read_only")) return [{ read_only: "on" }]
    if (sql.includes("to_regclass('supabase_migrations.schema_migrations')")) return [{ relation: "supabase_migrations.schema_migrations" }]
    if (sql.includes("limit 0")) return []
    if (sql.includes("max(version)")) return [{ latest: parameters[0], matches: 1 }]
    if (sql.includes("as catalog")) return [{
      catalog: {
        ...expectedCatalog,
        tables: expectedCatalog.tables.filter((table) => table !== missingTable),
      },
    }]
    if (sql.includes("as retired")) return [{ retired: { recipe_audits: null, legacy_made_rpc: null, obsolete_uuid_text_rpc: null } }]
    if (sql.includes("limit 1")) return []
    throw new Error(`unexpected fixture query: ${sql}`)
  }
}

describe("production database checks", () => {
  it("expects the Shopping V2/V3 compatibility constraint", () => {
    expect(expectedCatalog.constraints).toContain(
      "shopping_list_document_v3_compatibility_check",
    )
    expect(expectedCatalog.constraints).not.toContain(
      "shopping_list_document_v2_check",
    )
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
