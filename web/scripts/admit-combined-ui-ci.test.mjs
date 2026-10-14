// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { admitExactCi, requiredJobs, requireCiJobs, selectExactCiRun } from './admit-combined-ui-ci.mjs';

const sha = 'a'.repeat(40);
const run = {
  id: 42,
  run_attempt: 2,
  head_sha: sha,
  path: '.github/workflows/ci.yml',
  repository: { full_name: 'aaron8819/RecipeGenie' },
  head_repository: { full_name: 'aaron8819/RecipeGenie' },
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
};
const jobs = requiredJobs.map((name) => ({
  name,
  run_id: 42,
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
}));

test('admits exact source CI and both successful required jobs', () => {
  assert.equal(selectExactCiRun([run], sha), run);
  assert.doesNotThrow(() => requireCiJobs(jobs, run));
});

test.each([
  ['wrong SHA', { head_sha: 'b'.repeat(40) }],
  ['foreign repository', { repository: { full_name: 'other/repo' } }],
  ['fork source', { head_repository: { full_name: 'other/repo' } }],
  ['other workflow', { path: '.github/workflows/other.yml' }],
  ['unexpected event', { event: 'workflow_dispatch' }],
  ['pending', { status: 'in_progress', conclusion: null }],
  ['failed', { conclusion: 'failure' }],
])('rejects %s CI evidence', (_name, change) => {
  assert.throws(() => selectExactCiRun([{ ...run, ...change }], sha));
});

test('rejects latest failed run instead of reusing an older pass', () => {
  assert.throws(() => selectExactCiRun([run, { ...run, id: 43, conclusion: 'failure' }], sha));
});

test.each([
  ['missing migration', jobs.slice(0, 1)],
  ['skipped migration', [jobs[0], { ...jobs[1], conclusion: 'skipped' }]],
  ['wrong source', [jobs[0], { ...jobs[1], head_sha: 'b'.repeat(40) }]],
  ['wrong run', [jobs[0], { ...jobs[1], run_id: 41 }]],
  ['duplicate job', [...jobs, jobs[1]]],
])('rejects %s required-job evidence', (_name, evidence) => {
  assert.throws(() => requireCiJobs(evidence, run));
});

const tree = 'b'.repeat(40);
const base = 'c'.repeat(40);
const proof = { schema: 1, sha, tree, base, baseBranch: 'main',
  repository: 'aaron8819/RecipeGenie', runId: 42, attempt: 2,
  event: 'pull_request', buildRequired: true };
const artifact = { id: 99, name: 'candidate-source-42-2', expired: false };
const payload = (url) => url.includes('/jobs?') ? { total_count: jobs.length, jobs }
  : url.includes('/artifacts?') ? { total_count: 1, artifacts: [artifact] }
    : url.includes('git/ref/') ? { object: { sha: base } } : { workflow_runs: [run] };

test('requires source provenance plus all successful jobs using read-only endpoints', async () => {
  const urls = [];
  const request = async (url, options) => {
    urls.push(url);
    assert.equal(options.method, undefined);
    return { ok: true, json: async () => payload(url) };
  };
  const result = await admitExactCi({ sha, tree, token: 'fixture-only', request,
    readArtifact: async (id) => { assert.equal(id, 99); return proof; } });
  assert.equal(urls.length, 4);
  assert.ok(urls.every(url => url.startsWith('https://api.github.com/repos/aaron8819/RecipeGenie/')));
  assert.equal(result.ciRunId, 42);
  assert.equal(result.sha, sha);
  assert.equal(result.result, 'PASS');
  assert.equal(result.candidate.tree, tree);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test.each([
  ['missing artifact', { total_count: 0, artifacts: [] }],
  ['stale attempt', { total_count: 1, artifacts: [{ ...artifact, name: 'candidate-source-42-1' }] }],
  ['expired artifact', { total_count: 1, artifacts: [{ ...artifact, expired: true }] }],
  ['truncated artifacts', { total_count: 2, artifacts: [artifact] }],
])('rejects %s source evidence', async (_name, artifacts) => {
  await assert.rejects(() => admitExactCi({ sha, tree, token: 'fixture-only',
    request: async url => ({ ok: true, json: async () => url.includes('/artifacts?') ? artifacts : payload(url) }),
    readArtifact: async () => proof }));
});

test.each(['recovery-tooling', 'production-build', 'candidate-source'])('requires successful %s', name => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
    assert.throws(() => requireCiJobs(jobs.map(job => job.name === name ? { ...job, conclusion } : job), run));
  }
});

test('fails closed on unavailable or truncated remote evidence', async () => {
  await assert.rejects(() =>
    admitExactCi({ sha, token: 'fixture-only', request: async () => ({ ok: false }) }),
  );
  let reads = 0;
  await assert.rejects(() =>
    admitExactCi({
      sha,
      token: 'fixture-only',
      request: async () => ({
        ok: true,
        json: async () => (++reads === 1 ? { workflow_runs: [run] } : { total_count: jobs.length + 1, jobs }),
      }),
    }),
  );
});

test('browser admission is independent of optional Windows qualification', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/combined-ui.yml', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const admission = workflow.split('  ci-admission:')[1].split('  trusted-pr-gate:')[0];
  const windows = workflow.split('  trusted-pr-gate:')[1].split('  combined-ui:')[0];
  const browser = workflow.split('  combined-ui:')[1];
  assert.match(admission, /actions: read/);
  assert.match(admission, /run: node scripts\/admit-combined-ui-ci\.mjs/);
  assert.match(windows, /if: \$\{\{ inputs\.windows_gate \}\}/);
  assert.match(workflow, /windows_gate:[\s\S]*?type: boolean\n        default: false/);
  assert.match(admission, /needs: combined-ui/);
  assert.doesNotMatch(browser, /needs: ci-admission/);
  assert.doesNotMatch(browser, /needs: trusted-pr-gate|GH_TOKEN/);
  assert.match(browser, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(browser, /run: node scripts\/prepare-combined-ui\.mjs/);
  assert.match(browser, /run: npm run build/);
  assert.match(browser, /supabase stop --no-backup/);
});

test('waits for pending exact-head CI without accepting it prematurely', async () => {
  let elapsed = 0,
    reads = 0;
  const request = async (url) => ({
    ok: true,
    json: async () =>
      url.includes('/jobs?')
        ? payload(url)
        : url.includes('/artifacts?') || url.includes('git/ref/') ? payload(url) : {
            workflow_runs: [
              ++reads === 1 ? { ...run, status: 'in_progress', conclusion: null } : run,
            ],
          },
  });
  const result = await admitExactCi({
    sha, tree,
    token: 'fixture-only',
    request,
    readArtifact: async () => proof,
    waitMs: 60_000,
    now: () => elapsed,
    sleep: async (ms) => {
      elapsed += ms;
    },
  });
  assert.equal(elapsed, 30_000);
  assert.equal(result.result, 'PASS');
});

test('bounded pending wait times out, and never accepts skipped or failed jobs', async () => {
  let elapsed = 0;
  const pending = { ...run, status: 'in_progress', conclusion: null };
  await assert.rejects(
    () =>
      admitExactCi({
        sha,
        token: 'fixture-only',
        waitMs: 30_000,
        now: () => elapsed,
        sleep: async (ms) => {
          elapsed += ms;
        },
        request: async () => ({ ok: true, json: async () => ({ workflow_runs: [pending] }) }),
      }),
    /admission budget/,
  );
  assert.equal(elapsed, 30_000);
  for (const conclusion of ['failure', 'skipped', 'cancelled']) {
    assert.throws(() => selectExactCiRun([{ ...run, conclusion }], sha, { allowPending: true }));
  }
});

test('a newer failed run ends a pending wait instead of using an old pass', async () => {
  let reads = 0;
  await assert.rejects(() =>
    admitExactCi({
      sha,
      token: 'fixture-only',
      waitMs: 60_000,
      now: () => 0,
      sleep: async () => {},
      request: async () => ({
        ok: true,
        json: async () => ({
          workflow_runs:
            ++reads === 1
              ? [{ ...run, id: 43, status: 'in_progress', conclusion: null }, run]
              : [{ ...run, id: 43, conclusion: 'failure' }, run],
        }),
      }),
    }),
  );
});

test('rejects invalid wait budgets and truncated run evidence', async () => {
  for (const waitMs of [-1, 900_001, NaN]) {
    await assert.rejects(() => admitExactCi({ sha, token: 'fixture-only', waitMs }));
  }
  await assert.rejects(() =>
    admitExactCi({
      sha,
      token: 'fixture-only',
      request: async () => ({
        ok: true,
        json: async () => ({ total_count: 101, workflow_runs: [run] }),
      }),
    }),
  );
});
