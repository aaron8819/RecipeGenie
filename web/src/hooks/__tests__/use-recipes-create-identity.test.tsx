import React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useCreateRecipe } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"
import { recipeKeys } from "@/lib/query-keys"
import { isRecipeUuid, type RecipeRow } from "@/lib/recipe-identity"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-1" } }),
}))

type SingleResult = Promise<{
  data: RecipeRow | null
  error: { code?: string; message: string } | null
}>

const insertSingleMock = vi.fn<() => SingleResult>()
const existingSingleMock = vi.fn<() => SingleResult>()
const insertMock = vi.fn(() => ({
  select: () => ({
    single: insertSingleMock,
  }),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    from: () => ({
      insert: insertMock,
      select: () => ({
        eq: () => ({
          eq: () => ({ single: existingSingleMock }),
        }),
      }),
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

function makeRecipeRow(id: string, name: string): RecipeRow {
  return {
    ...makeRecipe(id, name),
    id,
    recipe_uuid: id,
    ingredients: [],
    notes: [],
    instruction_groups: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
  } as RecipeRow
}

describe("useCreateRecipe identity reconciliation", () => {
  beforeEach(() => {
    insertSingleMock.mockReset()
    existingSingleMock.mockReset()
    insertMock.mockClear()
  })

  it("uses the same name-independent UUID for optimistic and server-backed recipe entries", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const filters = {
      category: null,
      search: null,
      favoritesOnly: false,
      tags: [] as string[],
      limit: null,
    }
    const recipesKey = recipeKeys.list("user-1", filters)
    const userBRecipesKey = recipeKeys.list("user-2", filters)
    queryClient.setQueryData(recipesKey, [])
    queryClient.setQueryData(userBRecipesKey, [{ ...makeRecipe("b-recipe", "B Recipe"), user_id: "user-2" }])

    const pendingInsert = deferred<{ data: RecipeRow | null; error: { message: string } | null }>()
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

    let optimisticId = ""
    await waitFor(() => {
      optimisticId = queryClient.getQueryData<Recipe[]>(recipesKey)?.[0]?.id || ""
      expect(isRecipeUuid(optimisticId)).toBe(true)
    })

    pendingInsert.resolve({
      data: makeRecipeRow(optimisticId, "Mom's Best Pasta!"),
      error: null,
    })

    await act(async () => {
      await mutationPromise!
    })

    expect(queryClient.getQueryData<Recipe[]>(recipesKey)).toEqual([
      expect.objectContaining({
        id: optimisticId,
        name: "Mom's Best Pasta!",
      }),
    ])
    expect(queryClient.getQueryData<Recipe[]>(userBRecipesKey)).toEqual([
      expect.objectContaining({ id: "b-recipe", user_id: "user-2" }),
    ])
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: optimisticId,
        recipe_uuid: optimisticId,
        user_id: "user-1",
      })
    )
  })

  it("reconciles a lost successful response by the same UUID without cache duplication", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const filters = { category: null, search: null, favoritesOnly: false, tags: [] as string[], limit: null }
    const recipesKey = recipeKeys.list("user-1", filters)
    queryClient.setQueryData(recipesKey, [])
    insertSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate UUID" },
    })
    existingSingleMock.mockResolvedValueOnce({
      data: makeRecipeRow("11111111-1111-4111-8111-111111111111", "Retry Recipe"),
      error: null,
    })
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useCreateRecipe(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        recipeUuid: "11111111-1111-4111-8111-111111111111",
        name: "Retry Recipe",
        category: "dinner",
        ingredients: [],
        instructions: [],
      })
    })

    expect(queryClient.getQueryData<Recipe[]>(recipesKey)).toEqual([
      expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }),
    ])
  })

  it("rolls back only the failed optimistic UUID", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const filters = { category: null, search: null, favoritesOnly: false, tags: [] as string[], limit: null }
    const recipesKey = recipeKeys.list("user-1", filters)
    const existing = makeRecipe("22222222-2222-4222-8222-222222222222", "Existing")
    queryClient.setQueryData(recipesKey, [existing])
    insertSingleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "50000", message: "insert failed" },
    })
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useCreateRecipe(), { wrapper: Wrapper })

    await expect(result.current.mutateAsync({
      name: "Same Name",
      category: "dinner",
      ingredients: [],
      instructions: [],
    })).rejects.toMatchObject({ message: "insert failed" })

    expect(queryClient.getQueryData(recipesKey)).toEqual([existing])
  })
})
