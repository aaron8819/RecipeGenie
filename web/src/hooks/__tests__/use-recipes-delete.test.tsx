import React from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { recipeKeys, shoppingKeys } from "@/lib/query-keys"
import { setActivePrincipalId } from "@/lib/principal-session"
import { useDeleteRecipe } from "@/hooks/use-recipes"
import type { Recipe, ShoppingList } from "@/types/database"

const runContributionCommand = vi.fn()
const deleteRecipeRow = vi.fn()
const deleteById = vi.fn(() => ({ eq: deleteRecipeRow }))
const deleteRows = vi.fn(() => ({ eq: deleteById }))

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-a" } }),
}))

vi.mock("@/lib/shopping-contribution-client", () => ({
  runRecipeContributionCommand: (...args: unknown[]) => runContributionCommand(...args),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    from: vi.fn(() => ({ delete: deleteRows })),
  }),
}))

function recipe(): Recipe {
  return {
    id: "recipe-a",
    user_id: "user-a",
    name: "Recipe A",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: [],
    instructions: [],
    image_url: null,
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
  }
}

function shoppingList(items: ShoppingList["items"] = []): ShoppingList {
  return {
    user_id: "user-a",
    items,
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1,
    total_servings: 0,
    custom_order: false,
    generated_at: "2026-07-15T00:00:00.000Z",
    contribution_revision: 2,
    contribution_overrides: {},
    legacy_items_preserved: true,
  }
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

function seedRecipeCache(queryClient: QueryClient) {
  const value = recipe()
  queryClient.setQueryData(recipeKeys.list("user-a", {
    category: null,
    search: null,
    favoritesOnly: false,
    tags: [],
    limit: null,
  }), [value])
  queryClient.setQueryData(recipeKeys.detail("user-a", value.id), value)
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePrincipalId("user-a")
  runContributionCommand.mockResolvedValue({ shopping_list: shoppingList() })
  deleteRecipeRow.mockResolvedValue({ error: null })
})

describe("useDeleteRecipe", () => {
  it("removes the contribution before the recipe and reconciles scoped caches", async () => {
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync("recipe-a")
    })

    expect(runContributionCommand).toHaveBeenCalledWith("DELETE", expect.objectContaining({
      recipeIds: ["recipe-a"],
    }))
    expect(runContributionCommand.mock.invocationCallOrder[0]).toBeLessThan(
      deleteRows.mock.invocationCallOrder[0]
    )
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(shoppingList())
    expect(queryClient.getQueryData<Recipe[]>(recipeKeys.list("user-a", {
      category: null,
      search: null,
      favoritesOnly: false,
      tags: [],
      limit: null,
    }))).toEqual([])
    expect(queryClient.getQueryData(recipeKeys.detail("user-a", "recipe-a"))).toBeNull()
  })

  it("does not delete the recipe when contribution removal fails", async () => {
    runContributionCommand.mockRejectedValueOnce(new Error("contribution cleanup failed"))
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await expect(result.current.mutateAsync("recipe-a")).rejects.toThrow(
      "contribution cleanup failed"
    )

    expect(deleteRows).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<Recipe>(recipeKeys.detail("user-a", "recipe-a"))).toMatchObject({
      id: "recipe-a",
    })
  })

  it("keeps contribution cleanup but restores recipe cache when recipe deletion fails", async () => {
    deleteRecipeRow.mockResolvedValueOnce({ error: new Error("recipe delete failed") })
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await expect(result.current.mutateAsync("recipe-a")).rejects.toThrow("recipe delete failed")

    expect(runContributionCommand).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(shoppingList())
    expect(queryClient.getQueryData<Recipe>(recipeKeys.detail("user-a", "recipe-a"))).toMatchObject({
      id: "recipe-a",
    })
  })
})
