import { describe, expect, it } from "vitest"
import type { Session } from "@supabase/supabase-js"
import { hasPrincipalChanged } from "@/lib/auth-context"

describe("hasPrincipalChanged", () => {
  const session = (userId: string, token: string) => ({
    access_token: token,
    user: { id: userId },
  }) as unknown as Session

  it("clears when session disappears without explicit sign out", () => {
    const prev = session("user-a", "token")
    const next = null

    expect(hasPrincipalChanged(prev, next)).toBe(true)
  })

  it("clears on explicit sign out", () => {
    expect(hasPrincipalChanged(session("user-a", "token"), null)).toBe(true)
  })

  it("does not clear when there was no previous session", () => {
    const prev = null
    const next = null

    expect(hasPrincipalChanged(prev, next)).toBe(false)
  })

  it("does not clear when a session is still present", () => {
    const prev = session("user-a", "token")
    const next = session("user-a", "token-2")

    expect(hasPrincipalChanged(prev, next)).toBe(false)
  })

  it("clears on a direct account switch", () => {
    expect(hasPrincipalChanged(
      session("user-a", "token-a"),
      session("user-b", "token-b")
    )).toBe(true)
  })
})
