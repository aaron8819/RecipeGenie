#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  MigrationPreflightError,
  analyzeMigrationState,
  loadMigrationDirectory,
  migrationsFromList,
  parseExpectedPendingOption,
  parseMigrationList,
} from "./db-preflight-core.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..")
const repositoryRoot = resolve(webDirectory, "..")
const supabaseDirectory = join(repositoryRoot, "supabase")
const supabaseScript = join(
  webDirectory,
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
)

function printOutput(result) {
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""

  if (stdout.trim()) {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`)
  }
  if (stderr.trim()) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`)
  }
}

function runSupabase(args, { print = false } = {}) {
  const result = spawnSync(process.execPath, [supabaseScript, ...args], {
    cwd: webDirectory,
    encoding: "utf8",
    shell: false,
    stdio: "pipe",
  })

  if (print) printOutput(result)
  if (result.error) {
    throw new Error(`Failed to launch the pinned Supabase CLI: ${result.error.message}`)
  }
  if (result.status !== 0) {
    if (!print) printOutput(result)
    throw new Error(
      "Supabase migration preflight failed before drift analysis completed. "
      + "Confirm the correct project is linked and that the Supabase CLI can reach the target database.",
    )
  }
  return result.stdout ?? ""
}

async function main() {
  const options = parseExpectedPendingOption(
    process.argv.slice(2),
    process.env.npm_config_expected_pending,
  )
  if (options.help) {
    console.log("Usage: npm run db:preflight -- [--expected-pending VERSION]")
    console.log("Example rollout opt-in: npm run db:preflight -- --expected-pending 014")
    return
  }

  const checksumRegistry = JSON.parse(await readFile(
    join(supabaseDirectory, "migration-checksums.json"),
    "utf8",
  ))
  const localMigrations = await loadMigrationDirectory(
    join(supabaseDirectory, "migrations"),
    checksumRegistry,
  )
  const listOutput = runSupabase([
    "--workdir",
    repositoryRoot,
    "migration",
    "list",
    "--linked",
  ], { print: true })
  const listRows = parseMigrationList(listOutput)
  const remoteMigrations = migrationsFromList(listRows, localMigrations)

  const result = analyzeMigrationState({
    localMigrations,
    remoteMigrations,
    expectedPending: options.expectedPending,
  })

  if (result.status === "expected-pending") {
    console.log(
      `Migration histories match through ${result.latestRemote}; `
      + `local migration ${result.expectedPending} is the sole explicitly expected pending tail migration.`,
    )
    console.log("Migration preflight status: EXPECTED PENDING.")
  } else {
    console.log("Migration histories and registered checksums are aligned for the linked project.")
    console.log("Migration preflight status: ALIGNED.")
  }
  console.log(
    "Next steps: verify you linked the intended environment, then run "
    + "`npx supabase --workdir .. db push` only under separate migration authorization.",
  )
}

main().catch((error) => {
  if (error instanceof MigrationPreflightError) {
    const prefix = error.category === "invalid-configuration"
      ? "Invalid expected-pending configuration"
      : "Migration history drift detected"
    console.error(`${prefix}: ${error.message}`)
    if (error.category === "drift") {
      console.error("Do not run `supabase db push`; investigate the migration histories.")
      console.error(
        "If this is the known baseline-squash case, follow the runbook in "
        + "`supabase/SCHEMA.md` before repairing history.",
      )
    }
    process.exitCode = error.category === "invalid-configuration" ? 2 : 1
    return
  }

  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
