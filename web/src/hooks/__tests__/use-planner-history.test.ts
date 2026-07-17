import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { WeeklyPlan } from "@/types/database"
import {
  getRecipeHistoryQueryKey,
  getRecentRecipeHistoryQueryKey,
  getRecipeHistoryStatsQueryKey,
  useMarkRecipeMade,
} from "@/hooks/use-planner"
import { plannerKeys } from "@/lib/query-keys"

const USER_ID = "test-user-id"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "test-user-id" } })),
}))

const mockSupabase = {
  rpc: vi.fn(),
}

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
  return { wrapper: Wrapper, queryClient }
}

function makeWeeklyPlan(overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    user_id: "test-user-id",
    week_date: "2026-03-02",
    recipe_ids: ["recipe-1"],
    made_recipe_ids: [],
    day_assignments: null,
    scale: 1.0,
    generated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.rpc.mockResolvedValue({
    data: [{
      action: "marked",
      recipe_uuid: "recipe-1",
      week_date: "2026-03-02",
      made_recipe_uuids: ["recipe-1"],
      history_date_made: new Date().toISOString(),
    }],
    error: null,
  })
})

describe("history query keys", () => {
  it("keeps full, recent, and stats history caches distinct", () => {
    expect(getRecipeHistoryQueryKey(USER_ID)).toContain(USER_ID)
    expect(getRecipeHistoryStatsQueryKey(USER_ID)).toContain(USER_ID)
    expect(getRecentRecipeHistoryQueryKey(USER_ID, 7)).toContain(USER_ID)
  })

  it("varies recent-history cache keys by exclusion window", () => {
    expect(getRecentRecipeHistoryQueryKey(USER_ID, 7)).not.toEqual(getRecentRecipeHistoryQueryKey(USER_ID, 14))
  })
})

describe("useMarkRecipeMade", () => {
  it("mark/unmark roundtrip updates weekly plan made ids", async () => {
    const { wrapper, queryClient } = createWrapper()
    const weekDate = "2026-03-02"

    queryClient.setQueryData(plannerKeys.week(USER_ID, weekDate), makeWeeklyPlan({ week_date: weekDate, made_recipe_ids: [] }))

    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{
          action: "marked",
          recipe_uuid: "recipe-1",
          week_date: weekDate,
          made_recipe_uuids: ["recipe-1"],
          history_date_made: "2026-03-05T00:00:00.000Z",
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          action: "unmarked",
          recipe_uuid: "recipe-1",
          week_date: weekDate,
          made_recipe_uuids: [],
          history_date_made: null,
        }],
        error: null,
      })

    const { result } = renderHook(() => useMarkRecipeMade(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ recipeId: "recipe-1", weekDate, isMadeForWeek: false, dateMade: "2026-03-05T00:00:00.000Z" })
    })

    let cached = queryClient.getQueryData<WeeklyPlan>(plannerKeys.week(USER_ID, weekDate))
    expect(cached?.made_recipe_ids).toEqual(["recipe-1"])

    await act(async () => {
      await result.current.mutateAsync({ recipeId: "recipe-1", weekDate, isMadeForWeek: true })
    })

    cached = queryClient.getQueryData<WeeklyPlan>(plannerKeys.week(USER_ID, weekDate))
    expect(cached?.made_recipe_ids).toEqual([])

    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(1, "toggle_weekly_recipe_made", {
      p_recipe_uuid: "recipe-1",
      p_week_date: weekDate,
      p_is_made_for_week: false,
      p_date_made: "2026-03-05T00:00:00.000Z",
    })
    expect(mockSupabase.rpc).toHaveBeenNthCalledWith(2, "toggle_weekly_recipe_made", {
      p_recipe_uuid: "recipe-1",
      p_week_date: weekDate,
      p_is_made_for_week: true,
      p_date_made: null,
    })
  })

  it("interleaving mark then unmark resolves to deterministic final state", async () => {
    const { wrapper, queryClient } = createWrapper()
    const weekDate = "2026-03-02"

    queryClient.setQueryData(plannerKeys.week(USER_ID, weekDate), makeWeeklyPlan({ week_date: weekDate, made_recipe_ids: [] }))

    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{
          action: "marked",
          recipe_uuid: "recipe-1",
          week_date: weekDate,
          made_recipe_uuids: ["recipe-1"],
          history_date_made: "2026-03-05T00:00:00.000Z",
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{
          action: "unmarked",
          recipe_uuid: "recipe-1",
          week_date: weekDate,
          made_recipe_uuids: [],
          history_date_made: null,
        }],
        error: null,
      })

    const { result } = renderHook(() => useMarkRecipeMade(), { wrapper })

    await act(async () => {
      await Promise.all([
        result.current.mutateAsync({ recipeId: "recipe-1", weekDate, isMadeForWeek: false }),
        result.current.mutateAsync({ recipeId: "recipe-1", weekDate, isMadeForWeek: true }),
      ])
    })

    const cached = queryClient.getQueryData<WeeklyPlan>(plannerKeys.week(USER_ID, weekDate))
    expect(cached?.made_recipe_ids).toEqual([])
  })
})
