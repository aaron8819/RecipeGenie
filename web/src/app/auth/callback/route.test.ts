import { beforeEach, describe, expect, it, vi } from "vitest"
import { GET } from "./route"

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}))

describe("auth callback return destination", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null })
  })

  it.each([
    "/", "/dashboard", "/dashboard?view=week", "/shopping", "/recipes",
    "/planner", "/pantry", "/recipes/recipe-id?from=planner",
    "/planner?week=2026-10-04", "/shopping?view=trip", "/pantry?search=rice",
  ])(
    "preserves %s after successful authentication", async (next) => {
      const url = new URL("http://localhost/auth/callback")
      url.searchParams.set("code", "test-code")
      url.searchParams.set("next", next)
      const response = await GET(new Request(url))
      expect(exchangeCodeForSession).toHaveBeenCalledWith("test-code")
      expect(response.headers.get("location")).toBe(`http://localhost${next}`)
    }
  )

  it.each([
    "//evil.example", "https://evil.example", "http://evil.example",
    "javascript:alert(1)", "/\\evil.example", "/%2f%2fevil.example",
    "/dashboard-evil", "/dashboard\\evil.example",
  ])(
    "rejects unsafe or unrecognized destination %s", async (next) => {
      const url = new URL("http://localhost/auth/callback?code=test-code")
      url.searchParams.set("next", next)
      const response = await GET(new Request(url))
      expect(response.headers.get("location")).toBe("http://localhost/")
    }
  )
})
