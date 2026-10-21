import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const repository = 'aaron8819/RecipeGenie';
const shaPattern = /^(?!0{40}$)[a-f0-9]{40}$/;
const gitRead = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Only known prose inputs may omit the candidate build. Empty, malformed and
// unknown diffs are deliberately conservative; docs assets are not prose.
export function requiresBuild(files) {
  return !Array.isArray(files) || files.length === 0 || files.some((file) =>
    typeof file !== 'string' || !/^(?:(?:AGENTS|README|CLAUDE|decisions|changelog)\.md|docs\/(?:[\w-]+\/)*[\w-]+\.md|web\/tests\/[A-Z_]+\.md)$/.test(file));
}

export function captureCandidate(env, git = gitRead) {
  const sha = env.CANDIDATE_SHA;
  const base = env.CANDIDATE_BASE_SHA;
  if (env.GITHUB_REPOSITORY !== repository ||
      !['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME) ||
      ![sha, base].every((value) => shaPattern.test(value ?? '')) ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('Complete candidate source inputs required');
  }
  if (git(['rev-parse', 'HEAD']) !== sha ||
      git(['rev-parse', '--verify', `${base}^{commit}`]) !== base ||
      git(['status', '--porcelain'])) throw new Error('Clean exact candidate checkout required');
  // An up-to-date head contains its base, so testing it covers the integrated
  // candidate tree. A stale head must integrate main and requalify first.
  git(['merge-base', '--is-ancestor', base, sha]);
  const tree = git(['rev-parse', 'HEAD^{tree}']);
  if (!shaPattern.test(tree)) throw new Error('Candidate tree required');
  const diff = git(['diff', '--no-renames', '--name-only', '-z', base, sha, '--']);
  const files = diff.endsWith('\0') ? diff.slice(0, -1).split('\0') : [];
  return { schema: 1, repository, sha, tree, base, baseBranch: 'main',
    event: env.GITHUB_EVENT_NAME, runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT), buildRequired: requiresBuild(files) };
}

export function requireCandidate(proof, { sha, tree, run, currentMain }) {
  if (!proof || proof.schema !== 1 || proof.repository !== repository ||
      proof.sha !== sha || proof.tree !== tree ||
      ![proof.sha, proof.tree, proof.base].every((value) => shaPattern.test(value ?? '')) ||
      proof.baseBranch !== 'main' || proof.runId !== run.id ||
      proof.attempt !== run.run_attempt || proof.event !== run.event ||
      typeof proof.buildRequired !== 'boolean' ||
      (run.event === 'pull_request' ? currentMain !== proof.base : currentMain !== proof.sha)) {
    throw new Error('Missing, stale or mismatched candidate provenance; integrate current main and refresh CI');
  }
  return proof;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const proof = captureCandidate(process.env);
  const directory = path.resolve('.codex-artifacts', 'ci');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'candidate-source.json'), JSON.stringify(proof, null, 2));
  if (!process.env.GITHUB_OUTPUT) throw new Error('Workflow output destination required');
  appendFileSync(process.env.GITHUB_OUTPUT,
    `sha=${proof.sha}\ntree=${proof.tree}\nbase=${proof.base}\nbuild=${proof.buildRequired}\n`);
  console.log(JSON.stringify(proof));
}
