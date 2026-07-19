import { readdirSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  EXPECTED_LATEST_MIGRATION,
  EXPECTED_SUPABASE_PROJECT_REF,
  getDeploymentManifest,
  parseDeploymentManifest,
} from "@/lib/deployment-manifest"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("deployment manifest", () => {
  it("tracks the latest checked-in migration", () => {
    const migrationsDirectory = resolve(process.cwd(), "../supabase/migrations")
    const latestMigration = readdirSync(migrationsDirectory)
      .filter((fileName) => /^\d{3}_[a-z0-9_]+\.sql$/.test(fileName))
      .sort()
      .at(-1)
      ?.replace(/\.sql$/, "")

    expect(EXPECTED_LATEST_MIGRATION).toBe(latestMigration)
    expect(EXPECTED_LATEST_MIGRATION).not.toBe("012_enforce_uuid_active_recipe_writes")
  })

  it("parses a complete build manifest", () => {
    expect(parseDeploymentManifest({
      gitSha: "6b9bdfeba08db9782f28bc54fae760d279ae4988",
      buildTimestamp: "2026-07-18T12:00:00.000Z",
      applicationVersion: "0.1.0",
      expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
      expectedSupabaseProjectRef: EXPECTED_SUPABASE_PROJECT_REF,
    })).toMatchObject({ gitSha: "6b9bdfeba08db9782f28bc54fae760d279ae4988" })
  })

  it("accepts missing optional local-development metadata", () => {
    const manifest = parseDeploymentManifest({
      gitSha: null,
      buildTimestamp: null,
      applicationVersion: "0.1.0",
      expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
      expectedSupabaseProjectRef: EXPECTED_SUPABASE_PROJECT_REF,
    })

    expect(manifest.gitSha).toBeNull()
    expect(manifest.buildTimestamp).toBeNull()
  })

  it("rejects malformed or incomplete manifests", () => {
    expect(() => parseDeploymentManifest({ applicationVersion: "secret" })).toThrow()
    expect(() => parseDeploymentManifest({
      gitSha: "not-a-sha",
      buildTimestamp: "yesterday",
      applicationVersion: "0.1.0",
      expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
      expectedSupabaseProjectRef: EXPECTED_SUPABASE_PROJECT_REF,
    })).toThrow(/Git SHA/)
  })

  it("reads immutable build environment values", () => {
    process.env.RECIPE_GENIE_GIT_SHA = "6b9bdfe"
    process.env.RECIPE_GENIE_BUILD_TIMESTAMP = "2026-07-18T12:00:00.000Z"
    process.env.RECIPE_GENIE_APP_VERSION = "0.1.0"

    expect(getDeploymentManifest()).toEqual({
      gitSha: "6b9bdfe",
      buildTimestamp: "2026-07-18T12:00:00.000Z",
      applicationVersion: "0.1.0",
      expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
      expectedSupabaseProjectRef: EXPECTED_SUPABASE_PROJECT_REF,
    })
  })
})
