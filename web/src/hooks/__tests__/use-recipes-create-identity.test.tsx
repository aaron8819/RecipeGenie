import React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { useCreateRecipe } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-1" } }),
}))

type SingleResult = Promise<{ data: Recipe | null; error: { message: string } | null }>

const insertSingleMock = vi.fn<() => SingleResult>()
const insertMock = vi.fn(() => ({
  select: () => ({
    single: insertSingleMock,
  }),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeRecipe(id: string, name: string): Recipe {
  return {
    id,
    user_id: "user-1",
    name,
    category: "dinner",
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: [],
    instructions: [],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  }
}

describe("useCreateRecipe identity reconciliation", () => {
  it("uses the same sanitized id for optimistic and server-backed recipe entries", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const recipesKey = ["recipes", "list"]
    queryClient.setQueryData(recipesKey, [])

    const pendingInsert = deferred<{ data: Recipe | null; error: { message: string } | null }>()
    insertSingleMock.mockReturnValueOnce(pendingInsert.promise)

    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }

    const { result } = renderHook(() => useCreateRecipe(), { wrapper: Wrapper })

    let mutationPromise: Promise<Recipe>
    await act(async () => {
      mutationPromise = result.current.mutateAsync({
        name: "Mom's Best Pasta!",
        category: "dinner",
        servings: 4,
        tags: [],
        ingredients: [],
        instructions: [],
        image_url: null,
        favorite: false,
      })
    })

    await waitFor(() => {
      expect(queryClient.getQueryData<Recipe[]>(recipesKey)).toEqual([
        expect.objectContaining({
          id: "moms-best-pasta",
          name: "Mom's Best Pasta!",
        }),
      ])
    })

    pendingInsert.resolve({
      data: makeRecipe("moms-best-pasta", "Mom's Best Pasta!"),
      error: null,
    })

    await act(async () => {
      await mutationPromise!
    })

    expect(queryClient.getQueryData<Recipe[]>(recipesKey)).toEqual([
      expect.objectContaining({
        id: "moms-best-pasta",
        name: "Mom's Best Pasta!",
      }),
    ])
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "moms-best-pasta",
        user_id: "user-1",
      })
    )
  })
})
