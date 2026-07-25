import path from "node:path"
import { describe, expect, it } from "vitest"
import { collectDoctorReport, renderDoctorJson, renderDoctorReport } from "./context.mjs"

const SHA = "732d59966d7d8dfbf54bd077a568095b9fd8bb41"
const PROJECT_REF = "eyaoahwzixqetjgfghsh"
const HOME_DIRECTORY = path.resolve("C:/home")

function fixture(overrides = {}) {
  const primaryRoot = path.resolve("C:/workspace/Recipe Genie")
  const repositoryRoot = overrides.repositoryRoot || path.join(path.dirname(primaryRoot), ".worktrees", "recipe-genie", "workflow-doctor")
  const branch = overrides.branch ?? "codex/workflow-doctor"
  const linkedReference = overrides.linkedReference
  const commands = []
  const toolNames = overrides.toolNames ?? ["git", "pwsh", "docker", "supabase", "psql", "pg_dump", "gh", "vercel"]
  const environment = {
    PATH: path.resolve("C:/tools"),
    npm_config_user_agent: "npm/10.9.8 node/v22.23.1 win32 x64",
    ...(overrides.environment || {}),
  }
  const commandRunner = (command, args) => {
    commands.push({ command, args: [...args] })
    const key = args.join(" ")
    if (key === "rev-parse --show-toplevel") return { exitCode: 0, stdout: `${repositoryRoot}\n` }
    if (key === "rev-parse HEAD") return { exitCode: 0, stdout: `${SHA}\n` }
    if (key === "branch --show-current") return { exitCode: 0, stdout: `${branch}\n` }
    if (key === "--no-optional-locks status --porcelain --untracked-files=normal") return { exitCode: 0, stdout: overrides.dirty ? " M web/package.json\n" : "" }
    if (key === "worktree list --porcelain") return { exitCode: 0, stdout: `worktree ${primaryRoot}\nHEAD ${SHA}\nbranch refs/heads/main\n\nworktree ${repositoryRoot}\nHEAD ${SHA}\nbranch refs/heads/${branch}\n` }
    return { exitCode: 1, stdout: "" }
  }
  const packagePath = path.join(repositoryRoot, "web", "package.json")
  const nodePinPath = path.join(repositoryRoot, "web", ".nvmrc")
  const baselinePath = path.join(repositoryRoot, "supabase", "migrations", "001_baseline.sql")
  const linkPath = path.join(repositoryRoot, "supabase", ".temp", "project-ref")
  const exists = (candidate) => {
    if ([packagePath, nodePinPath, baselinePath].includes(candidate)) return true
    if (candidate === linkPath) return linkedReference !== undefined
    if (overrides.extraExists?.(candidate)) return true
    return toolNames.some((tool) => path.basename(candidate).replace(/\.(cmd|exe|bat)$/i, "") === tool)
  }
  const readText = (candidate) => {
    if (candidate === packagePath) {
      return JSON.stringify({
        name: "recipe-genie",
        packageManager: overrides.packageManager || "npm@10.9.8",
      })
    }
    if (candidate === nodePinPath) return overrides.nodePin || "22.23.1"
    if (candidate === linkPath) return linkedReference
    throw new Error(`unexpected read: ${candidate}`)
  }
  const isDirectory = (candidate) => {
    if (overrides.extraIsDirectory?.(candidate)) return true
    return (overrides.directories || []).includes(candidate)
  }
  const report = collectDoctorReport({
    cwd: repositoryRoot,
    environment,
    commandRunner,
    exists,
    isDirectory,
    readText,
    homeDirectory: HOME_DIRECTORY,
    nodeVersion: overrides.nodeVersion || "v22.23.1",
    npmVersion: overrides.npmVersion === undefined ? "10.9.8" : overrides.npmVersion,
    platform: overrides.platform,
  })
  return { report, commands, primaryRoot, repositoryRoot }
}

describe("workflow doctor context", () => {
  it("reports clean and dirty repository states", () => {
    expect(fixture().report.git.dirty).toBe(false)
    expect(fixture({ dirty: true }).report.git.dirty).toBe(true)
  })

  it("distinguishes primary, compliant, and noncompliant worktrees", () => {
    const primary = fixture({ repositoryRoot: path.resolve("C:/workspace/Recipe Genie"), branch: "main" }).report
    expect(primary.git).toMatchObject({ worktree: "primary", pathCompliant: true, branchCompliant: true })

    const compliant = fixture().report
    expect(compliant.git).toMatchObject({ worktree: "linked", pathCompliant: true, branchCompliant: true })

    const noncompliant = fixture({ repositoryRoot: path.resolve("C:/workspace/Recipe Genie-work"), branch: "feature/work" }).report
    expect(noncompliant.status).toBe("BLOCKED")
    expect(noncompliant.blockers.join(" ")).toMatch(/path.*convention/i)
    expect(noncompliant.blockers.join(" ")).toMatch(/branch.*convention/i)
  })

  it("reports present, missing, and unsupported tools and runtimes independently", () => {
    const report = fixture({ toolNames: ["git"], nodeVersion: "v24.0.0", npmVersion: "11.0.0" }).report
    expect(report.tools.git.available).toBe(true)
    expect(report.tools.docker.available).toBe(false)
    expect(report.runtime).toMatchObject({ nodeSupported: false, npmSupported: false })
    expect(report.actions).toEqual(expect.arrayContaining([expect.stringMatching(/Node 22/), expect.stringMatching(/npm 10/)]))
  })

  it("derives exact runtime pins and rejects versions that differ from them", () => {
    const matching = fixture().report
    expect(matching.runtime).toMatchObject({
      expectedNode: "22.23.1",
      nodeSupported: true,
      expectedNpm: "10.9.8",
      npmSupported: true,
    })

    const mismatched = fixture({
      nodeVersion: "v22.23.0",
      npmVersion: "10.9.7",
    }).report
    expect(mismatched.runtime).toMatchObject({
      nodeSupported: false,
      npmSupported: false,
    })
    expect(renderDoctorReport(mismatched)).toContain(
      "Node actual=v22.23.0 expected=22.23.1 (MISMATCH); npm actual=10.9.7 expected=10.9.8 (MISMATCH)",
    )
  })

  it("discovers PostgreSQL clients from the standard Windows installation", () => {
    const programFiles = path.resolve("C:/Program Files")
    const report = fixture({
      toolNames: ["git"],
      platform: "win32",
      environment: { ProgramFiles: programFiles },
      extraExists: (candidate) => candidate === path.join(programFiles, "PostgreSQL", "17", "bin", "psql.exe")
        || candidate === path.join(programFiles, "PostgreSQL", "17", "bin", "pg_dump.exe"),
    }).report
    expect(report.tools.psql.available).toBe(true)
    expect(report.tools.pgDump.available).toBe(true)
  })

  it("reports credential presence without disclosing values in text or JSON", () => {
    const secret = "fixture-secret-value-12345"
    const report = fixture({ environment: { RECIPE_GENIE_SUPABASE_ACCESS_TOKEN: secret, VERCEL_TOKEN: secret } }).report
    const text = renderDoctorReport(report)
    const json = renderDoctorJson(report)
    expect(text).toContain("RECIPE_GENIE_SUPABASE_ACCESS_TOKEN: PRESENT (value hidden)")
    expect(json).toContain('"present": true')
    expect(text).not.toContain(secret)
    expect(json).not.toContain(secret)
  })

  it("uses GH_CONFIG_DIR as the exclusive GitHub credential location", () => {
    const configDirectory = path.resolve("C:/gh-override")
    const credentialPath = path.join(configDirectory, "hosts.yml")
    const report = fixture({
      toolNames: ["git", "gh"],
      environment: { GH_CONFIG_DIR: configDirectory },
      extraExists: (candidate) => candidate === credentialPath,
    }).report
    expect(report.providers.github).toMatchObject({
      credentialEvidence: true,
      localReady: true,
    })

    const staleFallbacks = [
      path.join(path.resolve("C:/xdg-config"), "gh", "hosts.yml"),
      path.join(path.resolve("C:/app-data"), "GitHub CLI", "hosts.yml"),
      path.join(HOME_DIRECTORY, ".config", "gh", "hosts.yml"),
    ]
    const staleReport = fixture({
      platform: "win32",
      toolNames: ["git", "gh"],
      environment: {
        GH_CONFIG_DIR: configDirectory,
        XDG_CONFIG_HOME: path.resolve("C:/xdg-config"),
        APPDATA: path.resolve("C:/app-data"),
      },
      extraExists: (candidate) => staleFallbacks.includes(candidate),
    }).report
    expect(staleReport.providers.github.credentialEvidence).toBe(false)
    expect(staleReport.providers.github.localReady).toBe(false)
  })

  it("uses XDG_CONFIG_HOME before lower-priority GitHub locations", () => {
    const xdgConfigHome = path.resolve("C:/xdg-config")
    const credentialPath = path.join(xdgConfigHome, "gh", "hosts.yml")
    const recognized = fixture({
      platform: "win32",
      toolNames: ["git", "gh"],
      environment: {
        XDG_CONFIG_HOME: xdgConfigHome,
        APPDATA: path.resolve("C:/app-data"),
      },
      extraExists: (candidate) => candidate === credentialPath,
    }).report
    expect(recognized.providers.github.localReady).toBe(true)

    const lowerPriorityPaths = [
      path.join(path.resolve("C:/app-data"), "GitHub CLI", "hosts.yml"),
      path.join(HOME_DIRECTORY, ".config", "gh", "hosts.yml"),
    ]
    const stale = fixture({
      platform: "win32",
      toolNames: ["git", "gh"],
      environment: {
        XDG_CONFIG_HOME: xdgConfigHome,
        APPDATA: path.resolve("C:/app-data"),
      },
      extraExists: (candidate) => lowerPriorityPaths.includes(candidate),
    }).report
    expect(stale.providers.github.localReady).toBe(false)
  })

  it("uses Windows AppData for GitHub only without higher-priority overrides", () => {
    const appData = path.resolve("C:/app-data")
    const credentialPath = path.join(appData, "GitHub CLI", "hosts.yml")
    const report = fixture({
      platform: "win32",
      toolNames: ["git", "gh"],
      environment: { APPDATA: appData },
      extraExists: (candidate) => candidate === credentialPath,
    }).report
    expect(report.providers.github.localReady).toBe(true)
  })

  it("uses HOME/.config/gh as GitHub's final fallback", () => {
    const credentialPath = path.join(
      HOME_DIRECTORY,
      ".config",
      "gh",
      "hosts.yml",
    )
    const report = fixture({
      platform: "win32",
      toolNames: ["git", "gh"],
      extraExists: (candidate) => candidate === credentialPath,
    }).report
    expect(report.providers.github.localReady).toBe(true)
  })

  it.each([
    [
      "Windows",
      "win32",
      path.resolve("C:/app-data"),
      path.join(
        path.resolve("C:/app-data"),
        "com.vercel.cli",
        "Data",
      ),
    ],
    [
      "macOS",
      "darwin",
      undefined,
      path.join(
        HOME_DIRECTORY,
        "Library",
        "Application Support",
        "com.vercel.cli",
      ),
    ],
    [
      "Linux",
      "linux",
      undefined,
      path.join(HOME_DIRECTORY, ".local", "share", "com.vercel.cli"),
    ],
  ])("discovers the effective Vercel credential on %s", (
    _label,
    platform,
    appData,
    configDirectory,
  ) => {
    const report = fixture({
      platform,
      toolNames: ["git", "vercel"],
      environment: appData ? { APPDATA: appData } : {},
      directories: [configDirectory],
      extraExists: (candidate) => (
        candidate === path.join(configDirectory, "auth.json")
      ),
    }).report
    expect(report.providers.vercel).toMatchObject({
      credentialEvidence: true,
      localReady: true,
      authentication: "not remotely verified",
    })
  })

  it("uses XDG_DATA_HOME for Vercel on every supported platform", () => {
    const xdgDataHome = path.resolve("C:/xdg-data")
    const configDirectory = path.join(xdgDataHome, "com.vercel.cli")
    for (const platform of ["win32", "darwin", "linux"]) {
      const report = fixture({
        platform,
        toolNames: ["git", "vercel"],
        environment: {
          XDG_DATA_HOME: xdgDataHome,
          APPDATA: path.resolve("C:/app-data"),
        },
        directories: [configDirectory],
        extraExists: (candidate) => (
          candidate === path.join(configDirectory, "auth.json")
        ),
      }).report
      expect(report.providers.vercel.localReady).toBe(true)
    }
  })

  it("searches Vercel XDG_DATA_DIRS in order before legacy locations", () => {
    const firstShared = path.join(
      "/shared/first",
      "com.vercel.cli",
    )
    const secondShared = path.join(
      "/shared/second",
      "com.vercel.cli",
    )
    const report = fixture({
      platform: "linux",
      toolNames: ["git", "vercel"],
      environment: {
        XDG_DATA_DIRS: "/shared/first:/shared/second",
      },
      directories: [secondShared],
      extraExists: (candidate) => (
        candidate === path.join(secondShared, "auth.json")
      ),
    }).report
    expect(report.providers.vercel.localReady).toBe(true)

    const firstDirectoryWins = fixture({
      platform: "linux",
      toolNames: ["git", "vercel"],
      environment: {
        XDG_DATA_DIRS: "/shared/first:/shared/second",
      },
      directories: [firstShared, secondShared],
      extraExists: (candidate) => (
        candidate === path.join(secondShared, "auth.json")
      ),
    }).report
    expect(firstDirectoryWins.providers.vercel.localReady).toBe(false)
  })

  it("matches Vercel's current and legacy directory precedence", () => {
    const currentDirectory = path.join(
      HOME_DIRECTORY,
      ".local",
      "share",
      "com.vercel.cli",
    )
    const legacyHome = path.join(HOME_DIRECTORY, ".now")
    const legacyXdg = path.join(
      HOME_DIRECTORY,
      ".local",
      "share",
      "now",
    )
    const staleCredential = path.join(legacyXdg, "auth.json")

    const currentWins = fixture({
      platform: "linux",
      toolNames: ["git", "vercel"],
      directories: [currentDirectory, legacyHome, legacyXdg],
      extraExists: (candidate) => candidate === staleCredential,
    }).report
    expect(currentWins.providers.vercel.localReady).toBe(false)

    const legacyHomeWins = fixture({
      platform: "linux",
      toolNames: ["git", "vercel"],
      directories: [legacyHome, legacyXdg],
      extraExists: (candidate) => candidate === staleCredential,
    }).report
    expect(legacyHomeWins.providers.vercel.localReady).toBe(false)

    const legacyXdgUsed = fixture({
      platform: "linux",
      toolNames: ["git", "vercel"],
      directories: [legacyXdg],
      extraExists: (candidate) => candidate === staleCredential,
    }).report
    expect(legacyXdgUsed.providers.vercel.localReady).toBe(true)
  })

  it("ignores Vercel credentials in overridden or wrong-platform locations", () => {
    const appData = path.resolve("C:/app-data")
    const staleWindowsCredential = path.join(
      appData,
      "com.vercel.cli",
      "Data",
      "auth.json",
    )
    const overridden = fixture({
      platform: "win32",
      toolNames: ["git", "vercel"],
      environment: {
        XDG_DATA_HOME: path.resolve("C:/xdg-data"),
        APPDATA: appData,
      },
      extraExists: (candidate) => candidate === staleWindowsCredential,
    }).report
    expect(overridden.providers.vercel.localReady).toBe(false)

    const wrongPlatform = fixture({
      platform: "darwin",
      toolNames: ["git", "vercel"],
      environment: { APPDATA: appData },
      extraExists: (candidate) => candidate === staleWindowsCredential,
    }).report
    expect(wrongPlatform.providers.vercel.localReady).toBe(false)
  })

  it("keeps GitHub and Vercel readiness independent for mixed evidence", () => {
    const githubToolWithVercelCredential = fixture({
      toolNames: ["git", "gh"],
      environment: { VERCEL_TOKEN: "fixture-vercel-token" },
    }).report
    expect(githubToolWithVercelCredential.providers.github.localReady).toBe(false)
    expect(githubToolWithVercelCredential.providers.vercel.localReady).toBe(false)
    expect(githubToolWithVercelCredential.capabilities["deployment-modification"].possible).toBe(false)

    const vercelToolWithGithubCredential = fixture({
      toolNames: ["git", "vercel"],
      environment: { GH_TOKEN: "fixture-github-token" },
    }).report
    expect(vercelToolWithGithubCredential.providers.github.localReady).toBe(false)
    expect(vercelToolWithGithubCredential.providers.vercel.localReady).toBe(false)
    expect(vercelToolWithGithubCredential.capabilities["deployment-modification"].possible).toBe(false)
  })

  it("does not use stale filesystem evidence for either provider", () => {
    const appData = path.resolve("C:/app-data")
    const stalePaths = [
      path.join(HOME_DIRECTORY, ".config", "gh", "hosts.yml"),
      path.join(appData, "com.vercel.cli", "Data", "auth.json"),
    ]
    const report = fixture({
      platform: "win32",
      toolNames: ["git", "gh", "vercel"],
      environment: {
        GH_CONFIG_DIR: path.resolve("C:/gh-override"),
        XDG_DATA_HOME: path.resolve("C:/xdg-data"),
        APPDATA: appData,
      },
      extraExists: (candidate) => stalePaths.includes(candidate),
    }).report
    expect(report.providers.github.localReady).toBe(false)
    expect(report.providers.vercel.localReady).toBe(false)
  })

  it("reports each provider ready only with its own paired evidence", () => {
    const report = fixture({
      toolNames: ["git", "gh", "vercel"],
      environment: {
        GH_TOKEN: "fixture-github-token",
        VERCEL_TOKEN: "fixture-vercel-token",
      },
    }).report
    expect(report.providers.github.localReady).toBe(true)
    expect(report.providers.vercel.localReady).toBe(true)
    expect(report.capabilities["deployment-inspection"].possible).toBe(true)
    expect(renderDoctorReport(report)).toContain("Provider readiness (local evidence only)")
    expect(renderDoctorReport(report)).toContain("authentication not remotely verified")
  })

  it.each([
    ["direct", `postgresql://postgres:fixture@db.${PROJECT_REF}.supabase.co/postgres`],
    ["session-pooler", `postgresql://postgres.${PROJECT_REF}:fixture@aws-0.pooler.supabase.com:5432/postgres`],
    ["transaction-pooler", `postgresql://postgres.${PROJECT_REF}:fixture@aws-0.pooler.supabase.com:6543/postgres`],
    ["unknown", `postgresql://postgres.${PROJECT_REF}:fixture@aws-0.pooler.supabase.com:6432/postgres`],
  ])("classifies %s database endpoints without exposing the URL", (expected, databaseUrl) => {
    const report = fixture({ environment: { RECIPE_GENIE_PRODUCTION_DATABASE_URL: databaseUrl } }).report
    expect(report.database.type).toBe(expected)
    expect(renderDoctorReport(report)).not.toContain(databaseUrl)
  })

  it("blocks when either configured database endpoint contradicts the approved project", () => {
    const report = fixture({
      environment: {
        RECIPE_GENIE_PRODUCTION_DATABASE_URL: `postgresql://postgres:fixture@db.${PROJECT_REF}.supabase.co/postgres`,
        RG_DATABASE_URL: "postgresql://postgres:fixture@example.invalid/postgres",
      },
    }).report
    expect(report.status).toBe("BLOCKED")
    expect(report.blockers.join(" ")).toMatch(/database endpoint/i)
    expect(report.capabilities["read-only-production-verification"].possible).toBe(false)
  })

  it("allows a missing local Supabase link when explicit identity matches", () => {
    const report = fixture({ environment: { RECIPE_GENIE_PRODUCTION_PROJECT_REF: PROJECT_REF } }).report
    expect(report.project.linked.present).toBe(false)
    expect(report.blockers).toEqual([])
    expect(report.warnings.join(" ")).toMatch(/link is absent/i)
  })

  it("accepts a matching link and blocks a contradictory link", () => {
    const matching = fixture({ linkedReference: PROJECT_REF, environment: { RECIPE_GENIE_PRODUCTION_PROJECT_REF: PROJECT_REF } }).report
    expect(matching.project.linked.matchesExpected).toBe(true)
    expect(matching.blockers).toEqual([])

    const contradictory = fixture({ linkedReference: "aaaaaaaaaaaaaaaaaaaa", environment: { RECIPE_GENIE_PRODUCTION_PROJECT_REF: PROJECT_REF } }).report
    expect(contradictory.status).toBe("BLOCKED")
    expect(contradictory.blockers.join(" ")).toMatch(/link contradicts/i)
  })

  it("uses only local read-only Git discovery commands", () => {
    const { commands } = fixture()
    expect(commands.length).toBeGreaterThanOrEqual(5)
    expect(commands.every(({ command }) => command === "git")).toBe(true)
    expect(commands.flatMap(({ args }) => args).join(" ")).not.toMatch(/https?:\/\/|push|fetch|pull/)
  })
})
