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
