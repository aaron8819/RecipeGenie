import { spawnSync } from "node:child_process"

const command = "npx supabase --workdir .. migration list"

const result = spawnSync(command, {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: true,
  stdio: "pipe",
})

const stdout = result.stdout ?? ""
const stderr = result.stderr ?? ""

if (stdout.trim()) {
  process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`)
}

if (stderr.trim()) {
  process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`)
}

if (result.error) {
  console.error(`Failed to launch Supabase CLI: ${result.error.message}`)
  process.exit(1)
}

if (result.status !== 0) {
  console.error("Supabase migration preflight failed before drift analysis completed.")
  console.error("Confirm the correct project is linked and that the Supabase CLI can reach the target database.")
  process.exit(result.status ?? 1)
}

const rows = stdout
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*([^\s|]+)?\s*\|\s*([^\s|]+)?\s*\|\s*([^\s|]+)?\s*$/))
  .filter(Boolean)
  .map((match) => ({
    local: match[1] ?? "",
    remote: match[2] ?? "",
    time: match[3] ?? "",
  }))
  .filter((row) => row.local !== "Local" && row.local !== "-------")

if (rows.length === 0) {
  console.error("No migration rows were parsed from `supabase migration list`.")
  console.error("Do not push until you inspect the CLI output manually.")
  process.exit(1)
}

const driftRows = rows.filter((row) => row.local !== row.remote || !row.local || !row.remote)

if (driftRows.length > 0) {
  console.error("Migration history drift detected. Do not run `supabase db push` yet.")
  for (const row of driftRows) {
    console.error(`- local=${row.local || "(missing)"} remote=${row.remote || "(missing)"} time=${row.time || "(unknown)"}`)
  }
  console.error("If this is the known baseline-squash case, follow the runbook in `supabase/SCHEMA.md` before repairing history.")
  console.error("Otherwise stop and investigate why local and remote migration chains diverged.")
  process.exit(1)
}

console.log("Migration histories are aligned for the linked project.")
console.log("Next steps: verify you linked the intended environment, then run `npx supabase --workdir .. db push` if you are ready.")
console.log("After a schema change, regenerate types with `npm run db:types:regen:linked` and run `npm run typecheck`.")
