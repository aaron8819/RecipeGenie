import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import {
  useUpdateExcludedKeywords,
  useUpdateIngredientExclusionSetting,
} from "@/hooks/shared/user-config"
import { configurationKeys } from "@/lib/query-keys"
import { DEFAULT_USER_CONFIG } from "@/lib/user-config"

const CONFIG_KEY = configurationKeys.detail("user-1")

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "user-1" } })),
}))

let updateSinglePromise: Promise<{ data: UserConfig | null; error: { code?: string; message: string } | null }>

const update = vi.fn(() => ({
  eq: () => ({
    select: () => ({
      single: () => updateSinglePromise,
    }),
  }),
}))

const mockSupabase = {
  from: vi.fn(() => ({
    update,
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
      exclude_salt_variants: false,
      exclude_black_pepper_variants: false,
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

  it("optimistically updates and rolls back an ingredient exclusion setting", async () => {
    const { wrapper, queryClient } = createWrapper()
    const currentConfig: UserConfig = {
      ...DEFAULT_USER_CONFIG,
      user_id: "user-1",
    }
    queryClient.setQueryData([...CONFIG_KEY], currentConfig)
    updateSinglePromise = Promise.resolve({
      data: null,
      error: { code: "PGRST500", message: "save failed" },
    })

    const { result } = renderHook(() => useUpdateIngredientExclusionSetting(), {
      wrapper,
    })
    result.current.mutate({ setting: "exclude_salt_variants", enabled: true })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
      expect(
        queryClient.getQueryData<UserConfig>([...CONFIG_KEY])
          ?.exclude_salt_variants
      ).toBe(false)
    })
  })

  it("saves the two settings independently through serialized writes", async () => {
    const { wrapper, queryClient } = createWrapper()
    const currentConfig: UserConfig = {
      ...DEFAULT_USER_CONFIG,
      user_id: "user-1",
    }
    queryClient.setQueryData([...CONFIG_KEY], currentConfig)
    const first = deferred<{
      data: UserConfig | null
      error: { code?: string; message: string } | null
    }>()
    const second = deferred<{
      data: UserConfig | null
      error: { code?: string; message: string } | null
    }>()
    updateSinglePromise = first.promise

    const { result } = renderHook(() => useUpdateIngredientExclusionSetting(), {
      wrapper,
    })
    result.current.mutate({ setting: "exclude_salt_variants", enabled: true })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))

    updateSinglePromise = second.promise
    result.current.mutate({
      setting: "exclude_black_pepper_variants",
      enabled: true,
    })
    expect(update).toHaveBeenCalledTimes(1)

    first.resolve({
      data: { ...currentConfig, exclude_salt_variants: true },
      error: null,
    })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    second.resolve({
      data: {
        ...currentConfig,
        exclude_salt_variants: true,
        exclude_black_pepper_variants: true,
      },
      error: null,
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
      expect(queryClient.getQueryData<UserConfig>([...CONFIG_KEY])).toMatchObject({
        exclude_salt_variants: true,
        exclude_black_pepper_variants: true,
      })
    })
    expect(update).toHaveBeenNthCalledWith(1, { exclude_salt_variants: true })
    expect(update).toHaveBeenNthCalledWith(2, {
      exclude_black_pepper_variants: true,
    })
  })
})
