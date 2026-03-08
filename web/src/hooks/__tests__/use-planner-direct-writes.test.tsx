import React from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WeeklyPlan } from "@/types/database"
import {
  useRemoveRecipeFromPlan,
  useSaveDayAssignments,
  useSaveWeeklyPlan,
} from "@/hooks/use-planner"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "test-user-id" } })),
}))

type MockDbState = {
  weeklyPlan: WeeklyPlan | null
  lastUpsert: Record<string, unknown> | null
}

const dbState: MockDbState = {
  weeklyPlan: null,
  lastUpsert: null,
}

class WeeklyPlansBuilder {
  private action: "select" | "upsert" | "update" | "insert" | null = null
  private payload: Record<string, unknown> | null = null

  select() {
    this.action = "select"
    return this
  }

  eq() {
    return this
  }

  maybeSingle() {
    return Promise.resolve({ data: dbState.weeklyPlan, error: null })
  }

  single() {
    if (!dbState.weeklyPlan) {
      return Promise.resolve({ data: null, error: { message: "not found" } })
    }
    return Promise.resolve({ data: dbState.weeklyPlan, error: null })
  }

  upsert(payload: Record<string, unknown>) {
    this.action = "upsert"
    this.payload = payload
    return this
  }

  update(payload: Record<string, unknown>) {
    this.action = "update"
    this.payload = payload
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.action = "insert"
    this.payload = payload
    return this
  }

  then(resolve: (value: { error: null }) => void) {
    if (this.action === "upsert" || this.action === "insert") {
      dbState.lastUpsert = this.payload
      dbState.weeklyPlan = this.payload as unknown as WeeklyPlan
    }

    if (this.action === "update") {
      dbState.lastUpsert = {
        ...(dbState.weeklyPlan || {}),
        ...(this.payload || {}),
      }
      dbState.weeklyPlan = dbState.lastUpsert as WeeklyPlan
    }

    resolve({ error: null })
  }
}

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === "weekly_plans") {
      return new WeeklyPlansBuilder()
    }
    throw new Error(`Unexpected table: ${table}`)
  }),
}

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
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
    recipe_ids: ["recipe-1", "recipe-2"],
    made_recipe_ids: ["recipe-2"],
    day_assignments: {
      "recipe-1": 1,
      "recipe-2": 3,
    },
    scale: 2,
    generated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbState.weeklyPlan = null
  dbState.lastUpsert = null
})

describe("direct weekly_plans write contract", () => {
  it("useSaveWeeklyPlan preserves made ids while explicitly replacing recipe ids and day assignments", async () => {
    dbState.weeklyPlan = makeWeeklyPlan()
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useSaveWeeklyPlan(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        weekDate: "2026-03-02",
        recipeIds: ["recipe-3"],
        dayAssignments: null,
      })
    })

    expect(dbState.lastUpsert).toMatchObject({
      user_id: "test-user-id",
      week_date: "2026-03-02",
      recipe_ids: ["recipe-3"],
      day_assignments: null,
      made_recipe_ids: ["recipe-2"],
      scale: 1,
    })
    expect(typeof dbState.lastUpsert?.generated_at).toBe("string")
  })

  it("useSaveDayAssignments creates a consistent weekly plan row when none exists", async () => {
    const { wrapper } = createWrapper()

    const { result } = renderHook(() => useSaveDayAssignments(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        weekDate: "2026-03-02",
        dayAssignments: { "recipe-9": 4 },
      })
    })

    expect(dbState.lastUpsert).toMatchObject({
      user_id: "test-user-id",
      week_date: "2026-03-02",
      recipe_ids: [],
      day_assignments: { "recipe-9": 4 },
      made_recipe_ids: [],
      scale: 1,
    })
    expect(typeof dbState.lastUpsert?.generated_at).toBe("string")
  })

  it("useRemoveRecipeFromPlan removes recipe, made state, and assignment while preserving scale", async () => {
    dbState.weeklyPlan = makeWeeklyPlan()
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(["weekly_plans", "2026-03-02"], makeWeeklyPlan())

    const { result } = renderHook(() => useRemoveRecipeFromPlan(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        weekDate: "2026-03-02",
        recipeId: "recipe-2",
      })
    })

    expect(dbState.lastUpsert).toMatchObject({
      user_id: "test-user-id",
      week_date: "2026-03-02",
      recipe_ids: ["recipe-1"],
      made_recipe_ids: [],
      day_assignments: { "recipe-1": 1 },
      scale: 2,
      generated_at: "2026-03-01T00:00:00.000Z",
    })
  })
})
