// Actions-only configuration. Never load a laptop env file or hosted project.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { localSupabaseEnvironment } from './local-e2e-runtime.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('Combined qualification requires an ephemeral GitHub-hosted runner');
}
if (process.env.SUPABASE_ACCESS_TOKEN || process.env.VERCEL || process.env.RG_DATABASE_URL) {
  throw new Error('Hosted infrastructure credentials/targets are forbidden');
}
const repository = path.resolve('..');
const capture = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // Node's raw child-process error can include generated keys in captured output.
    throw new Error(`Qualification ${command} metadata lookup failed`);
  }
};
const git = (...args) => capture('git', args);
const sha = git('rev-parse', 'HEAD');
if (!/^[0-9a-f]{40}$/.test(process.env.COMBINED_UI_EXPECTED_SHA || '') ||
  sha !== process.env.COMBINED_UI_EXPECTED_SHA || git('status', '--porcelain')) {
  throw new Error('Qualification requires the clean exact requested PR head');
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Inherited backend configuration is forbidden');
}
let local;
try {
  local = localSupabaseEnvironment(capture('supabase', ['status', '-o', 'env']));
} catch {
  throw new Error('Qualification requires the disposable loopback backend');
}
for (const secret of [local.anonKey, local.serviceRoleKey]) {
  process.stdout.write(`::add-mask::${secret}\n`);
}
if (existsSync('.env.local') || existsSync('.env.e2e.local')) {
  throw new Error('Fresh job must not contain inherited application/auth env files');
}
const tree = git('rev-parse', 'HEAD^{tree}');
const directory = path.join(repository, '.codex-artifacts', 'combined-ui');
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'identity.json'), JSON.stringify({
  schema: 1, sha, tree, runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT, backend: local.supabaseUrl,
  app: 'http://127.0.0.1:3107', isolated: 'github-hosted; job-local Supabase',
}, null, 2));
// Only generated disposable local keys. Ignored, never uploaded; no auth session files.
writeFileSync('.env.local', [
  `NEXT_PUBLIC_SUPABASE_URL=${local.supabaseUrl}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${local.anonKey}`,
  `SUPABASE_SERVICE_ROLE_KEY=${local.serviceRoleKey}`,
  'RECIPE_GENIE_E2E_TARGET=local',
  `RECIPE_GENIE_LOCAL_CSP_ORIGIN=${local.supabaseUrl}`,
  `RECIPE_GENIE_GIT_SHA=${sha}`,
  'NEXT_TELEMETRY_DISABLED=1',
  '',
].join('\n'), { flag: 'wx', mode: 0o600 });
