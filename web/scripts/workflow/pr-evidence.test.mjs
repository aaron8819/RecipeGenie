import { describe, expect, it } from "vitest"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  classifyCheckEvidence,
  classifyDeploymentEvidence,
  collectDeployments,
  collectExactHeadChecks,
  collectReviewRequests,
  collectReviewThreads,
  evaluateHeadConsistency,
  evaluateMergeability,
  githubApiArrayPages,
  parsePrEvidenceArgs,
  recomputeStatus,
  repositoryFromRemoteUrl,
  validateCombinedStatusEndpoint,
} from "./pr-evidence.mjs"

const SHA = "a".repeat(40)
const OTHER_SHA = "b".repeat(40)
const NOW = "2026-07-31T12:00:00Z"

function result(value, exitCode = 0) {
  return { exitCode, stdout: JSON.stringify(value), stderr: "" }
}

function field(args, name) {
  const value = args.find((argument) => String(argument).startsWith(`${name}=`))
  return value ? Number(String(value).slice(name.length + 1)) : null
}

function checkRun(overrides = {}) {
  return {
    id: 1,
    name: "quality",
    status: "completed",
    conclusion: "success",
    headSha: SHA,
    ...overrides,
  }
}

function commitStatus(overrides = {}) {
  return { id: 2, context: "ci", state: "success", sha: SHA, createdAt: NOW, ...overrides }
}

function combinedStatus(overrides = {}) {
  return { sha: SHA, state: "success", totalCount: 1, recordsReturned: 1, ...overrides }
}

function deployment(overrides = {}) {
  return {
    id: 10,
    sha: SHA,
    createdAt: NOW,
    statuses: [{ id: 20, state: "success", createdAt: NOW }],
    ...overrides,
  }
}

describe("PR evidence identity", () => {
  it("derives GitHub repository identity from HTTPS and SSH remotes", () => {
    expect(repositoryFromRemoteUrl("https://github.com/aaron8819/RecipeGenie.git")).toBe("aaron8819/RecipeGenie")
    expect(repositoryFromRemoteUrl("git@github.com:aaron8819/RecipeGenie.git")).toBe("aaron8819/RecipeGenie")
  })

  it("fails explicit head binding when local, remote, or PR heads disagree", () => {
    const value = evaluateHeadConsistency({
      localHead: SHA,
      evidenceHead: SHA,
      upstreamHead: SHA,
      remoteHead: OTHER_SHA,
      prHead: OTHER_SHA,
    })
    expect(value.status).toBe("FAIL")
    expect(value.mismatches).toEqual(["remote", "pullRequest"])
  })
})

describe("exact-head check classification", () => {
  it.each([
    ["successful check lacking headSha", [checkRun({ headSha: null })], [], "malformed/unbound"],
    ["check bound to another SHA", [checkRun({ headSha: OTHER_SHA })], [], "not bound"],
    ["empty check object", [{}], [], "malformed/unbound"],
    ["empty status object", [], [{}], "malformed/unbound"],
    ["status lacking SHA without endpoint binding", [], [commitStatus({ sha: null })], "endpoint", null],
    ["status bound to another SHA", [], [commitStatus({ sha: OTHER_SHA })], "not bound"],
    ["pending check", [checkRun({ status: "in_progress", conclusion: null })], [], "pending"],
    ["failed check", [checkRun({ conclusion: "failure" })], [], "failed"],
    ["unknown lifecycle", [checkRun({ status: "mystery" })], [], "malformed/unbound"],
    ["unknown conclusion", [checkRun({ conclusion: "maybe" })], [], "malformed/unbound"],
    ["unknown commit state", [], [commitStatus({ state: "maybe" })], "malformed/unbound"],
  ])("rejects %s", (_label, checkRuns, statuses, detail, endpoint = combinedStatus()) => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: checkRuns.length,
      checkRuns,
      statuses,
      statusEndpoint: endpoint,
    })).toMatchObject({ status: "FAIL", detail: expect.stringContaining(detail) })
  })

  it("passes valid exact-head check and commit-status records", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 1,
      checkRuns: [checkRun()],
      statuses: [commitStatus()],
      statusEndpoint: combinedStatus(),
    })).toMatchObject({ status: "PASS" })
  })

  it("accepts a status without a record SHA only when a validated exact-SHA endpoint binds the response", () => {
    const value = classifyCheckEvidence({
      expectedSha: SHA,
      statusEndpoint: combinedStatus(),
      totalCount: 0,
      checkRuns: [],
      statuses: [commitStatus({ sha: null })],
    })
    expect(value.status).toBe("PASS")
  })

  it("fails a mixture of valid and malformed records", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 2,
      checkRuns: [checkRun(), {}],
      statuses: [commitStatus()],
      statusEndpoint: combinedStatus(),
    }).status).toBe("FAIL")
  })

  it("reports missing evidence as unavailable", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 0,
      checkRuns: [],
      statuses: [],
      statusEndpoint: combinedStatus({ totalCount: 0, recordsReturned: 0, state: "pending" }),
    })).toMatchObject({ status: "UNAVAILABLE" })
  })

  it.each([
    ["exact returned SHA", combinedStatus(), "PASS"],
    ["another SHA", combinedStatus({ sha: OTHER_SHA }), "FAIL"],
    ["missing SHA", combinedStatus({ sha: null }), "FAIL"],
    ["malformed SHA", combinedStatus({ sha: "abc" }), "FAIL"],
    ["unknown state", combinedStatus({ state: "mystery" }), "FAIL"],
    ["malformed response", null, "FAIL"],
  ])("validates combined-status endpoint binding for %s", (_label, endpoint, status) => {
    expect(validateCombinedStatusEndpoint(endpoint, SHA).status).toBe(status)
  })

  it("rejects a conflicting explicit status SHA even with a valid enclosing binding", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 0,
      checkRuns: [],
      statuses: [commitStatus({ sha: OTHER_SHA })],
      statusEndpoint: combinedStatus(),
    }).status).toBe("FAIL")
  })
})

describe("bounded REST pagination", () => {
  it.each([
    "check annotations",
    "commit statuses",
    "deployments",
    "deployment statuses",
    "reviews",
    "top-level comments",
    "inline comments",
    "PR files",
  ])("collects %s evidence appearing only on page 2", (label) => {
    const runner = (_command, args) => {
      const page = field(args, "page")
      const values = page === 1
        ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
        : page === 2 ? [{ id: 101, relevant: true }] : []
      return result(values)
    }
    const values = githubApiArrayPages(runner, "example", [], label)
    expect(values).toHaveLength(101)
    expect(values.at(-1)).toMatchObject({ relevant: true })
  })

  it("fails when a later page request fails", () => {
    const runner = (_command, args) => field(args, "page") === 1
      ? result(Array.from({ length: 100 }, (_, id) => ({ id })))
      : result({}, 1)
    expect(() => githubApiArrayPages(runner, "example")).toThrow(/query failed/iu)
  })

  it("fails repeated and malformed pagination", () => {
    const repeated = Array.from({ length: 100 }, (_, id) => ({ id }))
    expect(() => githubApiArrayPages(() => result(repeated), "example")).toThrow(/repeated/iu)
    expect(() => githubApiArrayPages(() => result({}), "example")).toThrow(/malformed/iu)
  })
})

describe("check and annotation collection", () => {
  it("paginates annotations and commit statuses without inserting the requested SHA", () => {
    const runner = (_command, args) => {
      const endpoint = args[3]
      const page = field(args, "page")
      if (endpoint.endsWith("/check-runs")) {
        return result({
          total_count: 1,
          check_runs: [{ id: 1, name: "quality", status: "completed", conclusion: "success", head_sha: SHA }],
        })
      }
      if (endpoint.endsWith("/status")) {
        return result({ sha: SHA, state: "success", total_count: 1, statuses: [{}] })
      }
      if (endpoint.endsWith("/annotations")) {
        return result(page === 1
          ? Array.from({ length: 100 }, (_, index) => ({
            path: `file-${index}`,
            start_line: 1,
            end_line: 1,
            annotation_level: "warning",
            message: "fixture",
          }))
          : page === 2 ? [{
            path: "page-two",
            start_line: 2,
            end_line: 2,
            annotation_level: "failure",
            message: "relevant",
          }] : [])
      }
      if (endpoint.endsWith("/statuses")) {
        return result(page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, context: `status-${index}`, state: "success", sha: SHA, created_at: NOW }))
          : page === 2 ? [{ id: 101, context: "missing-sha", state: "success", created_at: NOW }] : [])
      }
      throw new Error(`Unexpected endpoint ${endpoint}`)
    }
    const evidence = collectExactHeadChecks(runner, "aaron8819/RecipeGenie", SHA)
    expect(evidence.checkRuns[0].annotations).toHaveLength(101)
    expect(evidence.statuses).toHaveLength(101)
    expect(evidence.statuses.at(-1).sha).toBeNull()
    expect(evidence.statusEndpoint.sha).toBe(SHA)
    expect(evidence.statusEndpointBinding).toMatchObject({ status: "PASS", returnedSha: SHA })
    expect(classifyCheckEvidence({ ...evidence, expectedSha: SHA }).status).toBe("PASS")
  })

  it("rejects an unavailable combined-status endpoint before collecting synthetic bindings", () => {
    const runner = (_command, args) => args[3].endsWith("/status")
      ? result({}, 1)
      : result([])
    expect(() => collectExactHeadChecks(
      runner,
      "aaron8819/RecipeGenie",
      SHA,
    )).toThrow(/query failed/iu)
  })

  it("never copies the requested SHA into a combined response that omits it", () => {
    const response = { sha: null, state: "success", total_count: 0, statuses: [] }
    const runner = (_command, args) => args[3].endsWith("/status")
      ? result(response)
      : result([])
    expect(() => collectExactHeadChecks(
      runner,
      "aaron8819/RecipeGenie",
      SHA,
    )).toThrow(/missing its own SHA/iu)
    expect(response.sha).toBeNull()
  })

  it("uses the latest validated status per context without hiding history", () => {
    const value = classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 0,
      checkRuns: [],
      statuses: [
        commitStatus({ id: 1, state: "pending", createdAt: "2026-07-31T10:00:00Z" }),
        commitStatus({ id: 2, state: "success", createdAt: "2026-07-31T10:01:00Z" }),
      ],
      statusEndpoint: combinedStatus(),
    })
    expect(value).toMatchObject({ status: "PASS", detail: expect.stringContaining("2 status-history") })
  })
})

describe("required evidence policy", () => {
  it.each([
    ["all required pass", [{ status: "PASS", required: true }], "PASS"],
    ["required skipped", [{ status: "PASS", required: true }, { status: "SKIPPED", required: true }], "UNAVAILABLE"],
    ["required unavailable", [{ status: "UNAVAILABLE", required: true }], "UNAVAILABLE"],
    ["required failure", [{ status: "FAIL", required: true }], "FAIL"],
    ["optional skipped", [{ status: "PASS", required: true }, { status: "SKIPPED", required: false }], "PASS"],
  ])("computes %s", (_label, checks, status) => {
    const report = { status: "PASS", checks }
    recomputeStatus(report)
    expect(report.status).toBe(status)
  })
})

describe("mergeability schema", () => {
  it.each([
    ["missing mergeable", { mergeable_state: "clean" }, "FAIL"],
    ["missing state", { mergeable: true }, "FAIL"],
    ["both missing", {}, "FAIL"],
    ["null fields", { mergeable: null, mergeable_state: null }, "FAIL"],
    ["string boolean", { mergeable: "true", mergeable_state: "clean" }, "FAIL"],
    ["unknown state", { mergeable: true, mergeable_state: "mystery" }, "FAIL"],
    ["conflicting combination", { mergeable: false, mergeable_state: "clean" }, "FAIL"],
    ["pending computation", { mergeable: null, mergeable_state: "unknown" }, "UNAVAILABLE"],
    ["dirty", { mergeable: false, mergeable_state: "dirty" }, "FAIL"],
    ["blocked", { mergeable: true, mergeable_state: "blocked" }, "FAIL"],
    ["valid clean", { mergeable: true, mergeable_state: "clean" }, "PASS"],
  ])("classifies %s", (_label, value, status) => {
    expect(evaluateMergeability(value).status).toBe(status)
  })
})

describe("GraphQL and review-request pagination", () => {
  it("paginates review threads by validated cursor", () => {
    const runner = (_command, args) => {
      const second = args.some((argument) => argument === "cursor=next")
      return result({ data: { repository: { pullRequest: { reviewThreads: second
        ? { totalCount: 101, nodes: [{ id: "T101", isResolved: true }], pageInfo: { hasNextPage: false, endCursor: null } }
        : { totalCount: 101, nodes: Array.from({ length: 100 }, (_, index) => ({ id: `T${index + 1}`, isResolved: true })), pageInfo: { hasNextPage: true, endCursor: "next" } }
      } } } })
    }
    expect(collectReviewThreads(runner, "aaron8819/RecipeGenie", 35).nodes).toHaveLength(101)
  })

  it("rejects a repeated review-thread cursor", () => {
    const runner = () => result({ data: { repository: { pullRequest: { reviewThreads: {
      totalCount: 200,
      nodes: Array.from({ length: 100 }, (_, index) => ({ id: `T${index}` })),
      pageInfo: { hasNextPage: true, endCursor: "same" },
    } } } } })
    expect(() => collectReviewThreads(runner, "aaron8819/RecipeGenie", 35)).toThrow(/repeated/iu)
  })

  it("paginates current review requests", () => {
    const runner = (_command, args) => result(field(args, "page") === 1
      ? { users: Array.from({ length: 100 }, (_, id) => ({ id: id + 1, login: `user-${id + 1}` })), teams: [] }
      : { users: [{ id: 101, login: "user-101" }], teams: [] })
    expect(collectReviewRequests(runner, "aaron8819/RecipeGenie", 35).users).toHaveLength(101)
  })
})

describe("deployment evidence", () => {
  it.each([
    ["no deployment", [], "SKIPPED", "SKIPPED"],
    ["deployment with no status", [deployment({ statuses: [] })], "PASS", "UNAVAILABLE"],
    ["pending latest status", [deployment({ statuses: [{ id: 20, state: "pending", createdAt: NOW }] })], "PASS", "FAIL"],
    ["failed latest status", [deployment({ statuses: [{ id: 20, state: "failure", createdAt: NOW }] })], "PASS", "FAIL"],
    ["exact-head success", [deployment()], "PASS", "PASS"],
    ["success for another SHA", [deployment({ sha: OTHER_SHA })], "FAIL", "PASS"],
    ["malformed status", [deployment({ statuses: [{}] })], "PASS", "FAIL"],
  ])("classifies %s", (_label, deployments, binding, outcome) => {
    expect(classifyDeploymentEvidence(deployments, SHA)).toMatchObject({
      binding: { status: binding },
      outcome: { status: outcome },
    })
  })

  it("uses the newest deployment and newest status, so prior success cannot hide a later failure", () => {
    const evidence = classifyDeploymentEvidence([
      deployment({ id: 9, createdAt: "2026-07-31T10:00:00Z" }),
      deployment({
        id: 10,
        createdAt: "2026-07-31T11:00:00Z",
        statuses: [
          { id: 19, state: "success", createdAt: "2026-07-31T11:01:00Z" },
          { id: 20, state: "failure", createdAt: "2026-07-31T11:02:00Z" },
        ],
      }),
    ], SHA)
    expect(evidence.latestDeployment.id).toBe(10)
    expect(evidence.latestStatus.state).toBe("failure")
    expect(evidence.outcome.status).toBe("FAIL")
  })

  it("paginates more than 100 deployments and every deployment status", () => {
    const runner = (_command, args) => {
      const endpoint = args[3]
      const page = field(args, "page")
      if (endpoint.endsWith("/deployments")) {
        const items = page === 1
          ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, sha: SHA, created_at: NOW }))
          : page === 2 ? [{ id: 101, sha: SHA, created_at: NOW }] : []
        return result(items)
      }
      const id = Number(endpoint.match(/deployments\/(\d+)\/statuses$/u)?.[1])
      return result(page === 1 ? [{ id: id + 1000, state: "success", created_at: NOW }] : [])
    }
    const values = collectDeployments(runner, "aaron8819/RecipeGenie", SHA)
    expect(values).toHaveLength(101)
    expect(values.every((item) => item.statuses.length === 1)).toBe(true)
  })
})

describe("PR evidence CLI schema", () => {
  it.each([
    [[], {}],
    [["--json"], { json: true }],
    [["--local-only", "--json"], { localOnly: true, json: true }],
    [["--repository", "aaron8819/RecipeGenie", "--pr", "35", "--head-sha", SHA], { prNumber: 35, headSha: SHA }],
  ])("accepts documented combination %j", (argv, expected) => {
    expect(parsePrEvidenceArgs(argv)).toMatchObject(expected)
  })

  it.each([
    ["unknown option", ["--wat"]],
    ["duplicate json", ["--json", "--json"]],
    ["repeated PR", ["--pr", "35", "--pr", "36"]],
    ["missing value", ["--pr", "--json"]],
    ["malformed PR", ["--pr", "1e2"]],
    ["malformed repository", ["--repository", "not-a-repo"]],
    ["malformed SHA", ["--head-sha", "abc"]],
    ["local/PR conflict", ["--local-only", "--pr", "35"]],
    ["local/GitHub conflict", ["--local-only", "--repository", "aaron8819/RecipeGenie"]],
    ["positional", ["unexpected"]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parsePrEvidenceArgs(argv)).toThrow()
  })

  it.each([
    ["unknown option", ["--json", "--wat"]],
    ["duplicate json", ["--json", "--json"]],
    ["missing value", ["--json", "--pr"]],
    ["conflicting options", ["--json", "--local-only", "--pr", "35"]],
    ["positional", ["--json", "unexpected"]],
    ["malformed PR", ["--json", "--pr", "1e2"]],
    ["malformed SHA", ["--json", "--head-sha", "abc"]],
  ])("emits one JSON error document for %s", (_label, args) => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "pr-evidence.mjs")
    const child = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      shell: false,
    })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toBe("")
    const document = JSON.parse(child.stdout)
    expect(document).toMatchObject({
      schemaVersion: 1,
      command: "pr-evidence",
      status: "FAIL",
      error: { category: "ARGUMENT" },
    })
    expect(child.stdout.trim().split(/\n(?=\s*\{)/u)).toHaveLength(1)
  })

  it("emits one JSON runtime error after successful parsing", () => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "pr-evidence.mjs")
    const env = Object.fromEntries(Object.entries(process.env).filter(
      ([key]) => key.toLowerCase() !== "path",
    ))
    env[process.platform === "win32" ? "Path" : "PATH"] = dirname(process.execPath)
    const child = spawnSync(process.execPath, [script, "--json", "--local-only"], {
      encoding: "utf8",
      shell: false,
      env,
    })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toBe("")
    expect(JSON.parse(child.stdout)).toMatchObject({
      command: "pr-evidence",
      status: "FAIL",
      error: { code: "RUNTIME_ERROR", category: "RUNTIME" },
    })
  })
})
