import assert from 'node:assert/strict';
import { test } from 'vitest';
import { boundedFailureDiagnostic, finishQualification, SetupFailure, setupErrorCode } from './qualification-outcome.ts';

test('preserves the exact primary error despite teardown failure', () => {
  const primary = new Error('synthetic seed failure');
  assert.throws(() => finishQualification({ error: primary }, { error: new Error('cleanup') }),
    error => error === primary);
});
test('reports teardown only when no primary error exists', () => {
  const secondary = new Error('snapshot-not-acquired');
  assert.throws(() => finishQualification(undefined, { error: secondary }),
    error => error === secondary);
});
test('preserves undefined thrown values and accepts successful completion', () => {
  let caught = false;
  try { finishQualification({ error: undefined }, { error: new Error('cleanup') }); }
  catch (error) { caught = true; assert.equal(error, undefined); }
  assert.equal(caught, true);
  assert.doesNotThrow(() => finishQualification(undefined, undefined));
});

test('retains validated SQLSTATE/PostgREST codes and the original setup cause', () => {
  for (const code of ['23514', '28P01', 'P0001', 'XX000', 'PGRST116']) {
    const original = { code, message: 'synthetic-private-message' };
    const failure = new SetupFailure('seed canonical recipes', original);
    assert.equal(failure.code, code);
    assert.equal(failure.operation, 'seed canonical recipes');
    assert.equal(failure.cause, original);
  }
});
test('omits missing, malformed and credential-like error values', () => {
  for (const code of ['synthetic-password', 'TOKEN', 'PGRST116\nprivate', 'PGRST116\n', '23514 query', 23514]) {
    assert.equal(setupErrorCode({ code, details: 'synthetic-private-details' }), 'unknown');
  }
  for (const error of [null, undefined, 'synthetic-password', {}, { message: '23514' }]) {
    assert.equal(setupErrorCode(error), 'unknown');
  }
});


test('bounded failure diagnostic keeps only an allowlisted step, coarse type and source', () => {
  const secret = 'synthetic-TOKEN-cookie-password-page-body-header';
  for (const [name, expected] of [['TimeoutError', 'timeout'], ['AssertionError', 'assertion']]) {
    const error = new Error(secret);
    error.name = name;
    error.stack = `${secret}\n    at ${secret} (C:\\private-${secret}\\qualification\\combined-ui.spec.ts:590:17)`;
    error.request = { authorization: secret };
    const result = boundedFailureDiagnostic(error, 'return week: open recipe detail');
    assert.deepEqual(result, {
      step: 'return week: open recipe detail', errorType: expected,
      source: { file: 'web/qualification/combined-ui.spec.ts', line: 590, column: 17 },
    });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(boundedFailureDiagnostic({ matcherResult: { message: secret } },
    'Edit menu: select action').errorType, 'assertion');
});

test('sensitive or malformed diagnostic inputs cannot escape retained fields', () => {
  const secret = 'synthetic-TOKEN-cookie-password-page-body-header';
  const candidates = [
    null, undefined, secret,
    { name: secret, message: secret, stack: secret, headers: secret },
    { name: `${secret}TimeoutError`, stack: `combined-ui.spec.ts:590:17 ${secret}` },
    { stack: `    at private (/qualification/other.spec.ts:590:17)` },
    { stack: `    at private (/qualification/combined-ui.spec.ts:590:17?token=${secret})` },
    { stack: `    at private (/qualification/combined-ui.spec.ts:123456:17)` },
    { get name() { throw new Error(secret); } },
  ];
  for (const error of candidates) {
    const result = boundedFailureDiagnostic(error, secret);
    assert.deepEqual(result, { step: 'unknown', errorType: 'unknown', source: null });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
