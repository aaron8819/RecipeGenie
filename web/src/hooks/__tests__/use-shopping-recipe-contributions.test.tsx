import React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setActivePrincipalId } from "@/lib/principal-session"
import { shoppingKeys } from "@/lib/query-keys"
import {
  useAddToShoppingList,
  useRemoveRecipeItems,
} from "@/hooks/shopping/use-shopping-recipes"
import type { ShoppingList } from "@/types/database"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-a" } }),
}))

function shoppingList(amount = 1): ShoppingList {
  return {
    user_id: "user-a",
    items: [
      {
        rowId: "milk-row",
        item: "milk",
        amount,
        unit: "cup",
        categoryKey: "dairy",
        categoryOrder: 5,
        sources: [{ recipeId: "recipe-a", recipeName: "Recipe A" }],
      },
    ],
    already_have: [],
    excluded: [],
    source_recipes: ["recipe-a"],
    scale: 1,
    total_servings: 4,
    custom_order: false,
    generated_at: "2026-07-14T00:00:00.000Z",
    contribution_revision: 1,
    contribution_overrides: {},
    legacy_items_preserved: true,
  }
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

function response(list: ShoppingList, outcome: "applied" | "deduplicated" = "applied") {
  return new Response(
    JSON.stringify({ outcome, shopping_list: list, added: 0, merged: 1 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePrincipalId("user-a")
})

describe("recipe shopping contribution hooks", () => {
  it("sends recipe adds through the authoritative server command and reconciles exactly", async () => {
    const authoritative = shoppingList(2)
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(authoritative))
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(shoppingKeys.detail("user-a"), shoppingList(1))
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        recipeIds: ["recipe-a"],
        scale: 2,
        scaleV1: { numerator: "2", denominator: "1" },
        idempotencyKey: "request-add-a",
      })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shopping/recipe-contributions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recipeIds: ["recipe-a"],
          scale: 2,
          scaleV1: { numerator: "2", denominator: "1" },
          idempotencyKey: "request-add-a",
        }),
      })
    )
    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(authoritative)
  })

  it("does not create optimistic duplicate quantities while a request is pending", async () => {
    let resolveRequest: ((value: Response) => void) | undefined
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )
    const { wrapper, queryClient } = createWrapper()
    const initial = shoppingList(1)
    queryClient.setQueryData(shoppingKeys.detail("user-a"), initial)
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper })

    act(() => {
      result.current.mutate({
        recipeIds: ["recipe-a"],
        idempotencyKey: "duplicate-request",
      })
    })

    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(initial)

    await act(async () => {
      resolveRequest?.(response(initial, "deduplicated"))
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it("keeps the previous cache on command failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "conflict" }), { status: 409 })
    )
    const { wrapper, queryClient } = createWrapper()
    const initial = shoppingList(1)
    queryClient.setQueryData(shoppingKeys.detail("user-a"), initial)
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper })

    await expect(
      result.current.mutateAsync({
        recipeIds: ["recipe-a"],
        idempotencyKey: "failed-request",
      })
    ).rejects.toThrow("conflict")

    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(initial)
  })

  it("does not let a late response patch a new principal cache", async () => {
    let resolveRequest: ((value: Response) => void) | undefined
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )
    const { wrapper, queryClient } = createWrapper()
    const original = shoppingList(1)
    queryClient.setQueryData(shoppingKeys.detail("user-a"), original)
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper })

    let command: Promise<unknown>
    act(() => {
      command = result.current.mutateAsync({
        recipeIds: ["recipe-a"],
        idempotencyKey: "late-request",
      })
    })
    setActivePrincipalId("user-b")
    queryClient.setQueryData(shoppingKeys.detail("user-b"), { user_id: "user-b" })

    await act(async () => {
      resolveRequest?.(response(shoppingList(9)))
      await command
    })

    expect(queryClient.getQueryData(shoppingKeys.detail("user-a"))).toEqual(original)
    expect(queryClient.getQueryData(shoppingKeys.detail("user-b"))).toEqual({
      user_id: "user-b",
    })
  })

  it("removes a recipe through the same command seam and applies quantitative result", async () => {
    const withoutRecipe = { ...shoppingList(), items: [], source_recipes: [] }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(withoutRecipe))
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(shoppingKeys.detail("user-a"), shoppingList(1))
    const { result } = renderHook(() => useRemoveRecipeItems(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ recipeId: "recipe-a", recipeName: "Recipe A" })
    })

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shopping/recipe-contributions",
      expect.objectContaining({ method: "DELETE" })
    )
    expect(
      (queryClient.getQueryData(shoppingKeys.detail("user-a")) as ShoppingList).items
    ).toEqual([])
  })
})
