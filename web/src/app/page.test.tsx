import { describe, expect, it, vi } from "vitest"
import HomePage from "./page"
import { buildRootDestination } from "@/lib/root-route"

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }))

vi.mock("next/navigation", () => ({ redirect }))

describe("root route", () => {
  it("redirects to the canonical Recipes destination", async () => {
    await HomePage({ searchParams: Promise.resolve({}) })
    expect(redirect).toHaveBeenCalledWith("/recipes")
  })

  it("preserves only bounded auth callback error parameters", () => {
    expect(
      buildRootDestination({
        error: "access_denied",
        error_code: "link_expired",
        error_description: "Try again",
        next: "https://example.com",
      })
    ).toBe(
      "/recipes?error=access_denied&error_code=link_expired&error_description=Try+again"
    )
  })
})
