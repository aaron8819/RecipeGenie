import React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import type { RecipeHistory, RecipeHistoryStatsRow } from "@/types/database"
import {
  getRecipeHistoryQueryKey,
  getRecipeHistoryStatsQueryKey,
  useMarkRecipeAsMade,
  useUnmarkRecipeAsMade,
} from "@/hooks/use-planner"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-1" } }),
}))

const insertMock = vi.fn()
const deleteEqMock = vi.fn()
const maybeSingleMock = vi.fn()

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    from: () => ({
      insert: insertMock,
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: maybeSingleMock,
              }),
            }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: deleteEqMock,
        }),
      }),
    }),
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe("recipe history stats cache freshness", () => {
  it("optimistically refreshes recipe stats when a recipe is marked as made", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const pendingInsert = deferred<{ error: null }>()
    insertMock.mockReturnValueOnce(pendingInsert.promise)

    queryClient.setQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(), [
      { recipe_id: "recipe-1", times_made: 1, last_made: "2026-03-01T00:00:00.000Z" },
    ])

    const { result } = renderHook(() => useMarkRecipeAsMade(), {
      wrapper: createWrapper(queryClient),
    })

    let mutationPromise: Promise<{ recipeId: string }>
    await act(async () => {
      mutationPromise = result.current.mutateAsync("recipe-1")
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey())).toEqual([
        expect.objectContaining({
          recipe_id: "recipe-1",
          times_made: 2,
        }),
      ])
    })

    pendingInsert.resolve({ error: null })
    await act(async () => {
      await mutationPromise!
    })
  })

  it("recomputes recipe stats when the most recent made entry is unmarked", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    const history: RecipeHistory[] = [
      {
        id: 2,
        user_id: "user-1",
        recipe_id: "recipe-1",
        date_made: "2026-03-05T00:00:00.000Z",
      },
      {
        id: 1,
        user_id: "user-1",
        recipe_id: "recipe-1",
        date_made: "2026-03-01T00:00:00.000Z",
      },
    ]

    queryClient.setQueryData(getRecipeHistoryQueryKey(), history)
    queryClient.setQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(), [
      { recipe_id: "recipe-1", times_made: 2, last_made: "2026-03-05T00:00:00.000Z" },
    ])

    maybeSingleMock.mockResolvedValueOnce({
      data: { id: 2 },
      error: null,
    })
    deleteEqMock.mockResolvedValueOnce({ error: null })

    const { result } = renderHook(() => useUnmarkRecipeAsMade(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync("recipe-1")
    })

    expect(queryClient.getQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey())).toEqual([
      {
        recipe_id: "recipe-1",
        times_made: 1,
        last_made: "2026-03-01T00:00:00.000Z",
      },
    ])
  })
})
