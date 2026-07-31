import { describe, expect, it } from "vitest"
import {
  classifyCheckEvidence,
  evaluateHeadConsistency,
  repositoryFromRemoteUrl,
} from "./pr-evidence.mjs"

const SHA = "a".repeat(40)
const OTHER_SHA = "b".repeat(40)

describe("PR evidence identity", () => {
  it("derives GitHub repository identity from HTTPS and SSH remotes", () => {
    expect(repositoryFromRemoteUrl(
      "https://github.com/aaron8819/RecipeGenie.git",
    )).toBe("aaron8819/RecipeGenie")
    expect(repositoryFromRemoteUrl(
      "git@github.com:aaron8819/RecipeGenie.git",
    )).toBe("aaron8819/RecipeGenie")
  })

  it("fails explicit head binding when local, remote, or PR heads disagree", () => {
    const result = evaluateHeadConsistency({
      localHead: SHA,
      evidenceHead: SHA,
      upstreamHead: SHA,
      remoteHead: OTHER_SHA,
      prHead: OTHER_SHA,
    })

    expect(result.status).toBe("FAIL")
    expect(result.mismatches).toEqual(["remote", "pullRequest"])
    expect(result.detail).toContain(SHA)
  })

  it("passes when every available head matches the explicit SHA", () => {
    expect(evaluateHeadConsistency({
      localHead: SHA,
      evidenceHead: SHA,
      upstreamHead: null,
      remoteHead: SHA,
      prHead: SHA,
    })).toMatchObject({
      status: "PASS",
      mismatches: [],
    })
  })
})

describe("exact-head check classification", () => {
  it("does not mislabel pending checks as successful", () => {
    expect(classifyCheckEvidence({
      totalCount: 1,
      checkRuns: [{ status: "in_progress", conclusion: null }],
      statuses: [],
    })).toMatchObject({
      status: "FAIL",
      detail: expect.stringContaining("pending"),
    })
  })

  it("reports missing check evidence as unavailable", () => {
    expect(classifyCheckEvidence({
      totalCount: 0,
      checkRuns: [],
      statuses: [],
    })).toMatchObject({
      status: "UNAVAILABLE",
      detail: expect.stringContaining("No exact-head checks"),
    })
  })

  it("fails check evidence returned for a different SHA", () => {
    expect(classifyCheckEvidence({
      expectedSha: SHA,
      totalCount: 1,
      checkRuns: [{
        status: "completed",
        conclusion: "success",
        headSha: OTHER_SHA,
      }],
      statuses: [],
    })).toMatchObject({
      status: "FAIL",
      detail: expect.stringContaining("not bound"),
    })
  })

  it("reports neutral or skipped checks as unavailable", () => {
    expect(classifyCheckEvidence({
      totalCount: 1,
      checkRuns: [{ status: "completed", conclusion: "skipped" }],
      statuses: [],
    })).toMatchObject({
      status: "UNAVAILABLE",
      detail: expect.stringContaining("success is not claimed"),
    })
  })

  it("passes only complete successful exact-head evidence", () => {
    expect(classifyCheckEvidence({
      totalCount: 1,
      checkRuns: [{ status: "completed", conclusion: "success" }],
      statuses: [{ state: "success" }],
    })).toMatchObject({
      status: "PASS",
    })
  })
})
