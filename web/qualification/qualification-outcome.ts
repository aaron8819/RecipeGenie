export type Failure = { error: unknown };

// Preserve even non-Error/undefined throws; teardown must never replace the primary failure.
export function finishQualification(
  primary: Failure | undefined,
  teardown: Failure | undefined,
): void {
  if (primary) throw primary.error;
  if (teardown) throw teardown.error;
}

export function setupErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown';
  const code = error.code;
  // SQLSTATE classes used by PostgreSQL, or PostgREST's documented three-digit codes.
  return typeof code === 'string' &&
    /^(?:[0-9]{2}[0-9A-Z]{3}|(?:F0|HV|P0|XX)[0-9A-Z]{3}|PGRST[0-9]{3})(?![\s\S])/.test(code)
    ? code : 'unknown';
}

export class SetupFailure extends Error {
  readonly operation: string;
  readonly code: string;

  constructor(operation: string, original: unknown) {
    super(`Disposable fixture operation failed: ${operation}`, { cause: original });
    this.operation = operation;
    this.code = setupErrorCode(original);
  }
}

const DIAGNOSTIC_STEPS = new Set([
  'Edit menu: focus trigger',
  'Edit menu: open with keyboard',
  'Edit menu: select action',
  'return week: navigate Planner',
  'return week: select next week',
  'return week: open recipe detail',
  'return week: detail visible',
  'return week: back to Planner',
  'return week: returned URL',
  'return week: reload returned week',
  'return week: returned meals visible',
  'return week: read saved plan',
  'return week: inject failed plan read',
  'return week: reload failed read',
  'return week: read error visible',
  'return week: no Add meal on read failure',
  'return week: restore plan reads',
  'return week: retry plan read',
  'return week: recovered meals visible',
  'return week: recovered URL',
  'return week: recovered plan unchanged',
]);

type FailureDiagnostic = {
  step: string;
  errorType: 'timeout' | 'assertion' | 'error' | 'unknown';
  source: {
    file: 'web/qualification/combined-ui.spec.ts'; line: number; column: number;
  } | null;
};

// Never retain messages, raw stacks, caller paths or matcher/request/page data.
export function boundedFailureDiagnostic(error: unknown, step: string): FailureDiagnostic {
  const result: FailureDiagnostic = {
    step: DIAGNOSTIC_STEPS.has(step) ? step : 'unknown', errorType: 'unknown', source: null,
  };
  try {
    if (!error || typeof error !== 'object') return result;
    if ('name' in error && error.name === 'TimeoutError') result.errorType = 'timeout';
    else if (('name' in error && error.name === 'AssertionError') ||
      ('matcherResult' in error && error.matcherResult !== null &&
        typeof error.matcherResult === 'object')) result.errorType = 'assertion';
    else if (error instanceof Error) result.errorType = 'error';
    if (!('stack' in error) || typeof error.stack !== 'string') return result;
    // Match only a spec stack frame, not arbitrary locations embedded in messages.
    const frame = new RegExp(
      String.raw`^\s*at [^\r\n]*[\\/]qualification[\\/]combined-ui\.spec\.ts:` +
      String.raw`([1-9]\d{0,3}):([1-9]\d{0,3})\)?[ \t]*$`, 'm',
    ).exec(error.stack);
    if (frame) result.source = {
      file: 'web/qualification/combined-ui.spec.ts',
      line: Number(frame[1]), column: Number(frame[2]),
    };
  } catch { /* Hostile/nonstandard properties cannot prevent the existing failure receipt. */ }
  return result;
}
