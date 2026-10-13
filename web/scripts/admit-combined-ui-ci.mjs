import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'aaron8819/RecipeGenie';
const requiredJobs = ['quality-guards', 'migration-smoke-and-drift'];

export function selectExactCiRun(runs, sha, { allowPending = false } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid expected source identity');
  if (!Array.isArray(runs)) throw new Error('CI evidence is unavailable');
  const exact = runs.filter(
    (run) =>
      run.head_sha === sha &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      run.path === '.github/workflows/ci.yml' &&
      ['push', 'pull_request'].includes(run.event),
  );
  const run = exact.sort((left, right) => right.id - left.id)[0];
  const pending =
    run &&
    ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run.status) &&
    run.conclusion === null;
  if (
    !run ||
    !Number.isSafeInteger(run.id) ||
    run.id < 1 ||
    (!(run.status === 'completed' && run.conclusion === 'success') && !(allowPending && pending))
  ) {
    throw new Error('Latest exact-head normal CI must finish successfully before acceptance');
  }
  return run;
}

export function requireCiJobs(jobs, run) {
  if (!Array.isArray(jobs)) throw new Error('CI job evidence is unavailable');
  for (const name of requiredJobs) {
    const matches = jobs.filter((job) => job.name === name);
    if (
      matches.length !== 1 ||
      matches[0].run_id !== run.id ||
      matches[0].head_sha !== run.head_sha ||
      matches[0].status !== 'completed' ||
      matches[0].conclusion !== 'success'
    ) {
      throw new Error('Exact-head quality and migration CI evidence is incomplete');
    }
  }
}

export async function admitExactCi({
  sha,
  token,
  request = fetch,
  waitMs = 0,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 900_000) {
    throw new Error('CI admission wait must be bounded to fifteen minutes');
  }
  const deadline = now() + waitMs;
  const read = async (endpoint) => {
    const remaining = waitMs > 0 ? deadline - now() : 30_000;
    if (remaining <= 0) throw new Error('Exact-head CI did not complete within admission budget');
    const response = await request(`https://api.github.com/repos/${repository}/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(Math.min(30_000, remaining)),
    });
    if (!response.ok) throw new Error('Read-only CI evidence request failed');
    return response.json();
  };
  let run;
  for (;;) {
    const evidence = await read(`actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`);
    if (
      evidence.total_count !== undefined &&
      evidence.total_count > evidence.workflow_runs?.length
    ) {
      throw new Error('CI run evidence is truncated');
    }
    run = selectExactCiRun(evidence.workflow_runs, sha, { allowPending: waitMs > 0 });
    if (run.status === 'completed') break;
    if (now() >= deadline)
      throw new Error('Exact-head CI did not complete within admission budget');
    await sleep(Math.min(30_000, deadline - now()));
  }
  const result = await read(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  if (result.total_count !== result.jobs?.length) throw new Error('CI job evidence is truncated');
  requireCiJobs(result.jobs, run);
  return {
    schema: 1,
    sha,
    repository,
    ciRunId: run.id,
    ciAttempt: run.run_attempt,
    requiredJobs,
    result: 'PASS',
  };
}

async function main() {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.env.GITHUB_REPOSITORY !== repository
  )
    throw new Error('Hosted repository required');
  const sha = process.env.COMBINED_UI_EXPECTED_SHA;
  const token = process.env.GH_TOKEN;
  if (!token || !/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('CI admission inputs missing');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (actual !== sha) throw new Error('Exact dispatched source required');
  const directory = path.resolve('..', '.codex-artifacts', 'combined-ui');
  mkdirSync(directory, { recursive: true });
  let report = { schema: 1, sha, repository, result: 'FAIL' };
  try {
    report = await admitExactCi({ sha, token, waitMs: 900_000 });
    console.log(`Exact-head CI admission PASS: run ${report.ciRunId}`);
  } finally {
    writeFileSync(path.join(directory, 'ci-admission.json'), JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error(
      'CI admission failed; verify latest exact-head normal CI before accepting browser results.',
    );
    process.exitCode = 1;
  });
}
