import { describe, expect, it } from "vitest"
import type { Session } from "@supabase/supabase-js"
import { shouldClearQueriesOnAuthEvent } from "@/lib/auth-context"

describe("shouldClearQueriesOnAuthEvent", () => {
  it("clears when session disappears without explicit sign out", () => {
    const prev = { access_token: "token" } as unknown as Session
    const next = null

    expect(shouldClearQueriesOnAuthEvent(prev, next, "TOKEN_REFRESHED")).toBe(true)
  })

  it("does not clear on explicit sign out", () => {
    const prev = { access_token: "token" } as unknown as Session
    const next = null

    expect(shouldClearQueriesOnAuthEvent(prev, next, "SIGNED_OUT")).toBe(false)
  })

  it("does not clear when there was no previous session", () => {
    const prev = null
    const next = null

    expect(shouldClearQueriesOnAuthEvent(prev, next, "TOKEN_REFRESHED")).toBe(false)
  })

  it("does not clear when a session is still present", () => {
    const prev = { access_token: "token" } as unknown as Session
    const next = { access_token: "token-2" } as unknown as Session

    expect(shouldClearQueriesOnAuthEvent(prev, next, "TOKEN_REFRESHED")).toBe(false)
  })
})
