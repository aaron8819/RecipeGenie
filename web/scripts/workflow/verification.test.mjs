import { describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  createTrustedChildEnvironment,
  parseVerificationArgs,
  planFocusedVerification,
  resolveTrustedNpmCli,
  resolveTrustedWindowsRuntime,
  runFocusedVerification,
  runPrVerification,
  runReleaseVerification,
  renderVerificationJson,
  renderVerificationText,
} from "./verification.mjs"

const SHA = "a".repeat(40)
const NODE_DISTRIBUTION = process.platform === "win32"
  ? dirname(process.execPath)
  : resolve(dirname(process.execPath), "..")
const UNSUPPORTED_NODE = process.platform === "win32"
  ? "C:\\Program Files\\nodejs\\node.exe"
  : null
const TEST_WINDOWS_RUNTIME = process.platform === "win32"
  ? {
    systemRoot: process.env.SystemRoot,
    programFiles: process.env.ProgramFiles,
    powerShellExecutable: join(
      process.env.ProgramFiles,
      "PowerShell",
      "7",
      "pwsh.exe",
    ),
    shell: join(process.env.SystemRoot, "System32", "cmd.exe"),
  }
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
      windowsRuntime: TEST_WINDOWS_RUNTIME,
      files: ["web/src/app/page.tsx"],
      commandRunner: passingRunner,
    })
    expect(report).toMatchObject({ status: "PASS", requestedTier: "FOCUSED", effectiveTier: "PR" })
    expect(report.note).toContain("did not claim confidence")
  })

  it("reports an empty explicit scope as skipped", () => {
    const report = runFocusedVerification({
      windowsRuntime: TEST_WINDOWS_RUNTIME,
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
  function windowsRuntime(
    systemRoot = "C:\\Windows",
    programFiles = "C:\\Program Files",
  ) {
    return {
      systemRoot,
      programFiles,
      powerShellExecutable: `${programFiles}\\PowerShell\\7\\pwsh.exe`,
      shell: `${systemRoot}\\System32\\cmd.exe`,
    }
  }

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
    const platformSystemPath = process.platform === "win32"
      ? `${process.env.SystemRoot}\\System32`
      : "/usr/bin"
    mkdirSync(hostileNodeDirectory)
    mkdirSync(hostileNpmDirectory)
    mkdirSync(benign)
    writeFileSync(
      join(hostileNodeDirectory, process.platform === "win32" ? "node.exe" : "node"),
      "hostile",
    )
    writeFileSync(
      join(hostileNpmDirectory, process.platform === "win32" ? "npm.cmd" : "npm"),
      "hostile",
    )
    try {
      const env = createTrustedChildEnvironment({
        windowsRuntime: TEST_WINDOWS_RUNTIME,
        environment: {
          ...process.env,
          PATH: `${hostileNodeDirectory}${delimiter}${benign}`,
          Path: `${hostileNpmDirectory}${delimiter}${platformSystemPath}`,
          npm_execpath: join(root, "always-success.js"),
          NPM_NODE_EXECPATH: join(root, "node.exe"),
          npm_config_script_shell: join(root, "shell.cmd"),
          npm_config_ignore_scripts: "true",
          npm_config_userconfig: join(root, ".npmrc"),
          ComSpec: join(root, "shell.cmd"),
          SystemRoot: join(root, "hostile-windows"),
          ProgramFiles: join(root, "hostile-program-files"),
          NODE_OPTIONS: `--require=${join(root, "preload.js")}`,
          BASH_ENV: join(root, "bash-env"),
          RG_DATABASE_URL: "sentinel-rg-database",
          DATABASE_URL: "sentinel-database",
          SUPABASE_SERVICE_ROLE_KEY: "sentinel-supabase",
          VERCEL_TOKEN: "sentinel-vercel",
          GITHUB_TOKEN: "sentinel-github",
          AWS_SECRET_ACCESS_KEY: "sentinel-aws",
          UNRELATED_SECRET: "sentinel-unrelated",
        },
      })
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path")
      expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toHaveLength(1)
      const pathEntries = env[pathKey].split(delimiter)
      expect(pathEntries).not.toContain(hostileNodeDirectory)
      expect(pathEntries).not.toContain(hostileNpmDirectory)
      expect(pathEntries).not.toContain(benign)
      expect(env[pathKey]).toContain(dirname(process.execPath))
      expect(env[pathKey]).toContain(platformSystemPath)
      expect(env.npm_execpath).toBe(resolveTrustedNpmCli())
      expect(env.npm_node_execpath).toBe(process.execPath)
      expect(env.npm_config_script_shell).toBe(
        process.platform === "win32"
          ? `${process.env.SystemRoot}\\System32\\cmd.exe`
          : "/bin/sh",
      )
      expect(env.npm_config_ignore_scripts).toBe("false")
      expect(env.npm_config_userconfig).toBe(process.platform === "win32" ? "NUL" : "/dev/null")
      if (process.platform === "win32") {
        expect(env.ComSpec).toBe(env.npm_config_script_shell)
      } else {
        expect(env.SHELL).toBe(env.npm_config_script_shell)
      }
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(env.BASH_ENV).toBeUndefined()
      for (const name of [
        "RG_DATABASE_URL",
        "DATABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "VERCEL_TOKEN",
        "GITHUB_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
        "UNRELATED_SECRET",
      ]) expect(env[name]).toBeUndefined()
      expect(env.TEMP).toBe(process.env.TEMP)
      if (process.platform === "win32") {
        expect(env.SystemRoot).toBe(TEST_WINDOWS_RUNTIME.systemRoot)
        expect(env.ProgramFiles).toBe(TEST_WINDOWS_RUNTIME.programFiles)
      } else {
        expect(env.SystemRoot).toBeUndefined()
        expect(env.ProgramFiles).toBeUndefined()
      }

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

  it.each([
    ["default Windows roots", windowsRuntime()],
    ["non-C Windows roots with spaces", windowsRuntime("D:\\Windows", "D:\\Program Files")],
  ])("preserves %s supplied by the trusted launcher", (_label, runtime) => {
    const env = createTrustedChildEnvironment({
      environment: {
        ...process.env,
        SystemRoot: "C:\\hostile-windows",
        ProgramFiles: "C:\\hostile-program-files",
        PATH: "C:\\hostile-path",
        Path: "C:\\another-hostile-path",
      },
      platform: "win32",
      windowsRuntime: runtime,
      pathExists: () => true,
    })
    expect(env.SystemRoot).toBe(runtime.systemRoot)
    expect(env.ProgramFiles).toBe(runtime.programFiles)
    expect(env.ComSpec).toBe(runtime.shell)
    expect(env.Path).toContain(`${runtime.systemRoot}\\System32`)
    expect(env.Path).toContain(`${runtime.programFiles}\\PowerShell\\7`)
    expect(Object.keys(env).filter((key) => key.toLowerCase() === "path")).toEqual(["Path"])
  })

  it("uses the exact trusted non-C PowerShell executable for migration tooling", () => {
    const runtime = windowsRuntime("D:\\Windows", "D:\\Program Files")
    const calls = []
    const report = runPrVerification({
      platform: "win32",
      windowsRuntime: runtime,
      childEnvironment: createTrustedChildEnvironment({
        platform: "win32",
        windowsRuntime: runtime,
        pathExists: () => true,
      }),
      commandRunner(command, args, cwd, env) {
        calls.push({ command, args, cwd, env })
        return passingRunner()
      },
    })
    expect(report.status).toBe("PASS")
    expect(calls[3].command).toBe("D:\\Program Files\\PowerShell\\7\\pwsh.exe")
  })

  it.each([
    ["missing trusted PowerShell", {
      RG_VERIFICATION_WINDOWS_SYSTEM_ROOT: "D:\\Windows",
      RG_VERIFICATION_WINDOWS_PROGRAM_FILES: "D:\\Program Files",
    }],
    ["relative trusted root", {
      RG_VERIFICATION_WINDOWS_SYSTEM_ROOT: "Windows",
      RG_VERIFICATION_WINDOWS_PROGRAM_FILES: "D:\\Program Files",
      RG_VERIFICATION_POWERSHELL: "D:\\Program Files\\PowerShell\\7\\pwsh.exe",
    }],
    ["untrusted PowerShell name", {
      RG_VERIFICATION_WINDOWS_SYSTEM_ROOT: "D:\\Windows",
      RG_VERIFICATION_WINDOWS_PROGRAM_FILES: "D:\\Program Files",
      RG_VERIFICATION_POWERSHELL: "D:\\Program Files\\PowerShell\\7\\powershell.exe",
    }],
  ])("fails closed for %s", (_label, environment) => {
    expect(() => resolveTrustedWindowsRuntime({
      environment,
      platform: "win32",
      pathExists: () => true,
    })).toThrow("Trusted Windows runtime information is unavailable or invalid.")
  })

  it("fails closed when a trusted Windows path does not exist", () => {
    const runtime = windowsRuntime("D:\\Windows", "D:\\Program Files")
    expect(() => resolveTrustedWindowsRuntime({
      environment: {
        RG_VERIFICATION_WINDOWS_SYSTEM_ROOT: runtime.systemRoot,
        RG_VERIFICATION_WINDOWS_PROGRAM_FILES: runtime.programFiles,
        RG_VERIFICATION_POWERSHELL: runtime.powerShellExecutable,
      },
      platform: "win32",
      pathExists: (value) => value !== runtime.powerShellExecutable,
    })).toThrow("Trusted Windows runtime information is unavailable or invalid.")
  })

  it("leaves POSIX runtime resolution unchanged", () => {
    expect(resolveTrustedWindowsRuntime({ platform: "linux", environment: {} })).toBeNull()
  })

  it("invokes every PR check with its intended argument array", () => {
    const calls = []
    const report = runPrVerification({
      windowsRuntime: TEST_WINDOWS_RUNTIME,
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
    if (process.platform === "win32") {
      expect(calls[3].command).toBe(TEST_WINDOWS_RUNTIME.powerShellExecutable)
    }
    expect(calls[3].args).toContain("-File")
    expect(calls.every((call) => Array.isArray(call.args))).toBe(true)
    expect(calls.every((call) => typeof call.env === "object")).toBe(true)
  })

  it("passes only the minimum ordinary environment to tests, builds, lifecycles, and migration tooling", () => {
    const sentinels = {
      RG_DATABASE_URL: "sentinel-rg-database",
      DATABASE_URL: "sentinel-database",
      SUPABASE_SERVICE_ROLE_KEY: "sentinel-supabase",
      VERCEL_TOKEN: "sentinel-vercel",
      GITHUB_TOKEN: "sentinel-github",
      AWS_SECRET_ACCESS_KEY: "sentinel-aws",
      UNRELATED_SECRET: "sentinel-unrelated",
    }
    const childEnvironment = createTrustedChildEnvironment({
      environment: { ...process.env, ...sentinels },
      windowsRuntime: TEST_WINDOWS_RUNTIME,
    })
    const calls = []
    runPrVerification({
      windowsRuntime: TEST_WINDOWS_RUNTIME,
      childEnvironment,
      commandRunner(command, args, cwd, env) {
        calls.push({ command, args, cwd, env })
        return passingRunner()
      },
    })
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      for (const name of Object.keys(sentinels)) expect(call.env[name]).toBeUndefined()
      expect(call.env.TEMP).toBe(process.env.TEMP)
      expect(call.env.npm_node_execpath).toBe(process.execPath)
    }
  })

  it("starts through the trusted launcher despite hostile path, npm, and shell replacements", { timeout: 60_000 }, () => {
    if (process.platform !== "win32") return
    const root = mkdtempSync(join(tmpdir(), "rg-launcher-hostile-"))
    const launcher = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rg-verify.ps1")
    const pwsh = "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
    for (const name of ["node.cmd", "npm.cmd", "npx.cmd", "shell.cmd"]) {
      writeFileSync(join(root, name), "@exit /b 0\r\n")
    }
    try {
      const child = spawnSync(pwsh, [
        "-NoProfile", "-File", launcher,
        "-NodeDistribution", NODE_DISTRIBUTION,
        "pr", "--json", "--wat",
      ], {
        encoding: "utf8",
        shell: false,
        env: {
          ...process.env,
          PATH: root,
          Path: root,
          npm_execpath: join(root, "npm.cmd"),
          npm_node_execpath: join(root, "node.cmd"),
          npm_config_script_shell: join(root, "shell.cmd"),
          ComSpec: join(root, "shell.cmd"),
        },
      })
      expect(child.status).not.toBe(0)
      expect(child.stderr).toBe("")
      expect(JSON.parse(child.stdout)).toMatchObject({ command: "verification", status: "FAIL", error: { category: "ARGUMENT" } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("replaces verifier startup contamination with one launcher JSON document", { timeout: 60_000 }, () => {
    if (process.platform !== "win32") return
    const root = mkdtempSync(join(tmpdir(), "rg-launcher-startup-"))
    const source = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rg-verify.ps1")
    const scripts = join(root, "scripts")
    const web = join(root, "web")
    mkdirSync(scripts)
    mkdirSync(web)
    writeFileSync(join(scripts, "rg-verify.ps1"), readFileSync(source, "utf8"))
    writeFileSync(join(web, ".nvmrc"), "22.23.1\n")
    writeFileSync(join(web, "package.json"), JSON.stringify({ packageManager: "npm@10.9.8" }))
    try {
      const child = spawnSync("C:\\Program Files\\PowerShell\\7\\pwsh.exe", [
        "-NoProfile", "-File", join(scripts, "rg-verify.ps1"),
        "-NodeDistribution", NODE_DISTRIBUTION,
        "pr", "--json",
      ], { encoding: "utf8", shell: false })
      expect(child.status).not.toBe(0)
      expect(child.stderr).toBe("")
      expect(JSON.parse(child.stdout)).toMatchObject({ command: "verification-launcher", status: "FAIL" })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("runs a normal focused lifecycle through the trusted launcher with the approved nested identity", { timeout: 60_000 }, () => {
    const pwsh = process.platform === "win32"
      ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe"
      : "/usr/bin/pwsh"
    if (!existsSync(pwsh)) return
    const launcher = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "rg-verify.ps1")
    const child = spawnSync(pwsh, [
      "-NoProfile", "-File", launcher,
      "-NodeDistribution", NODE_DISTRIBUTION,
      "focused", "--file", "docs/developer-workflow.md", "--json",
    ], {
      encoding: "utf8",
      shell: false,
      env: {
        ...process.env,
        RG_DATABASE_URL: "sentinel-rg-database",
        DATABASE_URL: "sentinel-database",
        SUPABASE_SERVICE_ROLE_KEY: "sentinel-supabase",
        VERCEL_TOKEN: "sentinel-vercel",
        GITHUB_TOKEN: "sentinel-github",
        AWS_SECRET_ACCESS_KEY: "sentinel-aws",
        UNRELATED_SECRET: "sentinel-unrelated",
      },
    })
    expect(child.status).toBe(0)
    expect(child.stderr).toBe("")
    const report = JSON.parse(child.stdout)
    expect(report).toMatchObject({ status: "PASS", requestedTier: "FOCUSED" })
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "nested-runtime-authority", status: "PASS" }))
    for (const sentinel of ["sentinel-rg-database", "sentinel-database", "sentinel-supabase", "sentinel-vercel", "sentinel-github", "sentinel-aws", "sentinel-unrelated"]) {
      expect(child.stdout).not.toContain(sentinel)
    }
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

  it("accepts deployment evidence only as optional corroborative PASS", () => {
    const value = completeReleaseReport({
      checks: [
        ...completeReleaseReport().checks,
        { name: "deployment-record", status: "PASS", authority: "CORROBORATIVE", detail: "matched" },
      ],
    })
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    expect(report.status).toBe("PASS")
    expect(report.releaseAuthorityEvaluation.at(-1)).toMatchObject({
      declaredEvidenceType: "deployment-record",
      allowedAuthority: "CORROBORATIVE",
      suppliedAuthority: "CORROBORATIVE",
      requirementStatus: "OPTIONAL",
      effect: "NO_EFFECT",
      rejectionReason: null,
    })
  })

  it("keeps explicit optional corroborative warnings visible without blocking PASS", () => {
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
    expect(report.status).toBe("PASS")
    expect(report.checks[0].status).toBe("PASS")
    expect(report.releaseAuthorityEvaluation.at(-1)).toMatchObject({ required: false, authority: "CORROBORATIVE", effect: "NO_EFFECT" })
    expect(renderVerificationText(report)).toContain("Optional deployment evidence is unavailable.")
  })

  it.each([
    ["optional corroborative skip", { name: "deployment-record", status: "SKIP", authority: "CORROBORATIVE", detail: "optional skip" }, "PASS"],
    ["optional corroborative unavailable", { name: "deployment-record", status: "UNAVAILABLE", authority: "CORROBORATIVE", detail: "optional unavailable" }, "PASS"],
    ["optional corroborative failure", { name: "deployment-record", status: "FAIL", authority: "CORROBORATIVE", detail: "contradictory outcome" }, "FAIL"],
    ["required authoritative warning", { ...completeReleaseReport().checks[0], status: "WARN" }, "FAIL"],
    ["required authoritative skip", { ...completeReleaseReport().checks[0], status: "SKIP" }, "FAIL"],
    ["required authoritative unavailable", { ...completeReleaseReport().checks[0], status: "UNAVAILABLE" }, "FAIL"],
    ["required authoritative failure", { ...completeReleaseReport().checks[0], status: "FAIL" }, "FAIL"],
    ["fabricated optional label on required check", { ...completeReleaseReport().checks[0], authority: "CORROBORATIVE", status: "WARN" }, "FAIL"],
  ])("enforces %s", (_label, replacement, expected) => {
    const value = completeReleaseReport()
    const requiredIndex = value.checks.findIndex((item) => item.name === replacement.name)
    if (requiredIndex >= 0) value.checks[requiredIndex] = replacement
    else value.checks.push(replacement)
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    expect(report.status).toBe(expected)
  })

  it.each(["PASS", "WARN", "SKIP", "UNAVAILABLE", "FAIL"])(
    "rejects AUTHORITATIVE deployment evidence with %s status",
    (status) => {
      const value = completeReleaseReport({
        checks: [
          ...completeReleaseReport().checks,
          { name: "deployment-record", status, authority: "AUTHORITATIVE", detail: "relabelled" },
        ],
      })
      const report = runReleaseVerification({
        commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
      })
      expect(report.status).toBe("FAIL")
      expect(report.releaseAuthorityEvaluation.at(-1)).toMatchObject({
        declaredEvidenceType: "deployment-record",
        allowedAuthority: "CORROBORATIVE",
        suppliedAuthority: "AUTHORITATIVE",
        requirementStatus: "OPTIONAL",
        effect: "REJECTED",
        rejectionReason: expect.stringContaining("not allowed"),
      })
    },
  )

  it("rejects a fabricated required label on optional deployment evidence", () => {
    const value = completeReleaseReport({
      checks: [
        ...completeReleaseReport().checks,
        {
          name: "deployment-record",
          status: "PASS",
          authority: "CORROBORATIVE",
          required: true,
          detail: "fabricated requirement",
        },
      ],
    })
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    expect(report.status).toBe("FAIL")
    expect(report.releaseAuthorityEvaluation.at(-1)).toMatchObject({
      requirementStatus: "OPTIONAL",
      suppliedRequirement: "REQUIRED",
      effect: "REJECTED",
      rejectionReason: expect.stringContaining("conflicts"),
    })
  })

  it("rejects unknown and duplicate evidence types", () => {
    const unknown = completeReleaseReport({
      checks: [
        ...completeReleaseReport().checks,
        { name: "fabricated-proof", status: "PASS", authority: "AUTHORITATIVE", detail: "unknown" },
      ],
    })
    const duplicate = completeReleaseReport()
    duplicate.checks.push({ ...duplicate.checks[0] })
    for (const value of [unknown, duplicate]) {
      const report = runReleaseVerification({
        commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
      })
      expect(report.status).toBe("FAIL")
      expect(report.releaseAuthorityEvaluation.some((item) => item.effect === "REJECTED")).toBe(true)
    }
  })

  it("shows policy-derived evidence semantics and rejection in human and JSON output", () => {
    const value = completeReleaseReport({
      checks: [
        ...completeReleaseReport().checks,
        { name: "deployment-record", status: "PASS", authority: "AUTHORITATIVE", detail: "relabelled" },
      ],
    })
    const report = runReleaseVerification({
      commandRunner: () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify(value) }),
    })
    const human = renderVerificationText(report)
    const json = JSON.parse(renderVerificationJson(report))
    expect(human).toContain(
      "requirement=OPTIONAL; allowed-authority=CORROBORATIVE; supplied-authority=AUTHORITATIVE; effect=REJECTED",
    )
    expect(human).toContain("rejected:")
    expect(json.releaseAuthorityEvaluation.at(-1)).toMatchObject({
      declaredEvidenceType: "deployment-record",
      allowedAuthority: "CORROBORATIVE",
      suppliedAuthority: "AUTHORITATIVE",
      requirementStatus: "OPTIONAL",
      effect: "REJECTED",
    })
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
