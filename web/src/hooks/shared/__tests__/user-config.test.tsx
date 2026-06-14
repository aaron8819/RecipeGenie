import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import { CONFIG_KEY, useUpdateExcludedKeywords } from "@/hooks/shared/user-config"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "user-1" } })),
}))

let updateSinglePromise: Promise<{ data: UserConfig | null; error: { code?: string; message: string } | null }>

const mockSupabase = {
  from: vi.fn(() => ({
    update: () => ({
      eq: () => ({
        select: () => ({
          single: () => updateSinglePromise,
        }),
      }),
    }),
    upsert: () => ({
      select: () => ({
        single: () => updateSinglePromise,
      }),
    }),
  })),
}

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  return { wrapper: Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("useUpdateExcludedKeywords", () => {
  it("optimistically updates the authoritative user_config cache", async () => {
    const { wrapper, queryClient } = createWrapper()
    const currentConfig: UserConfig = {
      user_id: "user-1",
      categories: ["chicken"],
      default_selection: { chicken: 2 },
      excluded_keywords: [],
      history_exclusion_days: 10,
      week_start_day: 1,
      onboarding_completed_at: null,
      category_overrides: {},
      custom_categories: [],
      category_order: null,
      shopping_item_order: {},
      excluded_days: [],
      preferred_days: null,
      auto_assign_days: true,
      enabled_planner_categories: null,
    }

    queryClient.setQueryData([...CONFIG_KEY], currentConfig)

    const pending = deferred<{ data: UserConfig | null; error: { code?: string; message: string } | null }>()
    updateSinglePromise = pending.promise

    const { result } = renderHook(() => useUpdateExcludedKeywords(), { wrapper })
    result.current.mutate(["Salt"])

    await waitFor(() => {
      const config = queryClient.getQueryData<UserConfig>([...CONFIG_KEY])
      expect(config?.excluded_keywords).toEqual(["salt"])
    })

    pending.resolve({
      data: {
        ...currentConfig,
        excluded_keywords: ["salt"],
      },
      error: null,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
