import assert from 'node:assert/strict';
import { test } from 'vitest';
import { finishQualification, SetupFailure, setupErrorCode } from './qualification-outcome.ts';

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
