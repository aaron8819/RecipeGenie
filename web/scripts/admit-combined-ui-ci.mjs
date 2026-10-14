import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { requireCandidate } from './workflow/candidate-source.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'aaron8819/RecipeGenie';
export const requiredJobs = ['candidate-source', 'quality-guards', 'migration-smoke-and-drift', 'production-build', 'recovery-tooling'];

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
      throw new Error('Exact-head source, quality, migration, build and recovery CI evidence is incomplete');
    }
  }
}

export async function admitExactCi({
  sha,
  token,
  tree,
  readArtifact = readCandidateArtifact,
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
  const artifacts = await read(`actions/runs/${run.id}/artifacts?per_page=100`);
  if (artifacts.total_count !== artifacts.artifacts?.length) throw new Error('CI artifacts truncated');
  const matches = artifacts.artifacts.filter(artifact =>
    artifact.name === `candidate-source-${run.id}-${run.run_attempt}` && !artifact.expired);
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id))
    throw new Error('Exact-attempt candidate provenance artifact required');
  const proof = await readArtifact(matches[0].id, { token, request });
  const currentMain = await read('git/ref/heads/main');
  requireCandidate(proof, { sha, tree, run, currentMain: currentMain.object?.sha });
  return {
    schema: 1,
    sha,
    repository,
    ciRunId: run.id,
    ciAttempt: run.run_attempt,
    requiredJobs,
    candidate: proof,
    result: 'PASS',
  };
}

// Read one bounded, run-owned artifact, never execute or extract its paths.
export async function readCandidateArtifact(id, { token, request = fetch }) {
  const response = await request(`https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Candidate artifact unavailable');
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > 65_536) throw new Error('Candidate artifact exceeds bounds');
  const directory = mkdtempSync(path.join(tmpdir(), 'rg-candidate-'));
  try {
    const file = path.join(directory, 'candidate.zip');
    writeFileSync(file, archive);
    const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8', maxBuffer: 8192 }).trim();
    if (entries !== 'candidate-source.json') throw new Error('Unexpected candidate artifact contents');
    const contents = execFileSync('unzip', ['-p', file, 'candidate-source.json'], {
      encoding: 'utf8', maxBuffer: 8192,
    });
    return JSON.parse(contents);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    report = await admitExactCi({ sha, tree, token, waitMs: 900_000 });
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
