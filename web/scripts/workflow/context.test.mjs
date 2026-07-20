import path from "node:path"
import { describe, expect, it } from "vitest"
import { collectDoctorReport, renderDoctorJson, renderDoctorReport } from "./context.mjs"

const SHA = "732d59966d7d8dfbf54bd077a568095b9fd8bb41"
const PROJECT_REF = "eyaoahwzixqetjgfghsh"

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
  const baselinePath = path.join(repositoryRoot, "supabase", "migrations", "001_baseline.sql")
  const linkPath = path.join(repositoryRoot, "supabase", ".temp", "project-ref")
  const exists = (candidate) => {
    if ([packagePath, baselinePath].includes(candidate)) return true
    if (candidate === linkPath) return linkedReference !== undefined
    if (overrides.extraExists?.(candidate)) return true
    return toolNames.some((tool) => path.basename(candidate).replace(/\.(cmd|exe|bat)$/i, "") === tool)
  }
  const readText = (candidate) => {
    if (candidate === packagePath) return JSON.stringify({ name: "recipe-genie" })
    if (candidate === linkPath) return linkedReference
    throw new Error(`unexpected read: ${candidate}`)
  }
  const report = collectDoctorReport({
    cwd: repositoryRoot,
    environment,
    commandRunner,
    exists,
    readText,
    homeDirectory: path.resolve("C:/home"),
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
