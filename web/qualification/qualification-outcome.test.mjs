import assert from 'node:assert/strict';
import { test } from 'vitest';
import { finishQualification } from './qualification-outcome.ts';

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
