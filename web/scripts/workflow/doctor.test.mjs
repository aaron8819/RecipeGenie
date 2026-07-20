import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

describe("workflow doctor command", () => {
  it("does not echo a credential-bearing malformed argument", () => {
    const credentialUrl = "postgresql://fixture-user:fixture-password@example.invalid/postgres"
    const result = spawnSync(process.execPath, ["scripts/workflow/doctor.mjs", credentialUrl], {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    })
    const output = `${result.stdout || ""}${result.stderr || ""}`
    expect(result.status).toBe(2)
    expect(output).toContain("STATUS: BLOCKED")
    expect(output).not.toContain(credentialUrl)
    expect(output).not.toContain("fixture-user")
    expect(output).not.toContain("fixture-password")
  })
})
