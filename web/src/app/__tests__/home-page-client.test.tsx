import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HomePageClient } from "../home-page-client"

const HOME_TAB_COOKIE = "recipe-genie-active-tab"
const HOME_TAB_RECONCILIATION_COOKIE =
  "recipe-genie-active-tab-reconciliation"
const HOME_TAB_STORAGE_KEY = "recipe-genie-active-tab"

vi.mock("next/dynamic", () => ({
  default: () => function DynamicTab() {
    return <div>Lazy tab</div>
  },
}))

vi.mock("@/components/recipes", () => ({
  RecipeList: () => <div>Recipes tab</div>,
}))

vi.mock("@/components/auth/auth-form", () => ({
  AuthForm: () => <div>Auth form</div>,
}))

vi.mock("@/components/layout", () => ({
  Header: () => <div>Header</div>,
  BottomNav: () => <div>Bottom navigation</div>,
  FirstRunOnboarding: () => null,
}))

vi.mock("@/components/layout/first-run-onboarding", () => ({
  useFirstRunOnboarding: () => ({
    showOnboarding: false,
    completeOnboarding: vi.fn(),
  }),
}))

vi.mock("@/hooks/use-recipes", () => ({
  useRecipes: () => ({ data: undefined }),
}))

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({
    user: { id: "user-1", email: "user@example.com" },
    loading: false,
    signOut: vi.fn(),
    isAuthenticated: true,
  }),
}))

function renderHome(initialTabIsAuthoritative = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <HomePageClient
        initialTab="recipes"
        initialTabIsAuthoritative={initialTabIsAuthoritative}
      />
    </QueryClientProvider>
  )
}

function setHomeCookie(tab: string) {
  document.cookie = `${HOME_TAB_COOKIE}=${tab}; Path=/`
}

function setReconciliationCookie(tab: string) {
  document.cookie = `${HOME_TAB_RECONCILIATION_COOKIE}=${tab}; Path=/`
}

function readCookie(name: string) {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split("=")[1]
}

function getPanel(tab: string) {
  return document.querySelector(`[data-home-tab-panel="${tab}"]`)
}

describe("HomePageClient tab hydration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.cookie = `${HOME_TAB_COOKIE}=; Path=/; Max-Age=0`
    document.cookie =
      `${HOME_TAB_RECONCILIATION_COOKIE}=; Path=/; Max-Age=0`
  })

  it.each(["planner", "shopping"])(
    "keeps the authoritative Recipes cookie over stale %s storage",
    async (staleTab) => {
      setHomeCookie("recipes")
      setReconciliationCookie("recipes")
      localStorage.setItem(HOME_TAB_STORAGE_KEY, staleTab)

      renderHome(true)

      await waitFor(() => {
        expect(getPanel("recipes")).toHaveAttribute("aria-hidden", "false")
        expect(getPanel(staleTab)).toHaveAttribute("aria-hidden", "true")
      })
      expect(readCookie(HOME_TAB_COOKIE)).toBe("recipes")
      expect(localStorage.getItem(HOME_TAB_STORAGE_KEY)).toBe("recipes")
    }
  )

  it("cannot write stale Planner state back over a Recipes fallback when storage writes fail", async () => {
    setHomeCookie("recipes")
    setReconciliationCookie("recipes")
    localStorage.setItem(HOME_TAB_STORAGE_KEY, "planner")
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (this: Storage) {
        if (this === localStorage) {
          throw new Error("local storage unavailable")
        }
      }
    )

    expect(() => renderHome(true)).not.toThrow()

    await waitFor(() => {
      expect(getPanel("recipes")).toHaveAttribute("aria-hidden", "false")
    })
    expect(localStorage.getItem(HOME_TAB_STORAGE_KEY)).toBe("planner")
    expect(readCookie(HOME_TAB_COOKIE)).toBe("recipes")
    expect(readCookie(HOME_TAB_RECONCILIATION_COOKIE)).toBe("recipes")
  })

  it("fails safely when local-storage reads throw", async () => {
    setHomeCookie("recipes")
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      function (this: Storage) {
        if (this === localStorage) {
          throw new Error("local storage unavailable")
        }
        return null
      }
    )

    expect(() => renderHome()).not.toThrow()

    await waitFor(() => {
      expect(getPanel("recipes")).toHaveAttribute("aria-hidden", "false")
    })
    expect(readCookie(HOME_TAB_COOKIE)).toBe("recipes")
  })

  it.each(["planner", "shopping"])(
    "restores ordinary valid persisted %s navigation",
    async (persistedTab) => {
      setHomeCookie("recipes")
      localStorage.setItem(HOME_TAB_STORAGE_KEY, persistedTab)

      renderHome()

      await waitFor(() => {
        expect(getPanel(persistedTab)).toHaveAttribute("aria-hidden", "false")
      })
      expect(readCookie(HOME_TAB_COOKIE)).toBe(persistedTab)
    }
  )
})
