// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'vitest';

test('emits only safe receipts despite credential-bearing raw output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'combined-receipt-'));
  const web = path.join(root, 'web');
  const artifacts = path.join(root, '.codex-artifacts', 'combined-ui');
  mkdirSync(web);
  mkdirSync(artifacts, { recursive: true });
  const fakePassword = 'synthetic-password-never-real';
  const fakeEmail = 'synthetic-owner@example.test';
  writeFileSync(path.join(root, 'combined-webserver.log'),
    `::add-mask::${fakePassword}\n::add-mask::${fakeEmail}\nFailure ${fakePassword}\n`);
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('./capture-combined-ui-log.mjs', import.meta.url)), '1'], {
      cwd: web,
      env: {
        ...process.env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
        RUNNER_TEMP: root, COMBINED_UI_EXPECTED_SHA: 'a'.repeat(40),
        GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
      },
      stdio: 'pipe',
    });
    assert.deepEqual(readdirSync(artifacts), ['webserver-exit.json']);
    const receipt = readFileSync(path.join(artifacts, 'webserver-exit.json'), 'utf8');
    for (const sensitive of [fakePassword, fakeEmail, '::add-mask::']) {
      assert.equal(receipt.includes(sensitive), false);
    }
    assert.equal(JSON.parse(receipt).playwrightExitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
