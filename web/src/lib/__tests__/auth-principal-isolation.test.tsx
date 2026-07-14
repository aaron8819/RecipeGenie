import React, { useEffect, useState } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import type { AuthChangeEvent, Session } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider, useAuthContext } from "@/lib/auth-context"
import { recipeKeys } from "@/lib/query-keys"

const authHarness = vi.hoisted(() => ({
  listener: null as ((event: AuthChangeEvent, session: Session | null) => void) | null,
  getSession: vi.fn(),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    auth: {
      getSession: authHarness.getSession,
      onAuthStateChange: (listener: typeof authHarness.listener) => {
        authHarness.listener = listener
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resend: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}))

const session = (userId: string, token = `token-${userId}`) => ({
  access_token: token,
  refresh_token: `refresh-${userId}`,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: userId },
}) as unknown as Session

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function wrapper(queryClient: QueryClient, initialSession: Session, child: React.ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialSession={initialSession}>{child}</AuthProvider>
    </QueryClientProvider>
  )
}

function PrivateRecipe({ load }: { load: (userId: string) => Promise<string[]> }) {
  const { user } = useAuthContext()
  const userId = user!.id
  const { data } = useQuery({
    queryKey: recipeKeys.all(userId),
    queryFn: () => load(userId),
    enabled: !!user,
  })
  return <div>{data?.join(",") ?? "Loading private recipes"}</div>
}

beforeEach(() => {
  authHarness.listener = null
  authHarness.getSession.mockReset()
  authHarness.getSession.mockResolvedValue({ data: { session: null } })
})

describe("AuthProvider principal transitions", () => {
  it("removes User A on logout while retaining public cache", async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(recipeKeys.all("user-a"), ["A secret"])
    queryClient.setQueryData(["public", "units"], ["cup"])
    function PrivateShell() {
      const { user } = useAuthContext()
      return user ? <div>Private shell</div> : <div>Signed out</div>
    }
    wrapper(queryClient, session("user-a"), <PrivateShell />)

    act(() => authHarness.listener?.("SIGNED_OUT", null))

    await waitFor(() => expect(queryClient.getQueryData(recipeKeys.all("user-a"))).toBeUndefined())
    expect(queryClient.getQueryData(["public", "units"])).toEqual(["cup"])
    expect(screen.queryByText("Private shell")).not.toBeInTheDocument()
  })

  it("does not render cached private data while authentication is unresolved", () => {
    authHarness.getSession.mockReturnValue(new Promise(() => undefined))
    const queryClient = new QueryClient()
    queryClient.setQueryData(recipeKeys.all("user-a"), ["A secret"])
    function AuthState() {
      const { loading, user } = useAuthContext()
      if (loading) return <div>Resolving authentication</div>
      return <div>{user ? "Private content" : "Signed out"}</div>
    }
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><AuthState /></AuthProvider>
      </QueryClientProvider>
    )

    expect(screen.getByText("Resolving authentication")).toBeInTheDocument()
    expect(screen.queryByText("A secret")).not.toBeInTheDocument()
    expect(screen.queryByText("Signed out")).not.toBeInTheDocument()
  })

  it("never renders User A while a direct User B fetch is delayed", async () => {
    const queryClient = new QueryClient()
    const userB = deferred<string[]>()
    queryClient.setQueryData(recipeKeys.all("user-a"), ["A secret"])
    const load = vi.fn((userId: string) => userId === "user-b" ? userB.promise : Promise.resolve(["A secret"]))
    wrapper(queryClient, session("user-a"), <PrivateRecipe load={load} />)
    expect(screen.getByText("A secret")).toBeInTheDocument()

    act(() => authHarness.listener?.("SIGNED_IN", session("user-b")))
    expect(screen.queryByText("A secret")).not.toBeInTheDocument()
    expect(screen.getByText("Loading private recipes")).toBeInTheDocument()

    await act(async () => userB.resolve(["B recipe"]))
    expect(await screen.findByText("B recipe")).toBeInTheDocument()
    expect(screen.queryByText("A secret")).not.toBeInTheDocument()
  })

  it("contains late User A query, success, rollback, and settled callbacks after switching to User B", async () => {
    const queryClient = new QueryClient()
    const userA = deferred<string[]>()
    wrapper(queryClient, session("user-a"), (
      <PrivateRecipe load={(userId) => userId === "user-a" ? userA.promise : Promise.resolve(["B recipe"])} />
    ))

    act(() => authHarness.listener?.("SIGNED_IN", session("user-b")))
    expect(await screen.findByText("B recipe")).toBeInTheDocument()

    await act(async () => userA.resolve(["late A response"]))
    act(() => {
      // Success reconciliation, error rollback, and settled invalidation all retain
      // the owner key captured when User A started the mutation.
      queryClient.setQueryData(recipeKeys.all("user-a"), ["late A success"])
      queryClient.setQueryData(recipeKeys.all("user-a"), ["late A rollback"])
      void queryClient.invalidateQueries({ queryKey: recipeKeys.all("user-a") })
    })

    expect(queryClient.getQueryData(recipeKeys.all("user-a"))).toBeUndefined()
    expect(queryClient.getQueryData(recipeKeys.all("user-b"))).toEqual(["B recipe"])
    expect(screen.queryByText(/late A/)).not.toBeInTheDocument()
  })

  it("does not remount or purge on a same-user token refresh", () => {
    const queryClient = new QueryClient()
    const mountSpy = vi.fn()
    queryClient.setQueryData(recipeKeys.all("user-a"), ["A recipe"])
    function MountedState() {
      useEffect(() => { mountSpy() }, [])
      return <div>Stable UI state</div>
    }
    wrapper(queryClient, session("user-a", "old-token"), <MountedState />)

    act(() => authHarness.listener?.("TOKEN_REFRESHED", session("user-a", "new-token")))

    expect(mountSpy).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(recipeKeys.all("user-a"))).toEqual(["A recipe"])
    expect(screen.getByText("Stable UI state")).toBeInTheDocument()
  })

  it("clears principal-bound overlays and timers on a cross-tab account switch", () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const timerCallback = vi.fn()
    function Overlay() {
      const [visible, setVisible] = useState(false)
      useEffect(() => {
        if (!visible) return
        const timer = setTimeout(timerCallback, 5000)
        return () => clearTimeout(timer)
      }, [visible])
      return <button onClick={() => setVisible(true)}>{visible ? "Pending assignment" : "No overlay"}</button>
    }
    wrapper(queryClient, session("user-a"), <Overlay />)
    act(() => screen.getByRole("button").click())
    expect(screen.getByText("Pending assignment")).toBeInTheDocument()

    act(() => authHarness.listener?.("SIGNED_IN", session("user-b")))
    expect(screen.queryByText("Pending assignment")).not.toBeInTheDocument()
    expect(screen.getByText("No overlay")).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(5000))
    expect(timerCallback).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
