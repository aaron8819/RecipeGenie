import { parseArgs } from "../operational/runtime.mjs"
import { collectDoctorReport, renderDoctorJson, renderDoctorReport } from "./context.mjs"

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  const unknown = Object.keys(args).filter((key) => key !== "json")
  if (unknown.length) throw new Error(`unsupported rg:doctor option: --${unknown[0]}`)
  const report = collectDoctorReport()
  process.stdout.write(args.json ? renderDoctorJson(report) : `${renderDoctorReport(report)}\n`)
  return report.status === "BLOCKED" ? 2 : 0
}

try {
  process.exitCode = main()
} catch {
  process.stderr.write("STATUS: BLOCKED\nrg:doctor failed before report generation; review command syntax.\n")
  process.exitCode = 2
}
