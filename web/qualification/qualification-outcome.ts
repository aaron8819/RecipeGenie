export type Failure = { error: unknown };

// Preserve even non-Error/undefined throws; teardown must never replace the primary failure.
export function finishQualification(
  primary: Failure | undefined,
  teardown: Failure | undefined,
): void {
  if (primary) throw primary.error;
  if (teardown) throw teardown.error;
}
