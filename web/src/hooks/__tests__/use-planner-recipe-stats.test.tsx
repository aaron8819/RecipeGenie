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

const USER_ID = "user-1"

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
    const pendingInsert = deferred<{ data: { id: number }; error: null }>()
    insertMock.mockReturnValueOnce({ select: () => ({ single: () => pendingInsert.promise }) })

    queryClient.setQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(USER_ID), [
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
      expect(queryClient.getQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(USER_ID))).toEqual([
        expect.objectContaining({
          recipe_id: "recipe-1",
          times_made: 2,
        }),
      ])
    })

    pendingInsert.resolve({ data: { id: 42 }, error: null })
    await act(async () => {
      expect(await mutationPromise!).toEqual({ recipeId: "recipe-1", historyId: 42 })
    })
  })

  it("rolls back a rejected exact-entry Undo and preserves newer history on retry", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const history: RecipeHistory[] = [
      { id: 43, user_id: USER_ID, recipe_id: "recipe-1", date_made: "2026-03-06T00:00:00.000Z" },
      { id: 42, user_id: USER_ID, recipe_id: "recipe-1", date_made: "2026-03-05T00:00:00.000Z" },
    ]
    const stats = [{ recipe_id: "recipe-1", times_made: 2, last_made: history[0].date_made }]
    queryClient.setQueryData(getRecipeHistoryQueryKey(USER_ID), history)
    queryClient.setQueryData(getRecipeHistoryStatsQueryKey(USER_ID), stats)
    const { result } = renderHook(() => useUnmarkRecipeAsMade(), { wrapper: createWrapper(queryClient) })
    deleteEqMock.mockResolvedValueOnce({ error: new Error("Rejected") })
    const target = { recipeId: "recipe-1", historyId: 42 }
    await act(async () => { await expect(result.current.mutateAsync(target)).rejects.toThrow("Rejected") })
    expect(queryClient.getQueryData(getRecipeHistoryQueryKey(USER_ID))).toEqual(history)
    expect(queryClient.getQueryData(getRecipeHistoryStatsQueryKey(USER_ID))).toEqual(stats)
    deleteEqMock.mockResolvedValueOnce({ error: null })
    await act(async () => { await result.current.mutateAsync(target) })
    expect(deleteEqMock).toHaveBeenLastCalledWith("id", 42)
    expect(queryClient.getQueryData(getRecipeHistoryQueryKey(USER_ID))).toEqual([history[0]])
    expect(queryClient.getQueryData(getRecipeHistoryStatsQueryKey(USER_ID))).toEqual([
      { recipe_id: "recipe-1", times_made: 1, last_made: history[0].date_made },
    ])
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

    queryClient.setQueryData(getRecipeHistoryQueryKey(USER_ID), history)
    queryClient.setQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(USER_ID), [
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

    expect(queryClient.getQueryData<RecipeHistoryStatsRow[]>(getRecipeHistoryStatsQueryKey(USER_ID))).toEqual([
      {
        recipe_id: "recipe-1",
        times_made: 1,
        last_made: "2026-03-01T00:00:00.000Z",
      },
    ])
  })
})
