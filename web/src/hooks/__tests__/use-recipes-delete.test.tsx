import React from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { recipeKeys, shoppingKeys } from "@/lib/query-keys"
import { setActivePrincipalId } from "@/lib/principal-session"
import { useDeleteRecipe } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"

const deleteRecipeByUuid = vi.fn()
const supabaseClient = { kind: "test-client" }
const recipeUuid = "71111111-1111-4111-8111-111111111111"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-a" } }),
}))
vi.mock("@/lib/recipe-deletion", () => ({
  deleteRecipeByUuid: (...args: unknown[]) => deleteRecipeByUuid(...args),
}))
vi.mock("@/lib/supabase/client", () => ({ getSupabase: () => supabaseClient }))

const recipe: Recipe = {
  id: recipeUuid,
  legacyId: "legacy-a",
  user_id: "user-a",
  name: "Recipe A",
  category: "Dinner",
  servings: 4,
  favorite: false,
  tags: [],
  ingredientSections: [],
  instructionSections: [],
  image_url: null,
  created_at: "2026-07-15T00:00:00.000Z",
  updated_at: "2026-07-15T00:00:00.000Z",
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { wrapper: Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePrincipalId("user-a")
  deleteRecipeByUuid.mockResolvedValue(recipeUuid)
})

describe("useDeleteRecipe", () => {
  it("delegates recipe and Shopping cleanup to the atomic database function", async () => {
    const { wrapper, queryClient } = createWrapper()
    const listKey = recipeKeys.list("user-a", {
      category: null, search: null, favoritesOnly: false, tags: [], limit: null,
    })
    queryClient.setQueryData(listKey, [recipe])
    queryClient.setQueryData(recipeKeys.detail("user-a", recipeUuid), recipe)
    queryClient.setQueryData(shoppingKeys.detail("user-a"), { contentRevision: 1 })
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await act(() => result.current.mutateAsync(recipeUuid))

    expect(deleteRecipeByUuid).toHaveBeenCalledWith(supabaseClient, recipeUuid, "user-a")
    expect(queryClient.getQueryData(listKey)).toEqual([])
    expect(queryClient.getQueryData(recipeKeys.detail("user-a", recipeUuid))).toBeNull()
    expect(queryClient.getQueryState(shoppingKeys.detail("user-a"))?.isInvalidated).toBe(true)
  })

  it("restores recipe caches when the atomic delete fails", async () => {
    deleteRecipeByUuid.mockRejectedValueOnce(new Error("recipe delete failed"))
    const { wrapper, queryClient } = createWrapper()
    const detailKey = recipeKeys.detail("user-a", recipeUuid)
    queryClient.setQueryData(detailKey, recipe)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await expect(result.current.mutateAsync(recipeUuid)).rejects.toThrow("recipe delete failed")
    expect(queryClient.getQueryData<Recipe>(detailKey)).toMatchObject({ id: recipeUuid })
  })
})
