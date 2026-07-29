export interface RequestFailureSnapshot {
  failureText: string
  isNavigationRequest: boolean
  method: string
  resourceType: string
  url: string
}

export const EXPECTED_INSPECTION_RECIPE_PATH =
  "/recipes/10000000-0000-4000-8000-000000000006"

export function formatRequestFailure(
  failure: RequestFailureSnapshot
): string {
  const path = new URL(failure.url).pathname
  return [
    failure.method,
    failure.resourceType,
    path,
    failure.url,
    failure.failureText,
  ].join(" ")
}

export function isExpectedInspectionNavigationAbort(
  failure: RequestFailureSnapshot
): boolean {
  return (
    failure.failureText === "net::ERR_ABORTED" &&
    failure.isNavigationRequest &&
    failure.method === "GET" &&
    failure.resourceType === "document" &&
    new URL(failure.url).pathname === EXPECTED_INSPECTION_RECIPE_PATH
  )
}
