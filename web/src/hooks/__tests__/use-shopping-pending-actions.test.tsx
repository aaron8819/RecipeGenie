import React from "react"
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ShoppingItem, ShoppingList } from "@/types/database"
import { SHOPPING_KEY } from "@/hooks/shopping/shared"
import { useShoppingPendingActions } from "@/hooks/shopping/use-shopping-pending-actions"

type ToastOptions = {
  message: string
  duration?: number
  onUndo?: () => void
  onExpire?: () => void
  onDismiss?: () => void
  queueBehavior?: "replace" | "enqueue"
}

const shownToasts: ToastOptions[] = []
const dismissToast = vi.fn()
const showToast = vi.fn((options: ToastOptions) => {
  shownToasts.push(options)
})

vi.mock("@/components/ui/undo-toast", () => ({
  useUndoToast: () => ({
    show: showToast,
    dismiss: dismissToast,
  }),
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

function makeItem(item: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    rowId: `row-${item}`,
    item,
    amount: 1,
    unit: "",
    categoryKey: "produce",
    categoryOrder: 1,
    sources: [{ recipeName: "Manual" }],
    checked: false,
    ...overrides,
  }
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    user_id: "user-1",
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1,
    total_servings: 4,
    custom_order: false,
    generated_at: "2026-03-07T00:00:00.000Z",
    ...overrides,
  }
}

function flushPromises() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  shownToasts.length = 0
  dismissToast.mockReset()
  showToast.mockClear()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe("useShoppingPendingActions", () => {
  it("keeps a pending item removal hidden across query refetches and rerenders", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem("garlic"), makeItem("onion")] })
    )

    const removeItemCommit = vi.fn(async () => undefined)
    const { result, rerender } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: removeItemCommit },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(makeItem("garlic", { rowId: "row-garlic" }))
    })

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items.map((item) => item.item)
    ).toEqual(["onion"])

    act(() => {
      queryClient.setQueryData(
        [...SHOPPING_KEY],
        makeList({ items: [makeItem("garlic"), makeItem("onion"), makeItem("pepper")] })
      )
    })

    rerender()

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items.map((item) => item.item)
    ).toEqual(["onion", "pepper"])
  })

  it("projects only the targeted duplicate row out of the list", () => {
    const { wrapper, queryClient } = createWrapper()
    const garlicCloves = makeItem("garlic", { rowId: "row-garlic-cloves", unit: "clove" })
    const garlicBulb = makeItem("garlic", { rowId: "row-garlic-bulb", unit: "bulb" })
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [garlicCloves, garlicBulb] })
    )

    const { result } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: vi.fn(async () => undefined) },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(garlicCloves)
    })

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items.map((item) => item.rowId)
    ).toEqual(["row-garlic-bulb"])
  })

  it("keeps a later pending clear list dominant when an earlier remove is undone", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem("garlic"), makeItem("onion")] })
    )

    const { result } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: vi.fn(async () => undefined) },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(makeItem("garlic", { rowId: "row-garlic" }))
      result.current.enqueueClearList()
    })

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items
    ).toHaveLength(0)

    await act(async () => {
      shownToasts[0]?.onUndo?.()
      await Promise.resolve()
    })
    expect(result.current.pendingActionCount).toBe(1)
    expect(result.current.pendingActions[0]?.kind).toBe("clear-list")

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items
    ).toHaveLength(0)
    expect(shownToasts.at(-1)?.message).toBe("Shopping list cleared")
  })

  it("preserves later base mutations when a pending clear list is undone", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem("garlic")] })
    )

    const { result } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: vi.fn(async () => undefined) },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueClearList()
    })

    act(() => {
      queryClient.setQueryData(
        [...SHOPPING_KEY],
        makeList({ items: [makeItem("garlic"), makeItem("beans", { checked: true })] })
      )
    })

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items
    ).toHaveLength(0)

    await act(async () => {
      shownToasts[0]?.onUndo?.()
      await Promise.resolve()
    })

    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items.map((item) => ({ item: item.item, checked: item.checked }))
    ).toEqual([
      { item: "garlic", checked: false },
      { item: "beans", checked: true },
    ])
  })

  it("keeps action 2 overlaid while action 1 commits and invalidates", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem("garlic"), makeItem("onion")] })
    )

    const removeItemCommit = vi.fn(async (rowId: string) => {
      if (rowId === "row-garlic") {
        queryClient.setQueryData(
          [...SHOPPING_KEY],
          makeList({ items: [makeItem("onion")] })
        )
      }
    })

    const { result } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: removeItemCommit },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(makeItem("garlic", { rowId: "row-garlic" }))
      result.current.enqueueRemoveItem(makeItem("onion", { rowId: "row-onion" }))
    })

    await act(async () => {
      shownToasts[0]?.onDismiss?.()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.pendingActionCount).toBe(1)
    expect(result.current.pendingActions[0]?.kind).toBe("remove-item")
    expect((result.current.pendingActions[0] as { itemName?: string } | undefined)?.itemName).toBe("onion")

    expect(removeItemCommit.mock.calls[0]).toEqual(["row-garlic"])
    expect(
      result.current.projectShoppingList(
        queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      )?.items
    ).toHaveLength(0)
    expect(shownToasts.at(-1)?.message).toBe('"onion" removed from list')
  })

  it("resolves commit exactly once near the dismiss-timeout boundary", async () => {
    const { wrapper } = createWrapper()
    const removeItemCommit = vi.fn(async () => undefined)

    const { result } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: removeItemCommit },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(makeItem("garlic", { rowId: "row-garlic" }))
    })

    await act(async () => {
      shownToasts[0]?.onDismiss?.()
      vi.advanceTimersByTime(5000)
      shownToasts[0]?.onExpire?.()
      await Promise.resolve()
    })

    expect(removeItemCommit).toHaveBeenCalledTimes(1)
  })

  it("commits pending actions on unmount instead of silently losing them", async () => {
    const { wrapper } = createWrapper()
    const removeItemCommit = vi.fn(async () => undefined)

    const { result, unmount } = renderHook(
      () =>
        useShoppingPendingActions({
          removeItemCommit: { mutateAsync: removeItemCommit },
          removeRecipeCommit: { mutateAsync: vi.fn(async () => undefined) },
          clearListCommit: { mutateAsync: vi.fn(async () => undefined) },
        }),
      { wrapper }
    )

    act(() => {
      result.current.enqueueRemoveItem(makeItem("garlic", { rowId: "row-garlic" }))
    })

    unmount()
    await flushPromises()

    expect(removeItemCommit).toHaveBeenCalledTimes(1)
    expect(dismissToast).toHaveBeenCalledTimes(1)
  })
})
