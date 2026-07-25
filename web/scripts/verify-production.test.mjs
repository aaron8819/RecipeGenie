import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const SHA = "7ebbad86970bee4389fe870df260ca126132637b"
const PROJECT_REF = "eyaoahwzixqetjgfghsh"
const DATABASE_URL = `postgresql://postgres.${PROJECT_REF}:fixture@pooler.supabase.com:5432/postgres`

function runVerify(overrides = {}) {
  const values = {
    appUrl: "https://recipe-genie.example",
    expectedSha: SHA,
    ...overrides,
  }
  return spawnSync(process.execPath, [
    "scripts/verify-production.mjs",
    "--app-url", values.appUrl,
    "--expected-sha", values.expectedSha,
    "--expected-project-ref", PROJECT_REF,
    "--database-url", DATABASE_URL,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  })
}

describe("verify production command configuration", () => {
  it.each([
    { expectedSha: "7ebbad8" },
    { appUrl: "http://recipe-genie.example" },
    { appUrl: "https://recipe-genie.example/path" },
    { appUrl: "https://recipe-genie.example?query=1" },
    { appUrl: "https://recipe-genie.example#fragment" },
    { appUrl: "https://user:password@recipe-genie.example" },
  ])("rejects an incomplete or unsafe production target before network access: %o", (target) => {
    const result = runVerify(target)
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/Configuration error:/)
  })
})
