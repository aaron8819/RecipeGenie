// Record only exit/source identity. Never read or upload arbitrary process output.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Diagnostic receipt requires an ephemeral hosted runner');
}
const exitCode = Number(process.argv[2]);
if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
  throw new Error('Exact Playwright exit code required');
}
const directory = path.resolve('../.codex-artifacts/combined-ui');
writeFileSync(path.join(directory, 'webserver-exit.json'), JSON.stringify({
  sha: process.env.COMBINED_UI_EXPECTED_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  playwrightExitCode: exitCode,
  diagnostic: 'Raw process output omitted; see structured case stage/status receipts',
}, null, 2));
