import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"
import {
  collectReleaseStatus,
  parseReleaseStatusArgs,
  renderReleaseStatusJson,
  renderReleaseStatusText,
  resolveTrustedGitHubCliCommand,
} from "./release-status.mjs"

const SHA = "7ebbad86970bee4389fe870df260ca126132637b"
const OTHER_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const PROJECT_REF = "eyaoahwzixqetjgfghsh"

function windowsGitHubFileSystem({
  programFiles = "D:\\Program Files",
  canonicalProgramFiles = programFiles,
  canonicalRoot = `${canonicalProgramFiles}\\GitHub CLI`,
  canonicalExecutable = `${canonicalRoot}\\gh.exe`,
} = {}) {
  const root = `${programFiles}\\GitHub CLI`
  const executable = `${root}\\gh.exe`
  const canonicalPaths = new Map([
    [programFiles.toLowerCase(), canonicalProgramFiles],
    [root.toLowerCase(), canonicalRoot],
    [executable.toLowerCase(), canonicalExecutable],
  ])
  const directories = new Set([
    programFiles,
    root,
    canonicalProgramFiles,
    canonicalRoot,
  ].map((value) => value.toLowerCase()))
  const files = new Set(
    [executable, canonicalExecutable].map((value) => value.toLowerCase()),
  )
  return {
    environment: {
      PATH: "D:\\Hostile",
      RG_VERIFICATION_WINDOWS_PROGRAM_FILES: programFiles,
      RG_VERIFICATION_GITHUB_CLI: canonicalExecutable,
    },
    canonicalize: (value) => canonicalPaths.get(value.toLowerCase()) || value,
    pathType(value) {
      const normalized = value.toLowerCase()
      if (directories.has(normalized)) return "directory"
      if (files.has(normalized)) return "file"
      return null
    },
  }
}

function manifest(overrides = {}) {
  return {
    gitSha: SHA,
    buildTimestamp: null,
    applicationVersion: "0.1.0",
    expectedLatestMigration: "013_allow_uuid_shopping_contribution_replacement",
    expectedSupabaseProjectRef: PROJECT_REF,
    ...overrides,
  }
}

function response(value, overrides = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => value,
    ...overrides,
  }
}

function fixture(overrides = {}) {
  const input = {
    repository: "aaron8819/RecipeGenie",
    branch: "main",
    expectedSha: SHA,
    productionUrl: "https://recipe-genie.example",
    expectedProjectRef: PROJECT_REF,
    ...overrides.input,
  }
  const context = {
    repository: { identity: "recipe-genie" },
    runtime: { nodeSupported: true, npmSupported: true },
    tools: { git: { available: true }, gh: { available: overrides.ghAvailable !== false } },
    ...overrides.context,
  }
  const commands = []
  const commandRunner = (command, args, cwd) => {
    commands.push({ command, args, cwd })
    const endpoint = args[1] || ""
    if (overrides.commandFailure?.(endpoint)) return { exitCode: 1, stdout: overrides.externalSecret || "sensitive raw failure", stderr: overrides.externalSecret || "sensitive raw failure" }
    if (overrides.commandOutput?.[endpoint]) return overrides.commandOutput[endpoint]
    let value
    if (endpoint === `repos/${input.repository}`) value = overrides.repository ?? { full_name: input.repository, default_branch: "main" }
    else if (endpoint.includes("/git/ref/heads/")) value = { object: { sha: overrides.branchSha || SHA } }
    else if (endpoint.endsWith("/check-runs")) {
      const checkRuns = overrides.checkRuns ?? [{ name: "quality", status: "completed", conclusion: "success" }]
      value = overrides.checkEvidence ?? { total_count: checkRuns.length, check_runs: checkRuns }
    }
    else if (endpoint.endsWith("/deployments")) value = overrides.deployments ?? []
    else if (endpoint.includes("/deployments/") && endpoint.endsWith("/statuses")) value = overrides.deploymentStatuses || [{ state: "success" }]
    else return { exitCode: 1, stdout: "" }
    return { exitCode: 0, stdout: `${JSON.stringify(value)}${overrides.lineEnding || ""}` }
  }
  const fetchCalls = []
  const underlyingFetch = overrides.fetchImpl || (async () => response(overrides.manifest || manifest()))
  const fetchImpl = (...args) => {
    fetchCalls.push(args)
    return underlyingFetch(...args)
  }
  const manifestSignal = overrides.manifestSignal || { fixture: "timeout-signal" }
  return collectReleaseStatus(input, {
    context,
    commandRunner,
    fetchImpl,
    manifestSignal,
    githubCli: overrides.githubCli,
    cwd: overrides.cwd || "C:/fixture",
  })
    .then((report) => ({ report, commands, fetchCalls, manifestSignal }))
}

describe("release status", () => {
  it("invokes the exact absolute GitHub CLI without a bare-name fallback", async () => {
    const githubCli = "D:\\Program Files\\GitHub CLI\\gh.exe"
    const { report, commands } = await fixture({
      githubCli,
      ghAvailable: false,
    })
    expect(report.status).toBe("PASS")
    expect(commands.length).toBeGreaterThan(0)
    expect(commands.every((call) => call.command === githubCli)).toBe(true)
    expect(commands.some((call) => call.command === "gh")).toBe(false)
  })

  it("validates the canonical executable independently of ambient PATH", () => {
    const fileSystem = windowsGitHubFileSystem()
    expect(resolveTrustedGitHubCliCommand({
      platform: "win32",
      ...fileSystem,
    })).toBe("D:\\Program Files\\GitHub CLI\\gh.exe")
  })

  it.each([
    ["installation root redirected outside", windowsGitHubFileSystem({
      canonicalRoot: "D:\\Outside\\GitHub CLI",
      canonicalExecutable: "D:\\Outside\\GitHub CLI\\gh.exe",
    })],
    ["executable redirected outside", windowsGitHubFileSystem({
      canonicalExecutable: "D:\\Outside\\gh.exe",
    })],
  ])("rejects %s at the release-status consumption boundary", (_label, fileSystem) => {
    expect(() => resolveTrustedGitHubCliCommand({
      platform: "win32",
      ...fileSystem,
    })).toThrow(/approved root/iu)
  })

  it("correlates exact-SHA CI with the authoritative production manifest", async () => {
    const { report } = await fixture({ deployments: [{ id: 42 }] })
    expect(report.status).toBe("PASS")
    expect(report.binding).toMatchObject({ deployedSha: SHA, deployedProjectRef: PROJECT_REF })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "exact-sha-ci", status: "PASS", authority: "AUTHORITATIVE" }),
      expect.objectContaining({ name: "production-manifest", status: "PASS", authority: "AUTHORITATIVE" }),
    ]))
  })

  it("uses the authoritative GitHub default branch only when no branch is supplied", async () => {
    const { report } = await fixture({ input: { branch: undefined }, repository: { full_name: "aaron8819/RecipeGenie", default_branch: "main" } })
    expect(report.status).toBe("PASS")
    expect(report.binding.branch).toBe("main")
    expect(report.checks.find((item) => item.name === "branch-head")?.authority).toBe("AUTHORITATIVE")
  })

  it("blocks safely when neither an explicit nor authoritative default branch is available", async () => {
    const { report } = await fixture({ input: { branch: undefined }, repository: { full_name: "aaron8819/RecipeGenie" } })
    expect(report.status).toBe("BLOCKED")
    expect(report.nextAction).toMatch(/Supply an explicit branch/i)
  })

  it.each([
    ["failed", "completed", "failure"],
    ["timed out", "completed", "timed_out"],
    ["canceled", "completed", "cancelled"],
    ["pending", "in_progress", null],
    ["queued", "queued", null],
  ])("requires action for %s GitHub checks", async (_label, status, conclusion) => {
    const { report } = await fixture({ checkRuns: [{ name: "quality", status, conclusion }] })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "exact-sha-ci")?.status).toBe("FAIL")
  })

  it.each(["neutral", "skipped"])("keeps a %s check explicit without claiming CI passed", async (conclusion) => {
    const { report } = await fixture({ checkRuns: [{ name: "incidental", status: "completed", conclusion }] })
    expect(report.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "exact-sha-ci")).toMatchObject({ status: "WARN", authority: "AUTHORITATIVE" })
    expect(report.checks.find((item) => item.name === "exact-sha-ci")?.detail).toMatch(/not reported as passed/i)
  })

  it("treats no check runs as an authoritative warning rather than a release failure", async () => {
    const { report } = await fixture({ checkRuns: [] })
    expect(report.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "exact-sha-ci")).toMatchObject({ status: "WARN", authority: "AUTHORITATIVE" })
    expect(report.nextAction).toMatch(/Run or configure CI/i)
  })

  it("does not claim CI passed when the exact-SHA Checks page is incomplete", async () => {
    const checkRuns = Array.from({ length: 100 }, (_, index) => ({ name: `check-${index}`, status: "completed", conclusion: "success" }))
    const { report } = await fixture({ checkEvidence: { total_count: 101, check_runs: checkRuns } })
    expect(report.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "exact-sha-ci")).toMatchObject({ status: "WARN", authority: "AUTHORITATIVE" })
    expect(report.checks.find((item) => item.name === "exact-sha-ci")?.detail).toMatch(/only 100 of 101/i)
  })

  it("treats malformed GitHub JSON and invalid Checks shapes as unavailable evidence", async () => {
    const endpoint = `repos/aaron8819/RecipeGenie/commits/${SHA}/check-runs`
    const malformed = await fixture({ commandOutput: { [endpoint]: { exitCode: 0, stdout: "{not-json" } } })
    expect(malformed.report.status).toBe("PASS")
    expect(malformed.report.checks.find((item) => item.name === "exact-sha-ci")?.authority).toBe("INFERRED")

    const invalid = await fixture({ checkEvidence: { check_runs: [] } })
    expect(invalid.report.checks.find((item) => item.name === "exact-sha-ci")).toMatchObject({ status: "WARN", authority: "AUTHORITATIVE" })
  })

  it("continues with warnings when gh is missing", async () => {
    const { report, commands } = await fixture({ ghAvailable: false })
    expect(report.status).toBe("PASS")
    expect(commands).toHaveLength(0)
    expect(report.checks.find((item) => item.name === "exact-sha-ci")?.status).toBe("WARN")
    expect(report.warnings.join(" ")).toMatch(/gh is missing/i)
  })

  it("continues when GitHub Checks are temporarily inaccessible", async () => {
    const { report } = await fixture({ commandFailure: (endpoint) => endpoint.endsWith("/check-runs") })
    expect(report.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "exact-sha-ci")).toMatchObject({ status: "WARN", authority: "INFERRED" })
  })

  it("treats a missing deployment record as an optional warning", async () => {
    const { report } = await fixture({ deployments: [] })
    expect(report.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "deployment-record")?.status).toBe("WARN")
  })

  it("never trusts or prints an unrecognized deployment status payload", async () => {
    const externalSecret = "ghp_abcdefghijklmnopqrstuvwxyz123456"
    const { report } = await fixture({ deployments: [{ id: 42 }], deploymentStatuses: [{ state: externalSecret }] })
    const output = `${renderReleaseStatusText(report)}${renderReleaseStatusJson(report)}`
    expect(output).not.toContain(externalSecret)
    expect(report.checks.find((item) => item.name === "deployment-record")?.detail).toBe("GitHub has a deployment record for the expected SHA.")
  })

  it("blocks a branch-head contradiction unless historical verification is explicit", async () => {
    const blocked = (await fixture({ branchSha: OTHER_SHA })).report
    expect(blocked.status).toBe("BLOCKED")
    expect(blocked.checks.find((item) => item.name === "branch-head")?.status).toBe("FAIL")

    const historical = (await fixture({ branchSha: OTHER_SHA, input: { historical: true } })).report
    expect(historical.status).toBe("PASS")
    expect(historical.checks.find((item) => item.name === "branch-head")?.status).toBe("WARN")
  })

  it("requires action when the deployed SHA differs", async () => {
    const { report } = await fixture({ manifest: manifest({ gitSha: OTHER_SHA }) })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "deployed-sha")?.status).toBe("FAIL")
  })

  it("blocks a production Supabase project contradiction", async () => {
    const { report } = await fixture({ manifest: manifest({ expectedSupabaseProjectRef: "aaaaaaaaaaaaaaaaaaaa" }) })
    expect(report.status).toBe("BLOCKED")
    expect(report.checks.find((item) => item.name === "supabase-project-ref")?.status).toBe("FAIL")
  })

  it("applies BLOCKED before ACTION_REQUIRED and never lets corroborative deployment state override core evidence", async () => {
    const blocked = await fixture({
      checkRuns: [{ name: "quality", status: "completed", conclusion: "failure" }],
      manifest: manifest({ expectedSupabaseProjectRef: "aaaaaaaaaaaaaaaaaaaa" }),
      deployments: [{ id: 42 }],
      deploymentStatuses: [{ state: "success" }],
    })
    expect(blocked.report.status).toBe("BLOCKED")

    const corroborativeFailure = await fixture({ deployments: [{ id: 42 }], deploymentStatuses: [{ state: "failure" }] })
    expect(corroborativeFailure.report.status).toBe("PASS")
    expect(corroborativeFailure.report.checks.find((item) => item.name === "deployment-record")?.authority).toBe("CORROBORATIVE")
  })

  it("requires action for production HTTP failure", async () => {
    const { report } = await fixture({ fetchImpl: async () => response(null, { ok: false, status: 503 }) })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toMatch(/HTTP 503/)
  })

  it("sanitizes unreachable-production errors", async () => {
    const externalSecret = "ghp_abcdefghijklmnopqrstuvwxyz123456"
    const { report } = await fixture({ fetchImpl: async () => { throw new Error(`request failed: ${externalSecret}`) } })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest request failed.")
    expect(renderReleaseStatusJson(report)).not.toContain(externalSecret)
  })

  it("classifies an HTTP timeout without exposing the abort error", async () => {
    const { report } = await fixture({ fetchImpl: async () => { throw new DOMException("sensitive timeout detail", "TimeoutError") } })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest request timed out.")
  })

  it("normalizes a trailing slash and follows redirects without credentials", async () => {
    const signal = { fixture: "signal" }
    const { report, fetchCalls } = await fixture({ input: { productionUrl: "https://recipe-genie.example/" }, manifestSignal: signal })
    expect(report.status).toBe("PASS")
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0][0]).toBe("https://recipe-genie.example/api/version")
    expect(fetchCalls[0][1]).toEqual({ credentials: "omit", redirect: "follow", signal })
  })

  it("rejects unsafe redirect targets without printing them", async () => {
    const redirectUrl = "https://fixture-user:fixture-password@example.invalid/api/version"
    const { report } = await fixture({ fetchImpl: async () => response(manifest(), { url: redirectUrl }) })
    expect(report.status).toBe("ACTION_REQUIRED")
    const output = renderReleaseStatusText(report)
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest redirect target is unsafe.")
    expect(output).not.toContain(redirectUrl)
    expect(output).not.toContain("fixture-password")
  })

  it("distinguishes malformed manifest JSON from invalid manifest structure", async () => {
    const malformed = await fixture({ fetchImpl: async () => response(null, { json: async () => { throw new Error("secret body") } }) })
    expect(malformed.report.status).toBe("ACTION_REQUIRED")
    expect(malformed.report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest JSON is malformed.")

    const { report } = await fixture({ manifest: { message: "not a manifest" } })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest structure is invalid.")
  })

  it("rejects a short deployed SHA as an invalid manifest structure", async () => {
    const { report } = await fixture({ manifest: manifest({ gitSha: SHA.slice(0, 7) }) })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.detail).toBe("Production manifest structure is invalid.")
  })

  it("accepts missing optional manifest metadata", async () => {
    const value = manifest()
    delete value.applicationVersion
    delete value.buildTimestamp
    const { report } = await fixture({ manifest: value })
    expect(report.status).toBe("PASS")
    expect(report.binding.expectedMigration).toBe("013_allow_uuid_shopping_contribution_replacement")
  })

  it("treats a missing optional deployed SHA as valid manifest evidence but requires deployment action", async () => {
    const value = manifest({ gitSha: null })
    const { report } = await fixture({ manifest: value })
    expect(report.status).toBe("ACTION_REQUIRED")
    expect(report.checks.find((item) => item.name === "production-manifest")?.status).toBe("PASS")
    expect(report.checks.find((item) => item.name === "deployed-sha")?.status).toBe("FAIL")
  })

  it("keeps text and JSON substantively equivalent with deterministic JSON ordering", async () => {
    const { report } = await fixture({ deployments: [{ id: 42 }] })
    const jsonA = renderReleaseStatusJson(report)
    const jsonB = renderReleaseStatusJson(report)
    const text = renderReleaseStatusText(report)
    expect(jsonA).toBe(jsonB)
    expect(Object.keys(JSON.parse(jsonA))).toEqual(["schemaVersion", "status", "binding", "checks", "warnings", "nextAction"])
    for (const value of [report.status, report.binding.repository, report.binding.expectedSha, report.binding.deployedSha, report.nextAction]) {
      expect(text).toContain(value)
      expect(jsonA).toContain(value)
    }
  })

  it.each([
    ["C:/fixture", "\r\n"],
    ["/fixture", "\n"],
  ])("is platform-independent through injected adapters at %s", async (cwd, lineEnding) => {
    const { report, commands } = await fixture({ cwd, lineEnding })
    expect(report.status).toBe("PASS")
    expect(commands.every((item) => item.cwd === cwd)).toBe(true)
  })

  it("parses an explicitly injected environment without reading process state", () => {
    const environment = {
      RG_REPOSITORY: "aaron8819/RecipeGenie",
      RG_BRANCH: "main",
      RG_EXPECTED_GIT_SHA: SHA,
      RG_PRODUCTION_URL: "https://recipe-genie.example",
      RG_EXPECTED_SUPABASE_PROJECT_REF: PROJECT_REF,
    }
    expect(parseReleaseStatusArgs(["--json", "--historical"], environment)).toEqual({
      repository: environment.RG_REPOSITORY,
      branch: environment.RG_BRANCH,
      expectedSha: SHA,
      productionUrl: environment.RG_PRODUCTION_URL,
      expectedProjectRef: PROJECT_REF,
      historical: true,
      json: true,
    })
  })

  it("never emits configured secrets, external errors, or credential-bearing production URLs", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456"
    const { report } = await fixture()
    expect(() => renderReleaseStatusText(report, [secret])).not.toThrow()
    expect(renderReleaseStatusJson(report, [secret])).not.toContain(secret)
    await expect(fixture({ input: { productionUrl: "https://user:password@example.invalid" } })).rejects.toThrow(/credentials|origin/i)

    const unavailable = await fixture({ externalSecret: secret, commandFailure: (endpoint) => endpoint.endsWith("/check-runs") })
    expect(renderReleaseStatusText(unavailable.report)).not.toContain(secret)
    expect(renderReleaseStatusJson(unavailable.report)).not.toContain(secret)

    const invalidStatus = await fixture({ fetchImpl: async () => response(null, { ok: false, status: secret }) })
    expect(renderReleaseStatusText(invalidStatus.report)).not.toContain(secret)
    expect(invalidStatus.report.checks.find((item) => item.name === "production-manifest")?.detail).toMatch(/HTTP unknown/)
  })

  it.each([
    { repository: "ghp_abcdefghijklmnopqrstuvwxyz123456/repo" },
    { branch: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
    { expectedSha: "abcdef0" },
    { expectedSha: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
    { expectedProjectRef: "ghp_secret_fixture_12" },
    { productionUrl: "http://recipe-genie.example" },
    { productionUrl: "https://example.invalid/private-path" },
    { productionUrl: "https://example.invalid?unsafe=true" },
    { productionUrl: "https://example.invalid#unsafe" },
  ])("rejects secret-bearing or unsafe malformed input without creating report output", async (input) => {
    await expect(fixture({ input })).rejects.toThrow()
  })

  it.each([
    ["--repository", "ghp_abcdefghijklmnopqrstuvwxyz123456/repo"],
    ["--branch", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
    ["--expected-sha", "ghp_abcdefghijklmnopqrstuvwxyz123456"],
    ["--production-url", "https://fixture-user:fixture-password@example.invalid"],
    ["--expected-project-ref", "ghp_secret_fixture_12"],
  ])("does not echo a secret-bearing malformed %s argument", (flag, unsafeValue) => {
    const args = [
      "scripts/workflow/release-status.mjs",
      "--repository", "aaron8819/RecipeGenie",
      "--branch", "main",
      "--expected-sha", SHA,
      "--production-url", "https://recipe-genie.example",
      "--expected-project-ref", PROJECT_REF,
    ]
    const valueIndex = args.indexOf(flag) + 1
    args[valueIndex] = unsafeValue
    const result = spawnSync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    })
    const output = `${result.stdout || ""}${result.stderr || ""}`
    expect(result.status).toBe(2)
    expect(output).toContain("STATUS: BLOCKED")
    expect(output).not.toContain(unsafeValue)
    expect(output).not.toContain("fixture-user")
    expect(output).not.toContain("fixture-password")
  })
})
