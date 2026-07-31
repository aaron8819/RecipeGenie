import { describe, expect, it } from "vitest"
import {
  classifyCheckEvidence,
  classifyDeploymentEvidence,
  collectDeployments,
  collectExactHeadChecks,
  collectReviewRequests,
  collectReviewThreads,
  evaluateHeadConsistency,
  githubApiArrayPages,
  parsePrEvidenceArgs,
  repositoryFromRemoteUrl,
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
    ["status lacking SHA", [], [commitStatus({ sha: null })], "malformed/unbound"],
    ["status bound to another SHA", [], [commitStatus({ sha: OTHER_SHA })], "not bound"],
    ["pending check", [checkRun({ status: "in_progress", conclusion: null })], [], "pending"],
    ["failed check", [checkRun({ conclusion: "failure" })], [], "failed"],
    ["unknown lifecycle", [checkRun({ status: "mystery" })], [], "malformed/unbound"],
    ["unknown conclusion", [checkRun({ conclusion: "maybe" })], [], "malformed/unbound"],
    ["unknown commit state", [], [commitStatus({ state: "maybe" })], "malformed/unbound"],
  ])("rejects %s", (_label, checkRuns, statuses, detail) => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: checkRuns.length,
      checkRuns,
      statuses,
    })).toMatchObject({ status: "FAIL", detail: expect.stringContaining(detail) })
  })

  it("passes valid exact-head check and commit-status records", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 1,
      checkRuns: [checkRun()],
      statuses: [commitStatus()],
    })).toMatchObject({ status: "PASS" })
  })

  it("accepts a status without a record SHA only when a validated exact-SHA endpoint binds the response", () => {
    const value = classifyCheckEvidence({
      expectedSha: SHA,
      statusEndpointSha: SHA,
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
    }).status).toBe("FAIL")
  })

  it("reports missing evidence as unavailable", () => {
    expect(classifyCheckEvidence({ totalCount: 0, checkRuns: [], statuses: [] })).toMatchObject({ status: "UNAVAILABLE" })
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
    expect(classifyCheckEvidence({ ...evidence, expectedSha: SHA }).status).toBe("PASS")
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
    })
    expect(value).toMatchObject({ status: "PASS", detail: expect.stringContaining("2 status-history") })
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
})
