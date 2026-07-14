import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ShoppingList, ShoppingItem } from "@/types/database"
import { shoppingKeys } from "@/lib/query-keys"
import {
  useCheckOffItem,
  useRemoveShoppingItem,
  useAddShoppingItem,
  useBulkCheckOff,
  useReorderShoppingList,
} from "@/hooks/shopping"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "test-user-id" } })),
}))

const SHOPPING_KEY = shoppingKeys.detail("test-user-id")

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  upsert: vi.fn(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
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

function makeItem(item: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    rowId: `row-${item}-${overrides.unit || "unit"}-${overrides.amount ?? 1}`,
    item,
    amount: 1,
    unit: "cup",
    categoryKey: "produce",
    categoryOrder: 1,
    sources: [{ recipeName: "Test Recipe" }],
    checked: false,
    ...overrides,
  }
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    user_id: "test-user-id",
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1.0,
    total_servings: 4,
    custom_order: false,
    generated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.from.mockReturnThis()
  mockSupabase.select.mockReturnThis()
  mockSupabase.update.mockReturnThis()
  mockSupabase.upsert.mockResolvedValue({ data: null, error: null })
  mockSupabase.insert.mockReturnThis()
  mockSupabase.delete.mockReturnThis()
  mockSupabase.single.mockResolvedValue({ data: null, error: null })
  mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null })
  mockSupabase.eq.mockResolvedValue({ data: null, error: null })
})

describe("useCheckOffItem", () => {
  it("toggles only the targeted duplicate row", async () => {
    const { wrapper, queryClient } = createWrapper()
    const firstMilk = makeItem("milk", { rowId: "row-milk-cup", unit: "cup", checked: false })
    const secondMilk = makeItem("milk", { rowId: "row-milk-bottle", unit: "bottle", checked: false })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [firstMilk, secondMilk] })
    )

    mockSupabase.single.mockResolvedValueOnce({
      data: { items: [firstMilk, secondMilk] },
      error: null,
    })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(firstMilk)
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((item) => item.rowId === "row-milk-cup")?.checked).toBe(true)
    expect(cached?.items.find((item) => item.rowId === "row-milk-bottle")?.checked).toBe(false)
  })

  it("concurrent toggles resolve by row identity", async () => {
    const { wrapper, queryClient } = createWrapper()
    const firstMilk = makeItem("milk", { rowId: "row-milk-cup", unit: "cup", checked: false })
    const secondMilk = makeItem("milk", { rowId: "row-milk-bottle", unit: "bottle", checked: false })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [firstMilk, secondMilk] })
    )

    mockSupabase.single
      .mockResolvedValueOnce({ data: { items: [firstMilk, secondMilk] }, error: null })
      .mockResolvedValueOnce({
        data: {
          items: [
            { ...firstMilk, checked: true },
            secondMilk,
          ],
        },
        error: null,
      })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })
    await act(async () => {
      await Promise.all([
        result.current.mutateAsync(firstMilk),
        result.current.mutateAsync(secondMilk),
      ])
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((item) => item.rowId === "row-milk-cup")?.checked).toBe(true)
    expect(cached?.items.find((item) => item.rowId === "row-milk-bottle")?.checked).toBe(true)
  })
})

describe("useBulkCheckOff", () => {
  it("checks only the requested rowIds when names collide", async () => {
    const { wrapper, queryClient } = createWrapper()
    const brothCup = makeItem("stock", { rowId: "row-stock-cup", unit: "cup", checked: false })
    const brothCan = makeItem("stock", { rowId: "row-stock-can", unit: "can", checked: false })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [brothCup, brothCan] })
    )

    mockSupabase.single.mockResolvedValueOnce({
      data: { items: [brothCup, brothCan] },
      error: null,
    })

    const { result } = renderHook(() => useBulkCheckOff(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync([brothCup])
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((item) => item.rowId === "row-stock-cup")?.checked).toBe(true)
    expect(cached?.items.find((item) => item.rowId === "row-stock-can")?.checked).toBe(false)
  })
})

describe("useRemoveShoppingItem", () => {
  it("removes only the target duplicate row on successful commit", async () => {
    const { wrapper, queryClient } = createWrapper()
    const garlicCloves = makeItem("garlic", { rowId: "row-garlic-cloves", unit: "clove" })
    const garlicBulb = makeItem("garlic", { rowId: "row-garlic-bulb", unit: "bulb" })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [garlicCloves, garlicBulb] })
    )

    mockSupabase.single.mockResolvedValueOnce({
      data: { items: [garlicCloves, garlicBulb] },
      error: null,
    })

    const { result } = renderHook(() => useRemoveShoppingItem(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync("row-garlic-cloves")
    })

    expect(mockSupabase.update).toHaveBeenCalledWith({
      items: [garlicBulb],
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(2)
  })

  it("propagates errors without mutating cache locally", async () => {
    const { wrapper, queryClient } = createWrapper()
    const garlic = makeItem("garlic", { rowId: "row-garlic" })
    const onion = makeItem("onion", { rowId: "row-onion" })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [garlic, onion] })
    )

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: "fail", code: "ERR" },
    })

    const { result } = renderHook(() => useRemoveShoppingItem(), { wrapper })

    await expect(result.current.mutateAsync("row-garlic")).rejects.toEqual({ message: "fail", code: "ERR" })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(2)
  })
})

describe("useAddShoppingItem", () => {
  it("optimistically adds a new item to cache with a rowId", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem("milk", { rowId: "row-milk" })] })
    )

    mockSupabase.single
      .mockResolvedValueOnce({ data: { category_overrides: {} }, error: null })
      .mockResolvedValueOnce({ data: { items: [makeItem("milk", { rowId: "row-milk" })], custom_order: false }, error: null })

    const { result } = renderHook(() => useAddShoppingItem(), { wrapper })

    result.current.mutate({ itemName: "eggs" })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    const eggs = cached?.items.find((item) => item.item === "eggs")
    expect(cached?.items).toHaveLength(2)
    expect(eggs?.rowId).toBeTruthy()
  })
})

describe("useReorderShoppingList", () => {
  it("persists the current list order and learns category item order preferences", async () => {
    const { wrapper } = createWrapper()
    const avocado = makeItem("avocado", { rowId: "row-avocado", unit: "" })
    const garlic = makeItem("garlic", { rowId: "row-garlic", unit: "" })
    const arugula = makeItem("arugula", { rowId: "row-arugula", unit: "cup" })

    mockSupabase.maybeSingle.mockResolvedValueOnce({
      data: { shopping_item_order: { produce: ["lime", "garlic"] } },
      error: null,
    })

    const { result } = renderHook(() => useReorderShoppingList(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync([avocado, garlic, arugula])
    })

    expect(mockSupabase.update).toHaveBeenCalledWith({
      items: expect.arrayContaining([
        expect.objectContaining({ rowId: "row-avocado" }),
        expect.objectContaining({ rowId: "row-garlic" }),
        expect.objectContaining({ rowId: "row-arugula" }),
      ]),
      custom_order: true,
    })
    expect(mockSupabase.upsert).toHaveBeenCalledWith(
      {
        user_id: "test-user-id",
        shopping_item_order: {
          produce: ["lime", "avocado", "garlic", "arugula"],
        },
      },
      { onConflict: "user_id" }
    )
  })
})
