import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthenticatedShell } from "../authenticated-shell"

globalThis.React = React

const signOut = vi.fn()
const exchangeCodeForSession = vi.fn()
let authState = {
  user: null as { email?: string } | null,
  loading: false,
  isAuthenticated: false,
}

vi.mock("next/navigation", () => ({
  usePathname: () => "/recipes",
}))

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ ...authState, signOut }),
}))

vi.mock("@/components/layout/first-run-onboarding", () => ({
  useFirstRunOnboarding: () => ({
    showOnboarding: true,
    completeOnboarding: vi.fn(),
  }),
}))

vi.mock("@/components/layout", () => ({
  Header: ({ onSignOut }: { onSignOut: () => void }) => (
    <button onClick={onSignOut}>Shell sign out</button>
  ),
  DesktopSidebar: () => <aside>Desktop shell navigation</aside>,
  BottomNav: () => <nav>Shell navigation</nav>,
  FirstRunOnboarding: ({ open }: { open: boolean }) =>
    open ? <div>First-run onboarding</div> : null,
}))

vi.mock("@/components/auth/auth-form", () => ({
  AuthForm: ({ initialError }: { initialError?: string | null }) => (
    <div>Sign in form {initialError}</div>
  ),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      exchangeCodeForSession,
    },
  }),
}))

describe("AuthenticatedShell", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState = {
      user: null,
      loading: false,
      isAuthenticated: false,
    }
    exchangeCodeForSession.mockResolvedValue({ error: null })
    window.history.replaceState({}, "", "/recipes")
  })

  it("keeps route content unmounted while auth is loading", () => {
    authState.loading = true

    render(
      <AuthenticatedShell>
        <div>Private route</div>
      </AuthenticatedShell>
    )

    expect(screen.queryByText("Private route")).not.toBeInTheDocument()
    expect(screen.queryByText("Sign in form")).not.toBeInTheDocument()
  })

  it("renders sanitized callback errors for unauthenticated users", async () => {
    window.history.replaceState(
      {},
      "",
      "/recipes?error=access_denied&error_code=link_expired"
    )

    render(
      <AuthenticatedShell>
        <div>Private route</div>
      </AuthenticatedShell>
    )

    await waitFor(() => {
      expect(screen.getByText(/confirmation link has expired/i)).toBeInTheDocument()
    })
    expect(window.location.pathname).toBe("/recipes")
    expect(window.location.search).toBe("")
  })

  it("exchanges and removes a confirmation code forwarded from the root route", async () => {
    window.history.replaceState({}, "", "/recipes?code=confirmation-code")

    render(
      <AuthenticatedShell>
        <div>Private route</div>
      </AuthenticatedShell>
    )

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("confirmation-code")
    })
    await waitFor(() => {
      expect(window.location.search).toBe("")
    })
  })

  it("renders the shared shell, route, onboarding, and sign-out behavior", () => {
    authState = {
      user: { email: "cook@example.com" },
      loading: false,
      isAuthenticated: true,
    }

    render(
      <AuthenticatedShell>
        <div>Private route</div>
      </AuthenticatedShell>
    )

    expect(screen.getByText("Private route")).toBeInTheDocument()
    expect(screen.getByText("Desktop shell navigation")).toBeInTheDocument()
    expect(screen.getByText("Shell navigation")).toBeInTheDocument()
    expect(screen.getByText("First-run onboarding")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Shell sign out" }))
    expect(signOut).toHaveBeenCalledOnce()
  })
})
