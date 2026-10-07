// Hosted-only capture of bounded, redacted Playwright startup/acceptance output.
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Diagnostic capture requires an ephemeral hosted runner');
}
const exitCode = Number(process.argv[2]);
if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
  throw new Error('Exact Playwright exit code required');
}
const rawPath = path.join(process.env.RUNNER_TEMP, 'combined-webserver.log');
const limit = 64 * 1024;
const size = statSync(rawPath).size;
const offset = Math.max(0, size - limit);
const buffer = Buffer.alloc(Math.min(size, limit));
const descriptor = openSync(rawPath, 'r');
try {
  readSync(descriptor, buffer, 0, buffer.length, offset);
} finally {
  closeSync(descriptor);
}
let text = buffer.toString('utf8');
// Drop a partial leading line, which could contain a truncated sensitive value.
if (offset) text = text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : '';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([^=]*(?:KEY|TOKEN|PASSWORD|SECRET)[^=]*)=(.+)$/.exec(line);
  if (match) text = text.split(match[2]).join('[REDACTED]');
}
text = text.replace(/\x1b\[[0-9;]*m/g, '')
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
  .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@');
const directory = path.resolve('../.codex-artifacts/combined-ui');
writeFileSync(path.join(directory, 'webserver-diagnostic.txt'), text);
writeFileSync(path.join(directory, 'webserver-exit.json'), JSON.stringify({
  sha: process.env.COMBINED_UI_EXPECTED_SHA,
  runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  playwrightExitCode: exitCode,
  capturedBytes: buffer.length,
  truncated: offset > 0,
}, null, 2));
