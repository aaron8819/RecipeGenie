import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  classifyPreflightResult,
  formatProcessDiagnostics,
  preflightResultMatchesExpectation,
} from "./run-migration014-preflight-parity.mjs"

const result = (overrides = {}) => ({
  error: undefined,
  signal: null,
  status: 1,
  stdout: "",
  stderr: "",
  ...overrides,
})

describe("migration 014 preflight result classification", () => {
  it("accepts a singular migration 014 validation rejection", () => {
    const validationFailure = result({
      stderr:
        "ERROR:  pending recipe-share rational metadata is incompatible with migration 014 validation\n",
    })

    expect(classifyPreflightResult(validationFailure)).toBe(
      "expected-validation-rejection"
    )
    expect(preflightResultMatchesExpectation(validationFailure, false)).toBe(true)
  })

  it("accepts a plural migration 014 validation rejection", () => {
    const validationFailure = result({
      stderr:
        "ERROR:  pending recipe-share quantities are incompatible with migration 014 validation\n",
    })

    expect(classifyPreflightResult(validationFailure)).toBe(
      "expected-validation-rejection"
    )
    expect(preflightResultMatchesExpectation(validationFailure, false)).toBe(true)
  })

  it.each([
    "ERROR:  pending recipe-share audit metadata is incompatible with migration 014 validation\n",
    "ERROR:  rational metadata is incompatible with migration 014 validation\n",
    "ERROR:  pending recipe-share rational metadata are incompatible with migration 014 validation\n",
  ])("rejects an unrelated error with similar language", (stderr) => {
    const unrelatedFailure = result({ stderr })

    expect(classifyPreflightResult(unrelatedFailure)).toBe("unexpected-failure")
    expect(preflightResultMatchesExpectation(unrelatedFailure, false)).toBe(false)
  })

  it.each([
    "ERROR: syntax error at or near test\n",
    "ERROR: division by zero\n",
    "ERROR: permission denied for schema private\n",
  ])("rejects a SQL or permission failure", (stderr) => {
    const sqlFailure = spawnSync(
      process.execPath,
      ["-e", `process.stderr.write(${JSON.stringify(stderr)}); process.exit(3)`],
      { encoding: "utf8" }
    )

    expect(classifyPreflightResult(sqlFailure)).toBe("unexpected-failure")
    expect(preflightResultMatchesExpectation(sqlFailure, false)).toBe(false)
  })

  it.each([
    'psql: error: connection to server at "127.0.0.1", port 5432 failed: Connection refused\n',
    "error during connect: this error may indicate that the docker daemon is not running\n",
  ])("rejects an infrastructure or connection failure", (stderr) => {
    const infrastructureFailure = result({ status: 2, stderr })

    expect(classifyPreflightResult(infrastructureFailure)).toBe(
      "unexpected-failure"
    )
    expect(preflightResultMatchesExpectation(infrastructureFailure, false)).toBe(
      false
    )
  })

  it("rejects unexpected success for a negative fixture", () => {
    const success = result({ status: 0 })

    expect(preflightResultMatchesExpectation(success, false)).toBe(false)
  })

  it("rejects a nonzero exit for a positive fixture", () => {
    const validationFailure = result({
      stderr:
        "ERROR:  pending recipe-share snapshots are incompatible with migration 014 validation\n",
    })

    expect(preflightResultMatchesExpectation(validationFailure, true)).toBe(false)
  })

  it("requires a clean process exit for a positive fixture", () => {
    expect(preflightResultMatchesExpectation(result({ status: 0 }), true)).toBe(
      true
    )
    expect(
      classifyPreflightResult(
        result({
          signal: "SIGTERM",
          status: null,
          stderr:
            "ERROR:  pending recipe-share units are incompatible with migration 014 validation\n",
        })
      )
    ).toBe("process-failure")
    expect(
      classifyPreflightResult(
        result({ error: new Error("spawn failed"), status: null })
      )
    ).toBe("process-failure")
  })

  it("preserves stdout and stderr in failure diagnostics", () => {
    const diagnostics = formatProcessDiagnostics(
      result({ status: 3, stdout: "query output", stderr: "query error" })
    )

    expect(diagnostics).toContain("status=3")
    expect(diagnostics).toContain("stdout:\nquery output")
    expect(diagnostics).toContain("stderr:\nquery error")
  })
})
