import { describe, expect, it } from "vitest"
import {
  assertReadOnlySql,
  assertDatabaseEndpointPolicy,
  classifyDatabaseEndpoint,
  databaseUrlMatchesProject,
  parseArgs,
  parsePublicManifest,
  runChecks,
} from "./runtime.mjs"

describe("operational runtime", () => {
  it("parses explicit CLI configuration", () => {
    expect(parseArgs(["--app-url", "https://example.com", "--json", "--sample-limit=5"])).toEqual({
      "app-url": "https://example.com",
      json: true,
      "sample-limit": "5",
    })
  })

  it("rejects every non-read-only statement", () => {
    expect(() => assertReadOnlySql("select 1")).not.toThrow()
    expect(() => assertReadOnlySql("with value as (select 1) select * from value")).not.toThrow()
    expect(() => assertReadOnlySql("update recipes set name = 'x'")).toThrow(/SELECT/)
    expect(() => assertReadOnlySql("select 1; delete from recipes")).toThrow(/one SELECT/)
    expect(() => assertReadOnlySql("with removed as (delete from recipes returning *) select * from removed")).toThrow(/one SELECT/)
  })

  it("validates public manifests without accepting secret-shaped extras as requirements", () => {
    expect(parsePublicManifest({
      gitSha: null,
      buildTimestamp: null,
      applicationVersion: "0.1.0",
      expectedLatestMigration: "012_enforce_uuid_active_recipe_writes",
      expectedSupabaseProjectRef: "eyaoahwzixqetjgfghsh",
    }).applicationVersion).toBe("0.1.0")
  })

  it("matches direct and pooler Supabase database identities", () => {
    const ref = "eyaoahwzixqetjgfghsh"
    expect(databaseUrlMatchesProject(`postgresql://postgres:pw@db.${ref}.supabase.co/postgres`, ref)).toBe(true)
    expect(databaseUrlMatchesProject(`postgresql://postgres.${ref}:pw@aws-0-us.pooler.supabase.com/postgres`, ref)).toBe(true)
    expect(databaseUrlMatchesProject("postgresql://postgres:pw@localhost/postgres", ref)).toBe(false)
    expect(databaseUrlMatchesProject(`postgresql://postgres.${ref}:pw@example.invalid/postgres`, ref)).toBe(false)
  })

  it("prohibits transaction pooling and requires explicit session-pooler authorization", () => {
    const ref = "eyaoahwzixqetjgfghsh"
    const direct = `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`
    const session = `postgresql://postgres.${ref}:pw@aws-0-us.pooler.supabase.com:5432/postgres`
    const transaction = `postgresql://postgres.${ref}:pw@aws-0-us.pooler.supabase.com:6543/postgres`

    expect(classifyDatabaseEndpoint(direct)).toBe("direct")
    expect(() => assertDatabaseEndpointPolicy(transaction)).toThrow(/transaction pooler/)
    expect(() => assertDatabaseEndpointPolicy(session)).toThrow(/explicit/)
    expect(assertDatabaseEndpointPolicy(session, { allowSessionPooler: true })).toBe("session-pooler")
  })

  it("records named PASS, FAIL, and SKIP checks deterministically", async () => {
    const results = await runChecks([
      { name: "pass", run: async () => "done" },
      { name: "fail", run: async () => { throw new Error("broken") } },
      { name: "skip", skip: "not configured" },
    ], {})
    expect(results.map((result) => result.status)).toEqual(["PASS", "FAIL", "SKIP"])
  })
})
