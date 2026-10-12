// @vitest-environment node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { admitExactCi, requireCiJobs, selectExactCiRun } from './admit-combined-ui-ci.mjs';

const sha = 'a'.repeat(40);
const run = {
  id: 42, run_attempt: 2, head_sha: sha, path: '.github/workflows/ci.yml',
  repository: { full_name: 'aaron8819/RecipeGenie' },
  head_repository: { full_name: 'aaron8819/RecipeGenie' },
  event: 'pull_request', status: 'completed', conclusion: 'success',
};
const jobs = ['quality-guards', 'migration-smoke-and-drift'].map(name => ({
  name, run_id: 42, head_sha: sha, status: 'completed', conclusion: 'success',
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

test('reads only fixed repository CI endpoints and returns bounded evidence', async () => {
  const urls = [];
  const request = async (url, options) => {
    urls.push(url);
    assert.equal(options.method, undefined); // GET only.
    return { ok: true, json: async () => urls.length === 1
      ? { workflow_runs: [run] } : { total_count: 2, jobs } };
  };
  const result = await admitExactCi({ sha, token: 'fixture-only', request });
  assert.deepEqual(urls, [
    'https://api.github.com/repos/aaron8819/RecipeGenie/actions/workflows/' +
      `ci.yml/runs?head_sha=${sha}&per_page=100`,
    'https://api.github.com/repos/aaron8819/RecipeGenie/actions/' +
      'runs/42/jobs?filter=latest&per_page=100',
  ]);
  assert.equal(result.ciRunId, 42);
  assert.equal(result.sha, sha);
  assert.equal(result.result, 'PASS');
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('fails closed on unavailable or truncated remote evidence', async () => {
  await assert.rejects(() => admitExactCi({ sha, token: 'fixture-only',
    request: async () => ({ ok: false }) }));
  let reads = 0;
  await assert.rejects(() => admitExactCi({ sha, token: 'fixture-only',
    request: async () => ({ ok: true, json: async () => ++reads === 1
      ? { workflow_runs: [run] } : { total_count: 3, jobs } }) }));
});

test('browser admission is independent of optional Windows qualification', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/combined-ui.yml',
    import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const admission = workflow.split('  ci-admission:')[1].split('  trusted-pr-gate:')[0];
  const windows = workflow.split('  trusted-pr-gate:')[1].split('  combined-ui:')[0];
  const browser = workflow.split('  combined-ui:')[1];
  assert.match(admission, /actions: read/);
  assert.match(admission, /run: node scripts\/admit-combined-ui-ci\.mjs/);
  assert.match(windows, /if: \$\{\{ inputs\.windows_gate \}\}/);
  assert.match(workflow, /windows_gate:[\s\S]*?type: boolean\n        default: false/);
  assert.match(browser, /needs: ci-admission/);
  assert.doesNotMatch(browser, /needs: trusted-pr-gate|GH_TOKEN/);
  assert.match(browser, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(browser, /run: node scripts\/prepare-combined-ui\.mjs/);
  assert.match(browser, /run: npm run build/);
  assert.match(browser, /supabase stop --no-backup/);
});
