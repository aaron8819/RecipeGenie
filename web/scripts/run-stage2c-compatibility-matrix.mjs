import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const isWindows = process.platform === "win32"
const runner = isWindows ? "npx" : "npx"
const spawnOptions = { cwd: process.cwd(), encoding: "utf8", shell: isWindows }
const config = readFileSync("../supabase/config.toml", "utf8")
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error("Could not resolve the local Supabase project ID")

function runSupabase(args, stdio = "inherit") {
  const result = spawnSync(runner, ["supabase", "--workdir", "..", ...args], {
    ...spawnOptions,
    stdio,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Supabase command failed with exit code ${result.status}`)
  }
  return result
}

function refreshLocalGateway() {
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectId}`,
      "--format",
      "{{.Names}}",
    ],
    { ...spawnOptions, shell: false }
  )
  if (listed.error) throw listed.error
  if (listed.status !== 0) throw new Error("Could not inspect the local Supabase gateway")
  const gateways = listed.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_kong_"))
  if (gateways.length !== 1) {
    throw new Error(`Expected one local Supabase gateway, found ${gateways.length}`)
  }
  const restarted = spawnSync("docker", ["restart", gateways[0]], {
    ...spawnOptions,
    shell: false,
    stdio: "pipe",
  })
  if (restarted.error) throw restarted.error
  if (restarted.status !== 0) throw new Error("Could not refresh the local Supabase gateway")
}

function localEnvironment() {
  const status = runSupabase(["status", "-o", "json"], "pipe")
  const values = JSON.parse(status.stdout)
  for (const key of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (!values[key]) throw new Error(`Local Supabase status omitted ${key}`)
  }
  return values
}

function runMatrix(schemaVersion) {
  const local = localEnvironment()
  const result = spawnSync(
    runner,
    ["vitest", "--config", "vitest.compatibility.config.ts", "--run"],
    {
      ...spawnOptions,
      stdio: "inherit",
      env: {
        ...process.env,
        STAGE2C_MATRIX_SCHEMA: schemaVersion,
        STAGE2C_MATRIX_API_URL: local.API_URL,
        STAGE2C_MATRIX_ANON_KEY: local.ANON_KEY,
        STAGE2C_MATRIX_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      },
    }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Migration ${schemaVersion} compatibility matrix failed`)
  }
}

let restoredToLatest = false
try {
  runSupabase(["db", "reset", "--local", "--version", "011", "--no-seed"])
  refreshLocalGateway()
  runMatrix("011")

  runSupabase(["db", "reset", "--local", "--no-seed"])
  refreshLocalGateway()
  restoredToLatest = true
  runMatrix("014")
} finally {
  if (!restoredToLatest) {
    runSupabase(["db", "reset", "--local", "--no-seed"])
    refreshLocalGateway()
  }
}

console.log("Stage 2C compatibility matrix passed for migration 011 and latest migration 014.")
