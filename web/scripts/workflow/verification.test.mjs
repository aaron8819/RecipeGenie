import { describe, expect, it } from "vitest"
import {
  parseVerificationArgs,
  planFocusedVerification,
  resolveTrustedNpmCli,
  runFocusedVerification,
  runPrVerification,
  runReleaseVerification,
} from "./verification.mjs"

const SHA = "a".repeat(40)

function passingRunner() {
  return { exitCode: 0, stdout: "passed", stderr: "" }
}

function completeReleaseReport(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "PASS",
    binding: {
      repository: "aaron8819/RecipeGenie",
      branch: "main",
      expectedSha: SHA,
      deployedSha: SHA,
      expectedProjectRef: "eyaoahwzixqetjgfghsh",
      deployedProjectRef: "eyaoahwzixqetjgfghsh",
      expectedMigration: "014_add_recipe_yield_metadata",
    },
    checks: [
      "github-repository",
      "branch-head",
      "exact-sha-ci",
      "production-manifest",
      "deployed-sha",
      "supabase-project-ref",
    ].map((name) => ({ name, status: "PASS", authority: "AUTHORITATIVE", detail: "complete" })),
    warnings: [],
    nextAction: "No release action is required.",
    ...overrides,
  }
}

describe("focused verification planning", () => {
  it("selects bounded workflow checks for mapped workflow files", () => {
    const plan = planFocusedVerification([
      "web/scripts/workflow/migration-integrity.mjs",
      "docs/developer-workflow.md",
    ])

    expect(plan.escalated).toBe(false)
    expect(plan.categories).toEqual(["documentation", "workflow"])
    expect(plan.checks.map((item) => item.name)).toEqual([
      "migration-reference-integrity",
      "workflow-unit-tests",
      "workflow-lint",
    ])
  })

  it("escalates an unknown changed-file scope to the PR tier", () => {
    const plan = planFocusedVerification(["web/src/app/page.tsx"])
    expect(plan.escalated).toBe(true)
    expect(plan.detail).toContain("without a safe focused mapping")
    expect(plan.checks.map((item) => item.name)).toEqual([
      "repository-verification",
      "production-build",
      "migration-tooling-tests",
    ])
  })

  it("does not claim focused confidence after escalation", () => {
    const report = runFocusedVerification({
      files: ["web/src/app/page.tsx"],
      commandRunner: passingRunner,
    })
    expect(report).toMatchObject({ status: "PASS", requestedTier: "FOCUSED", effectiveTier: "PR" })
    expect(report.note).toContain("did not claim confidence")
  })

  it("reports an empty explicit scope as skipped", () => {
    const report = runFocusedVerification({
      files: [],
      base: "main",
      commandRunner(command, args) {
        if (command === "git" && args[0] === "rev-parse") return { exitCode: 0, stdout: SHA, stderr: "" }
        if (command === "git") return { exitCode: 0, stdout: "", stderr: "" }
        return passingRunner()
      },
    })
    expect(report.status).toBe("PASS")
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "changed-file-scope", status: "SKIPPED" }))
  })
})

describe("trusted npm execution", () => {
  it("ignores hostile and malformed ambient npm executable variables", () => {
    const originalExecPath = process.env.npm_execpath
    const originalNodeExecPath = process.env.npm_node_execpath
    process.env.npm_execpath = "C:\\hostile\\always-success.js"
    process.env.npm_node_execpath = ""
    try {
      const cli = resolveTrustedNpmCli()
      expect(cli).toMatch(/[\\/]node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/u)
      expect(cli).not.toContain("hostile")
    } finally {
      if (originalExecPath === undefined) delete process.env.npm_execpath
      else process.env.npm_execpath = originalExecPath
      if (originalNodeExecPath === undefined) delete process.env.npm_node_execpath
      else process.env.npm_node_execpath = originalNodeExecPath
    }
  })

  it("invokes every PR check with its intended argument array", () => {
    const calls = []
    const report = runPrVerification({
      commandRunner(command, args, cwd) {
        calls.push({ command, args, cwd })
        return passingRunner()
      },
    })
    expect(report.status).toBe("PASS")
    expect(calls[0].args.slice(-2)).toEqual(["run", "verify"])
    expect(calls[1].args.slice(-2)).toEqual(["run", "build"])
    expect(calls[2].command).toBe("pwsh")
    expect(calls[2].args).toContain("-File")
    expect(calls.every((call) => Array.isArray(call.args))).toBe(true)
  })
})

describe("release verification composition", () => {
  it("accepts one complete, internally consistent PASS report", () => {
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(completeReleaseReport()) }),
    })
    expect(report.status).toBe("PASS")
    expect(report.checks[0].status).toBe("PASS")
  })

  it("classifies explicit optional evidence gaps as unavailable and non-passing", () => {
    const value = completeReleaseReport({
      warnings: ["Optional deployment evidence is unavailable."],
      checks: completeReleaseReport().checks.map((item) => (
        item.name === "exact-sha-ci" ? { ...item, status: "WARN" } : item
      )),
    })
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    expect(report.status).toBe("UNAVAILABLE")
    expect(report.checks[0].status).toBe("UNAVAILABLE")
  })

  it.each([
    ["empty object", "{}"],
    ["array", "[]"],
    ["valid JSON without status", JSON.stringify({ schemaVersion: 1 })],
    ["unknown status", JSON.stringify({ status: "MAYBE" })],
    ["explicit failure at exit zero", JSON.stringify(completeReleaseReport({ status: "ACTION_REQUIRED" }))],
    ["incomplete success", JSON.stringify(completeReleaseReport({ checks: [] }))],
    ["contradictory binding", JSON.stringify(completeReleaseReport({ binding: { ...completeReleaseReport().binding, deployedSha: "b".repeat(40) } }))],
    ["PASS containing failed evidence", JSON.stringify(completeReleaseReport({ checks: completeReleaseReport().checks.map((item, index) => index === 0 ? { ...item, status: "FAIL" } : item) }))],
    ["malformed JSON", "{not-json"],
    ["multiple JSON values", "{}\n{}"],
  ])("rejects %s", (_label, stdout) => {
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout }),
    })
    expect(report.status).toBe("FAIL")
    expect(report.checks[0].status).toBe("FAIL")
  })

  it("rejects a nonzero child even when stdout claims success", () => {
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 2, stderr: "", stdout: JSON.stringify(completeReleaseReport()) }),
    })
    expect(report.status).toBe("FAIL")
  })
})

describe("verification CLI schema", () => {
  it.each([
    [["focused", "--base", "origin/main"], { tier: "focused", base: "origin/main" }],
    [["focused", "--file", "README.md", "--file", "web/scripts/workflow/verification.mjs", "--json"], { tier: "focused", json: true }],
    [["pr", "--json"], { tier: "pr", json: true }],
    [["release", "--repository", "aaron8819/RecipeGenie", "--expected-sha", SHA, "--historical"], { tier: "release" }],
  ])("accepts documented combination %j", (argv, expected) => {
    expect(parseVerificationArgs(argv)).toMatchObject(expected)
  })

  it.each([
    ["unknown option", ["pr", "--wat"]],
    ["duplicate json", ["pr", "--json", "--json"]],
    ["missing value", ["focused", "--base", "--json"]],
    ["malformed ref", ["focused", "--base", "../main"]],
    ["absolute file", ["focused", "--file", "C:\\secret.txt"]],
    ["PR-only option in focused", ["focused", "--pr", "35"]],
    ["release option in PR", ["pr", "--repository", "aaron8819/RecipeGenie"]],
    ["duplicate release value", ["release", "--branch", "main", "--branch", "dev"]],
    ["malformed release repository", ["release", "--repository", "invalid"]],
    ["malformed release SHA", ["release", "--expected-sha", "abc"]],
    ["unsafe production URL", ["release", "--production-url", "http://example.test"]],
    ["malformed project ref", ["release", "--expected-project-ref", "short"]],
    ["positional", ["pr", "unexpected"]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseVerificationArgs(argv)).toThrow()
  })
})
