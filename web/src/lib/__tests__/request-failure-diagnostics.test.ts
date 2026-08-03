import { describe, expect, it } from "vitest"
import {
  EXPECTED_INSPECTION_RECIPE_PATH,
  formatRequestFailure,
  isExpectedInspectionNavigationAbort,
  type RequestFailureSnapshot,
} from "../../../tests/request-failure-diagnostics"

const expectedFailure: RequestFailureSnapshot = {
  failureText: "net::ERR_ABORTED",
  isNavigationRequest: true,
  method: "GET",
  resourceType: "document",
  url: `http://127.0.0.1:3107${EXPECTED_INSPECTION_RECIPE_PATH}`,
}

describe("inspection request-failure classification", () => {
  it("ignores only the expected canonical recipe document cancellation", () => {
    expect(isExpectedInspectionNavigationAbort(expectedFailure)).toBe(true)
  })

  it("ignores cancelled App Router payloads for primary route transitions", () => {
    expect(
      isExpectedInspectionNavigationAbort({
        ...expectedFailure,
        isNavigationRequest: false,
        resourceType: "fetch",
        url: "http://127.0.0.1:3107/planner?_rsc=route-payload",
      })
    ).toBe(true)
  })

  it("does not ignore a primary-route fetch without an App Router payload", () => {
    expect(
      isExpectedInspectionNavigationAbort({
        ...expectedFailure,
        isNavigationRequest: false,
        resourceType: "fetch",
        url: "http://127.0.0.1:3107/planner",
      })
    ).toBe(false)
  })

  it.each(["fetch", "xhr"])(
    "does not ignore an aborted %s request",
    (resourceType) => {
      expect(
        isExpectedInspectionNavigationAbort({
          ...expectedFailure,
          isNavigationRequest: false,
          resourceType,
          url: "http://127.0.0.1:54321/rest/v1/weekly_plans",
        })
      ).toBe(false)
    }
  )

  it("does not ignore a non-navigation document request", () => {
    expect(
      isExpectedInspectionNavigationAbort({
        ...expectedFailure,
        isNavigationRequest: false,
      })
    ).toBe(false)
  })

  it("does not ignore a document cancellation for an unrelated path", () => {
    expect(
      isExpectedInspectionNavigationAbort({
        ...expectedFailure,
        url: "http://127.0.0.1:3107/recipes/unrelated",
      })
    ).toBe(false)
  })

  it("does not ignore a non-abort request failure", () => {
    expect(
      isExpectedInspectionNavigationAbort({
        ...expectedFailure,
        failureText: "net::ERR_CONNECTION_REFUSED",
      })
    ).toBe(false)
  })

  it("retains method, resource type, path, URL, and failure text", () => {
    expect(formatRequestFailure(expectedFailure)).toBe(
      `GET document ${EXPECTED_INSPECTION_RECIPE_PATH} ` +
      `http://127.0.0.1:3107${EXPECTED_INSPECTION_RECIPE_PATH} ` +
      "net::ERR_ABORTED"
    )
  })
})
