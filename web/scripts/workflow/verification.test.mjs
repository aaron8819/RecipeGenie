import { describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  createTrustedChildEnvironment,
  parseVerificationArgs,
  planFocusedVerification,
  resolveTrustedNpmCli,
  runFocusedVerification,
  runPrVerification,
  runReleaseVerification,
} from "./verification.mjs"

const SHA = "a".repeat(40)
const UNSUPPORTED_NODE = process.platform === "win32"
  ? "C:\\Program Files\\nodejs\\node.exe"
  : null
const RELEASE_IDENTITIES = {
  "github-repository": "github-repository:aaron8819/recipegenie",
  "branch-head": `github-branch:aaron8819/recipegenie:main:${SHA}`,
  "exact-sha-ci": `github-checks:aaron8819/recipegenie:${SHA}`,
  "production-manifest": `production-manifest:${SHA}:eyaoahwzixqetjgfghsh:014_add_recipe_yield_metadata`,
  "deployed-sha": `deployed-sha:${SHA}`,
  "supabase-project-ref": "supabase-project:eyaoahwzixqetjgfghsh",
}

function passingRunner() {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      runtime: {
        node: process.versions.node,
        npm: "10.9.8",
        nodeExecutableMatchesLifecycle: true,
        npmExecutableBundledWithNode: true,
        scriptShellTrusted: true,
      },
    }),
    stderr: "",
  }
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

  it("removes hostile executable and shell authority from the complete child environment", () => {
    const root = mkdtempSync(join(tmpdir(), "rg-hostile-runtime-"))
    const hostileNodeDirectory = join(root, "hostile-node")
    const hostileNpmDirectory = join(root, "hostile-npm")
    const benign = join(root, "benign")
    mkdirSync(hostileNodeDirectory)
    mkdirSync(hostileNpmDirectory)
    mkdirSync(benign)
    writeFileSync(join(hostileNodeDirectory, "node.exe"), "hostile")
    writeFileSync(join(hostileNpmDirectory, "npm.cmd"), "@exit /b 0")
    try {
      const env = createTrustedChildEnvironment({
        environment: {
          ...process.env,
          PATH: `${hostileNodeDirectory};${benign}`,
          Path: `${hostileNpmDirectory};${process.env.SystemRoot}\\System32`,
          npm_execpath: join(root, "always-success.js"),
          NPM_NODE_EXECPATH: join(root, "node.exe"),
          npm_config_script_shell: join(root, "shell.cmd"),
          npm_config_ignore_scripts: "true",
          npm_config_userconfig: join(root, ".npmrc"),
          ComSpec: join(root, "shell.cmd"),
          NODE_OPTIONS: `--require=${join(root, "preload.js")}`,
          BASH_ENV: join(root, "bash-env"),
        },
      })
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path")
      expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toHaveLength(1)
      const pathEntries = env[pathKey].split(";")
      expect(pathEntries).not.toContain(hostileNodeDirectory)
      expect(pathEntries).not.toContain(hostileNpmDirectory)
      expect(pathEntries).toContain(benign)
      expect(env[pathKey]).toContain(dirname(process.execPath))
      expect(env[pathKey]).toContain(`${process.env.SystemRoot}\\System32`)
      expect(env.npm_execpath).toBe(resolveTrustedNpmCli())
      expect(env.npm_node_execpath).toBe(process.execPath)
      expect(env.npm_config_script_shell).toBe(`${process.env.SystemRoot}\\System32\\cmd.exe`)
      expect(env.npm_config_ignore_scripts).toBe("false")
      expect(env.npm_config_userconfig).toBe("NUL")
      expect(env.ComSpec).toBe(env.npm_config_script_shell)
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(env.BASH_ENV).toBeUndefined()

      const nested = spawnSync("node", ["--eval", "process.stdout.write(process.versions.node)"], {
        encoding: "utf8",
        env,
        shell: false,
      })
      expect(nested.status).toBe(0)
      expect(nested.stdout).toBe(process.versions.node)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("invokes every PR check with its intended argument array", () => {
    const calls = []
    const report = runPrVerification({
      commandRunner(command, args, cwd, env) {
        calls.push({ command, args, cwd, env })
        return passingRunner()
      },
    })
    expect(report.status).toBe("PASS")
    expect(calls[0].args).toContain("check:migration-references")
    expect(calls[1].args.slice(-2)).toEqual(["run", "verify"])
    expect(calls[2].args.slice(-2)).toEqual(["run", "build"])
    expect(calls[3].command).toMatch(/[\\/](?:pwsh|powershell)(?:\.exe)?$/iu)
    expect(calls[3].args).toContain("-File")
    expect(calls.every((call) => Array.isArray(call.args))).toBe(true)
    expect(calls.every((call) => typeof call.env === "object")).toBe(true)
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
      checks: [
        ...completeReleaseReport().checks,
        { name: "deployment-record", status: "WARN", authority: "CORROBORATIVE", detail: "optional" },
      ],
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

  it.each([
    ["inferred authority", (value) => ({ ...value, checks: value.checks.map((item, index) => index === 0 ? { ...item, authority: "INFERRED" } : item) })],
    ["unknown authority", (value) => ({ ...value, checks: value.checks.map((item, index) => index === 0 ? { ...item, authority: "CUSTOM" } : item) })],
    ["missing authority", (value) => ({ ...value, checks: value.checks.map((item, index) => index === 0 ? { ...item, authority: undefined } : item) })],
    ["duplicate authority identity", (value) => ({ ...value, checks: [...value.checks, { ...value.checks[0] }] })],
    ["conflicting duplicate identity", (value) => ({ ...value, checks: [...value.checks, { ...value.checks[0], detail: "conflict" }] })],
    ["missing explicit identity", (value) => ({
      ...value,
      checks: value.checks.map((item, index) => index === 0
        ? { ...item, identity: RELEASE_IDENTITIES[item.name] }
        : item),
    })],
    ["same explicit identity reused", (value) => ({
      ...value,
      checks: value.checks.map((item) => ({ ...item, identity: "same-authority" })),
    })],
    ["explicit identity conflicting with binding", (value) => ({
      ...value,
      checks: value.checks.map((item) => ({ ...item, identity: `${RELEASE_IDENTITIES[item.name]}-conflict` })),
    })],
  ])("rejects %s", (_label, mutate) => {
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(mutate(completeReleaseReport())) }),
    })
    expect(report.status).toBe("FAIL")
  })

  it("accepts complete recognized evidence with explicit unique identities", () => {
    const value = completeReleaseReport()
    value.checks = value.checks.map((item) => ({
      ...item,
      identity: RELEASE_IDENTITIES[item.name],
    }))
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    expect(report.status).toBe("PASS")
    expect(report.releaseAuthorityIdentities).toEqual(RELEASE_IDENTITIES)
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

  it.each([
    ["unknown option", ["pr", "--json", "--wat"]],
    ["duplicate json", ["pr", "--json", "--json"]],
    ["missing value", ["focused", "--json", "--base"]],
    ["conflicting scopes", ["focused", "--json", "--base", "main", "--file", "README.md"]],
    ["unexpected positional", ["pr", "--json", "unexpected"]],
    ["malformed ref", ["focused", "--json", "--base", "../main"]],
    ["malformed path", ["focused", "--json", "--file", "C:\\secret.txt"]],
    ["tier-inapplicable option", ["pr", "--json", "--repository", "aaron8819/RecipeGenie"]],
  ])("emits one JSON error document for %s", (_label, args) => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "verification.mjs")
    const child = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      shell: false,
    })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toBe("")
    expect(JSON.parse(child.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "verification",
      status: "FAIL",
      error: { category: "ARGUMENT" },
    })
  })

  it.runIf(Boolean(UNSUPPORTED_NODE && existsSync(UNSUPPORTED_NODE)))("emits JSON for a runtime validation failure after successful parsing", () => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "verification.mjs")
    const child = spawnSync(UNSUPPORTED_NODE, [script, "pr", "--json"], {
      encoding: "utf8",
      shell: false,
    })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toBe("")
    expect(JSON.parse(child.stdout)).toMatchObject({
      command: "verification",
      status: "FAIL",
      error: { code: "RUNTIME_ERROR", category: "RUNTIME" },
    })
  })

  it("keeps human-mode argument failures concise", () => {
    const script = resolve(dirname(fileURLToPath(import.meta.url)), "verification.mjs")
    const child = spawnSync(process.execPath, [script, "pr", "--wat"], {
      encoding: "utf8",
      shell: false,
    })
    expect(child.status).not.toBe(0)
    expect(child.stdout).toBe("")
    expect(child.stderr.trim()).toMatch(/^Unexpected pr-verification argument:/u)
    expect(child.stderr).not.toContain("Error:")
  })
})
