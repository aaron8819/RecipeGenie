import { describe, expect, it } from "vitest"
import {
  planFocusedVerification,
  runFocusedVerification,
  runReleaseVerification,
} from "./verification.mjs"

function passingRunner(command, args) {
  if (args.some((argument) => String(argument).endsWith("release-status.mjs"))) {
    return { exitCode: 0, stdout: "{}", stderr: "" }
  }
  return { exitCode: 0, stdout: "passed", stderr: "" }
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
    const plan = planFocusedVerification([
      "web/src/app/page.tsx",
    ])

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

    expect(report.status).toBe("PASS")
    expect(report.requestedTier).toBe("FOCUSED")
    expect(report.effectiveTier).toBe("PR")
    expect(report.note).toContain("did not claim confidence")
  })

  it("reports an empty explicit scope as skipped", () => {
    const report = runFocusedVerification({
      files: [],
      base: "main",
      commandRunner(command, args) {
        if (command === "git" && args[0] === "rev-parse") {
          return { exitCode: 0, stdout: "a".repeat(40), stderr: "" }
        }
        if (command === "git") return { exitCode: 0, stdout: "", stderr: "" }
        return passingRunner(command, args)
      },
    })

    expect(report.status).toBe("PASS")
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "changed-file-scope",
      status: "SKIPPED",
    }))
  })
})

describe("release verification composition", () => {
  it("classifies missing external release evidence as unavailable", () => {
    const report = runReleaseVerification({
      args: [],
      commandRunner() {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            status: "PASS",
            warnings: ["Optional deployment evidence is unavailable."],
            checks: [{ status: "WARN" }],
          }),
        }
      },
    })

    expect(report.status).toBe("PASS")
    expect(report.checks[0].status).toBe("UNAVAILABLE")
  })

  it("returns failure when release status requires action", () => {
    const report = runReleaseVerification({
      commandRunner() {
        return {
          exitCode: 1,
          stderr: "",
          stdout: JSON.stringify({
            status: "ACTION_REQUIRED",
            nextAction: "Supply release inputs.",
          }),
        }
      },
    })

    expect(report.status).toBe("FAIL")
    expect(report.checks[0]).toMatchObject({
      name: "release-status",
      status: "FAIL",
      detail: "Supply release inputs.",
    })
  })
})
