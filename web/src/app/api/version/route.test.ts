import { afterEach, describe, expect, it } from "vitest"
import { EXPECTED_LATEST_MIGRATION } from "@/lib/deployment-manifest"
import { GET } from "./route"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("GET /api/version", () => {
  it("returns only the public deployment manifest", async () => {
    process.env.RECIPE_GENIE_GIT_SHA = "6b9bdfe"
    process.env.RECIPE_GENIE_BUILD_TIMESTAMP = "2026-07-18T12:00:00.000Z"
    process.env.RECIPE_GENIE_APP_VERSION = "0.1.0"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "must-not-leak"
    process.env.DATABASE_URL = "postgresql://secret:secret@example.invalid/db"

    const response = GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("immutable")
    expect(await response.json()).toEqual({
      gitSha: "6b9bdfe",
      buildTimestamp: "2026-07-18T12:00:00.000Z",
      applicationVersion: "0.1.0",
      expectedLatestMigration: EXPECTED_LATEST_MIGRATION,
      expectedSupabaseProjectRef: "eyaoahwzixqetjgfghsh",
    })
  })
})
