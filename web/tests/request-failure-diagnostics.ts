export interface RequestFailureSnapshot {
  failureText: string
  isNavigationRequest: boolean
  method: string
  resourceType: string
  url: string
}

export const EXPECTED_INSPECTION_RECIPE_PATH =
  "/recipes/10000000-0000-4000-8000-000000000006"

const PRIMARY_ROUTE_PATHS = new Set([
  "/recipes",
  "/planner",
  "/shopping",
  "/pantry",
])

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
  if (failure.failureText !== "net::ERR_ABORTED" || failure.method !== "GET") {
    return false
  }

  const url = new URL(failure.url)
  const isDetailDocumentNavigation =
    failure.isNavigationRequest &&
    failure.resourceType === "document" &&
    url.pathname === EXPECTED_INSPECTION_RECIPE_PATH

  const isPrimaryRouteRscNavigation =
    !failure.isNavigationRequest &&
    failure.resourceType === "fetch" &&
    url.searchParams.has("_rsc") &&
    PRIMARY_ROUTE_PATHS.has(url.pathname)

  return (
    isDetailDocumentNavigation || isPrimaryRouteRscNavigation
  )
}
