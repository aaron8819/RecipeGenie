import React from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { recipeKeys, shoppingKeys } from "@/lib/query-keys"
import { setActivePrincipalId } from "@/lib/principal-session"
import { useDeleteRecipe } from "@/hooks/use-recipes"
import type { Recipe, ShoppingList } from "@/types/database"

const runContributionCommand = vi.fn()
const deleteRecipeByUuid = vi.fn()
const supabaseClient = { kind: "test-client" }
const RECIPE_UUID = "71111111-1111-4111-8111-111111111111"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-a" } }),
}))

vi.mock("@/lib/shopping-contribution-client", () => ({
  runRecipeContributionCommand: (...args: unknown[]) => runContributionCommand(...args),
}))

vi.mock("@/lib/recipe-deletion", () => ({
  deleteRecipeByUuid: (...args: unknown[]) => deleteRecipeByUuid(...args),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => supabaseClient,
}))

function recipe(): Recipe {
  return {
    id: RECIPE_UUID,
    legacyId: "legacy-recipe-a",
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
  deleteRecipeByUuid.mockResolvedValue(undefined)
})

describe("useDeleteRecipe", () => {
  it("uses the atomic migration-012 adapter without pre-cleaning shopping", async () => {
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(RECIPE_UUID)
    })

    expect(deleteRecipeByUuid).toHaveBeenCalledWith(
      supabaseClient,
      RECIPE_UUID,
      "user-a",
      expect.any(Function)
    )
    expect(runContributionCommand).not.toHaveBeenCalled()
    expect(queryClient.getQueryData<Recipe[]>(recipeKeys.list("user-a", {
      category: null,
      search: null,
      favoritesOnly: false,
      tags: [],
      limit: null,
    }))).toEqual([])
    expect(queryClient.getQueryData(recipeKeys.detail("user-a", RECIPE_UUID))).toBeNull()
  })

  it("supplies migration-011 contribution cleanup and reconciles its cache", async () => {
    deleteRecipeByUuid.mockImplementationOnce(async (
      _client: unknown,
      recipeUuid: string,
      _owner: string,
      cleanup: (id: string) => Promise<unknown>
    ) => cleanup(recipeUuid))
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(RECIPE_UUID)
    })

    expect(runContributionCommand).toHaveBeenCalledWith("DELETE", expect.objectContaining({
      recipeIds: [RECIPE_UUID],
    }))
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(shoppingList())
  })

  it("restores recipe caches when migration-011 contribution cleanup fails", async () => {
    deleteRecipeByUuid.mockImplementationOnce(async (
      _client: unknown,
      recipeUuid: string,
      _owner: string,
      cleanup: (id: string) => Promise<unknown>
    ) => cleanup(recipeUuid))
    runContributionCommand.mockRejectedValueOnce(new Error("contribution cleanup failed"))
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await expect(result.current.mutateAsync(RECIPE_UUID)).rejects.toThrow(
      "contribution cleanup failed"
    )

    expect(queryClient.getQueryData<Recipe>(recipeKeys.detail("user-a", RECIPE_UUID))).toMatchObject({
      id: RECIPE_UUID,
    })
  })

  it("surfaces later migration-011 failure while retaining the completed shopping cleanup", async () => {
    deleteRecipeByUuid.mockImplementationOnce(async (
      _client: unknown,
      recipeUuid: string,
      _owner: string,
      cleanup: (id: string) => Promise<unknown>
    ) => {
      await cleanup(recipeUuid)
      throw new Error("recipe delete failed")
    })
    const { wrapper, queryClient } = createWrapper()
    seedRecipeCache(queryClient)
    const { result } = renderHook(() => useDeleteRecipe(), { wrapper })

    await expect(result.current.mutateAsync(RECIPE_UUID)).rejects.toThrow("recipe delete failed")

    expect(runContributionCommand).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(shoppingList())
    expect(queryClient.getQueryData<Recipe>(recipeKeys.detail("user-a", RECIPE_UUID))).toMatchObject({
      id: RECIPE_UUID,
    })
  })
})
