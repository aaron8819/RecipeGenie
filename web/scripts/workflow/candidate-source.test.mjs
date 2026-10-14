// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureCandidate, requireCandidate, requiresBuild } from './candidate-source.mjs';

const sha = 'a'.repeat(40), base = 'b'.repeat(40), tree = 'c'.repeat(40);
const env = { CANDIDATE_SHA: sha, CANDIDATE_BASE_SHA: base,
  GITHUB_REPOSITORY: 'aaron8819/RecipeGenie', GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2' };
const git = (args) => {
  if (args[0] === 'diff') return 'web/src/app/page.tsx\0';
  if (args[0] === 'status' || args[0] === 'merge-base') return '';
  if (args[1] === '--verify') return base;
  return args[1] === 'HEAD^{tree}' ? tree : sha;
};
const run = { id: 42, run_attempt: 2, event: 'pull_request' };

describe('candidate build selection', () => {
  it('omits only complete known prose-only changes', () => {
    expect(requiresBuild(['AGENTS.md', 'README.md', 'docs/developer-workflow.md', 'web/tests/README.md'])).toBe(false);
    for (const files of [[], null, ['docs/icon.png'], ['new.md'], ['web/src/content.md'],
      ['docs/../web/foo.md'], ['docs/a.md', 'web/package.json'], [null]]) {
      expect(requiresBuild(files)).toBe(true);
    }
  });
});

describe('integrated source identity', () => {
  it('records actual clean checkout SHA/tree/base and binds admission to the current base', () => {
    const proof = captureCandidate(env, git);
    expect(proof).toMatchObject({ sha, tree, base, runId: 42, attempt: 2, buildRequired: true });
    expect(requireCandidate(proof, { sha, tree, run, currentMain: base })).toBe(proof);
  });
  it('rejects stale heads, dirty worktrees and absent/invalid source', () => {
    for (const args of [{ ...env, CANDIDATE_SHA: 'bad' }, { ...env, CANDIDATE_BASE_SHA: '0'.repeat(40) }]) {
      expect(() => captureCandidate(args, git)).toThrow();
    }
    for (const operation of ['status', 'merge-base']) {
      expect(() => captureCandidate(env, args => {
        if (args[0] === operation) { if (operation === 'status') return ' M file'; throw Error('not an ancestor'); }
        return git(args);
      })).toThrow();
    }
    expect(() => captureCandidate(env, () => tree)).toThrow();
  });
  it('rejects missing, stale-attempt, wrong-tree and moved-base evidence', () => {
    const proof = captureCandidate(env, git);
    for (const change of [null, { ...proof, tree: base }, { ...proof, attempt: 1 },
      { ...proof, sha: base }, { ...proof, baseBranch: 'other' }, { ...proof, runId: 1 }]) {
      expect(() => requireCandidate(change, { sha, tree, run, currentMain: base })).toThrow();
    }
    expect(() => requireCandidate(proof, { sha, tree, run, currentMain: tree })).toThrow();
  });
  it('post-merge evidence requires the exact current main head and tree', () => {
    const proof = captureCandidate({ ...env, GITHUB_EVENT_NAME: 'push' }, git);
    const push = { ...run, event: 'push' };
    expect(() => requireCandidate(proof, { sha, tree, run: push, currentMain: sha })).not.toThrow();
    expect(() => requireCandidate(proof, { sha, tree: base, run: push, currentMain: sha })).toThrow();
    expect(() => requireCandidate(proof, { sha, tree, run: push, currentMain: base })).toThrow();
  });
});

it('hosted workflow replaces each unique local gate and keeps owned cleanup fail-closed', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  expect(workflow).toContain('ref: ${{ github.event.pull_request.head.sha || github.sha }}');
  expect(workflow).toContain('run: node web/scripts/workflow/candidate-source.mjs');
  for (const name of ['quality-guards', 'migration-smoke-and-drift', 'production-build', 'recovery-tooling']) {
    expect(workflow).toContain(`  ${name}:\n    needs: candidate-source`);
  }
  expect(workflow).toContain('run: npm run test:e2e:smoke:list');
  expect(workflow).toContain('run: npm run build');
  const recovery = workflow.split('  recovery-tooling:')[1];
  expect(recovery).toContain('scripts/database/tests/Run-Tests.ps1');
  expect(recovery).toContain("if: steps.scope.outputs.tooling == 'false'");
  expect(recovery).toContain("throw 'Recovery peer cleanup failed'");
  expect(recovery).not.toMatch(/rg-verify|npm run verify|npm run build|continue-on-error/);
  expect(workflow).toContain('supabase stop --no-backup');
});
