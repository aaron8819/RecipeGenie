import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingListView } from "../shopping-list"
import { UndoToastProvider, useUndoToast } from "@/components/ui/undo-toast"
import type { ShoppingItem, ShoppingList, UserConfig } from "@/types/database"

globalThis.React = React

type ResolveFn = () => void

const shoppingListeners = new Set<() => void>()
const removeItemMutate = vi.fn<(rowId: string) => void>()
const removeRecipeItemsMutate = vi.fn<(recipeName: string) => void>()
const clearListMutate = vi.fn<() => void>()
const moveToListMutate = vi.fn<(item: ShoppingItem) => void>()
const moveExcludedMutate = vi.fn<(item: ShoppingItem) => void>()
const bulkMutationEvents: string[] = []
const bulkMutationResolvers: ResolveFn[] = []
const moveExcludedResolvers: ResolveFn[] = []
const originalConsoleError = console.error

let currentShoppingList: ShoppingList
let currentConfig: UserConfig
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

function notifyShoppingListeners() {
  shoppingListeners.forEach((listener) => listener())
}

function setShoppingList(next: ShoppingList) {
  currentShoppingList = next
  notifyShoppingListeners()
}

function subscribeShoppingList(listener: () => void) {
  shoppingListeners.add(listener)
  return () => {
    shoppingListeners.delete(listener)
  }
}

function updateShoppingList(updater: (prev: ShoppingList) => ShoppingList) {
  setShoppingList(updater(currentShoppingList))
}

function cloneList(list: ShoppingList): ShoppingList {
  return {
    ...list,
    items: [...list.items],
    already_have: [...list.already_have],
    excluded: [...list.excluded],
    source_recipes: [...(list.source_recipes || [])],
  }
}

function insertEntriesAtIndices(currentItems: ShoppingItem[], entries: Array<{ index: number; item: ShoppingItem }>) {
  const nextItems = [...currentItems]
  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    nextItems.splice(Math.min(entry.index, nextItems.length), 0, entry.item)
  }
  return nextItems
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

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    user_id: "user-1",
    categories: ["Produce"],
    default_selection: {},
    category_overrides: {},
    custom_categories: [],
    category_order: null,
    excluded_keywords: [],
    history_exclusion_days: 10,
    week_start_day: 1,
    onboarding_completed_at: null,
    excluded_days: [],
    preferred_days: null,
    auto_assign_days: true,
    enabled_planner_categories: null,
    ...overrides,
  }
}

function renderShoppingList() {
  return render(
    <UndoToastProvider>
      <ShoppingListView />
    </UndoToastProvider>
  )
}

function resolveNextBulkMutation() {
  const resolve = bulkMutationResolvers.shift()
  if (!resolve) {
    throw new Error("No pending bulk mutation to resolve")
  }
  act(() => {
    resolve()
  })
}

function resolveNextExcludedMove() {
  const resolve = moveExcludedResolvers.shift()
  if (!resolve) {
    throw new Error("No pending excluded move to resolve")
  }
  act(() => {
    resolve()
  })
}

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean
    unoptimized?: boolean
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt || ""} {...props} />
  ),
}))

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  KeyboardSensor: function KeyboardSensor() {
    return null
  },
  MouseSensor: function MouseSensor() {
    return null
  },
  TouchSensor: function TouchSensor() {
    return null
  },
  closestCenter: {},
  useSensor: () => ({}),
  useSensors: () => [],
  useDndMonitor: () => {},
}))

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: () => ({}),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: {},
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => "",
    },
  },
}))

vi.mock("@/components/shopping/shopping-settings-modal", () => ({
  ShoppingSettingsModal: () => null,
}))

vi.mock("@/components/recipes/recipe-detail-dialog", () => ({
  RecipeDetailDialog: () => null,
}))

vi.mock("@/components/recipes/recipe-dialog", () => ({
  RecipeDialog: () => null,
}))

vi.mock("@/hooks/use-recipes", () => ({
  useRecipe: () => ({ data: null }),
  useRecipes: () => ({ data: [] }),
  useCategories: () => ({ data: ["Produce"] }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useShoppingList: () => ({
    data: useSyncExternalStore(subscribeShoppingList, () => currentShoppingList),
    isLoading: false,
    isFetching: false,
  }),
  useShoppingConfig: () => ({
    data: currentConfig,
  }),
  useUpdateShoppingConfig: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAddShoppingItem: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveShoppingItem: () => ({
    mutate: removeItemMutate,
    mutateAsync: vi.fn(async (rowId: string) => removeItemMutate(rowId)),
    isPending: false,
  }),
  useRemoveRecipeItems: () => ({
    mutate: removeRecipeItemsMutate,
    mutateAsync: vi.fn(async (recipeName: string) => removeRecipeItemsMutate(recipeName)),
    isPending: false,
  }),
  useClearShoppingList: () => ({
    mutate: clearListMutate,
    mutateAsync: vi.fn(async () => clearListMutate()),
    isPending: false,
  }),
  useCheckOffItem: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useBulkCheckOff: () => {
    const [isPending, setIsPending] = useState(false)

    return {
      isPending,
      mutate: (items: ShoppingItem[]) => {
        bulkMutationEvents.push("mutate")
        setIsPending(true)
        updateShoppingList((prev) => ({
          ...prev,
          items: prev.items.map((listItem) =>
            items.some((target) => target.rowId === listItem.rowId)
              ? { ...listItem, checked: true }
              : listItem
          ),
        }))
        bulkMutationEvents.push("optimistic")
        bulkMutationResolvers.push(() => {
          bulkMutationEvents.push("resolve")
          setIsPending(false)
        })
      },
    }
  },
  useMoveToShoppingList: () => ({
    mutate: moveToListMutate,
    isPending: false,
  }),
  useMoveExcludedToShoppingList: () => {
    return {
      isPending: false,
      mutate: moveExcludedMutate,
    }
  },
  useReorderShoppingList: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSaveCategoryOverride: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateItemCategory: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAddToPantryAndRemove: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useShoppingPendingActions: ({
    removeItemCommit,
    removeRecipeCommit,
    clearListCommit,
  }: {
    removeItemCommit: { mutateAsync: (rowId: string) => Promise<unknown> }
    removeRecipeCommit: { mutateAsync: (recipeName: string) => Promise<unknown> }
    clearListCommit: { mutateAsync: () => Promise<unknown> }
  }) => {
    const undoToast = useUndoToast()
    const [queue, setQueue] = useState<
      Array<{
        id: string
        message: string
        commit: () => Promise<unknown>
        rollback: () => void
      }>
    >([])
    const queueRef = useRef(queue)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const activeToastIdRef = useRef<string | null>(null)
    const nextIdRef = useRef(0)
    const resolvingIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
      queueRef.current = queue
    }, [queue])

    const resolveAction = useCallback(async (actionId: string, resolution: "undo" | "commit") => {
      const action = queueRef.current.find((candidate) => candidate.id === actionId)
      if (!action) return
      if (resolvingIdsRef.current.has(actionId)) return
      resolvingIdsRef.current.add(actionId)

      if (queueRef.current[0]?.id === actionId && timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      if (resolution === "undo") {
        action.rollback()
      } else {
        await action.commit()
      }

      activeToastIdRef.current = null
      setQueue((current) => current.filter((candidate) => candidate.id !== actionId))
      resolvingIdsRef.current.delete(actionId)
    }, [])

    useEffect(() => {
      const activeAction = queue[0]
      if (!activeAction) {
        activeToastIdRef.current = null
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        return
      }

      if (activeToastIdRef.current === activeAction.id) {
        return
      }

      activeToastIdRef.current = activeAction.id
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      timerRef.current = setTimeout(() => {
        void resolveAction(activeAction.id, "commit")
      }, 5000)

      undoToast.show({
        message: activeAction.message,
        duration: 5000,
        onUndo: () => {
          void resolveAction(activeAction.id, "undo")
        },
        onDismiss: () => {
          void resolveAction(activeAction.id, "commit")
        },
        onExpire: () => {
          void resolveAction(activeAction.id, "commit")
        },
      })
    }, [queue, resolveAction, undoToast])

    return {
      enqueueRemoveItem: (item: ShoppingItem) => {
        const rowId = item.rowId!
        const removed = currentShoppingList.items.flatMap((item, index) =>
          item.rowId === rowId ? [{ index, item }] : []
        )
        updateShoppingList((prev) => ({
          ...prev,
          items: prev.items.filter((candidate) => candidate.rowId !== rowId),
        }))
        if (removed.length === 0) return

        setQueue((current) => [
          ...current,
          {
            id: `remove-item-${nextIdRef.current++}`,
            message: `"${item.item}" removed from list`,
            commit: () => removeItemCommit.mutateAsync(rowId),
            rollback: () => {
              updateShoppingList((prev) => ({
                ...prev,
                items: insertEntriesAtIndices(
                  prev.items.filter((candidate) => candidate.rowId !== rowId),
                  removed
                ),
              }))
            },
          },
        ])
      },
      enqueueRemoveRecipe: (recipeName: string) => {
        const previousList = cloneList(currentShoppingList)
        updateShoppingList((prev) => ({
          ...prev,
          items: prev.items.filter(
            (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
          ),
          already_have: prev.already_have.filter(
            (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
          ),
          excluded: prev.excluded.filter(
            (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
          ),
        }))
        setQueue((current) => [
          ...current,
          {
            id: `remove-recipe-${nextIdRef.current++}`,
            message: `Items from "${recipeName}" removed`,
            commit: () => removeRecipeCommit.mutateAsync(recipeName),
            rollback: () => {
              setShoppingList(previousList)
            },
          },
        ])
      },
      enqueueClearList: () => {
        const previousList = cloneList(currentShoppingList)
        updateShoppingList((prev) => ({
          ...prev,
          items: [],
          already_have: [],
          excluded: [],
          source_recipes: [],
          scale: 1,
          total_servings: 0,
          custom_order: false,
        }))
        setQueue((current) => [
          ...current,
          {
            id: `clear-list-${nextIdRef.current++}`,
            message: "Shopping list cleared",
            commit: () => clearListCommit.mutateAsync(),
            rollback: () => {
              setShoppingList(previousList)
            },
          },
        ])
      },
      pendingActionCount: queue.length,
      projectShoppingList: (shoppingList: ShoppingList | null | undefined) => shoppingList,
    }
  },
}))

  beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  bulkMutationEvents.length = 0
  bulkMutationResolvers.length = 0
  moveExcludedResolvers.length = 0
  currentConfig = makeConfig()
  currentShoppingList = makeList()
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((message, ...args) => {
    if (typeof message === "string" && message.includes("not wrapped in act")) {
      return
    }
    originalConsoleError(message, ...args)
  })

  removeItemMutate.mockImplementation((rowId: string) => {
    updateShoppingList((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.rowId !== rowId),
    }))
  })

  removeRecipeItemsMutate.mockImplementation((recipeName: string) => {
    updateShoppingList((prev) => ({
      ...prev,
      items: prev.items.filter(
        (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
      ),
      already_have: prev.already_have.filter(
        (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
      ),
      excluded: prev.excluded.filter(
        (item) => !(item.sources || []).some((source) => source.recipeName === recipeName)
      ),
    }))
  })

  clearListMutate.mockImplementation(() => {
    updateShoppingList((prev) => ({
      ...prev,
      items: [],
      already_have: [],
      excluded: [],
      source_recipes: [],
      scale: 1,
      total_servings: 0,
      custom_order: false,
    }))
  })

  moveToListMutate.mockImplementation((item: ShoppingItem) => {
    updateShoppingList((prev) => ({
      ...prev,
      already_have: prev.already_have.filter((alreadyHaveItem) => alreadyHaveItem.rowId !== item.rowId),
      items: [...prev.items, item],
    }))
  })

  moveExcludedMutate.mockImplementation((item: ShoppingItem) => {
    updateShoppingList((prev) => ({
      ...prev,
      excluded: prev.excluded.filter((excludedItem) => excludedItem.rowId !== item.rowId),
      items: [...prev.items, item],
    }))
    moveExcludedResolvers.push(() => undefined)
  })

  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: "(min-width: 768px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  consoleErrorSpy.mockRestore()
})

describe("ShoppingListView orchestration", () => {
  it("applies bulk check-off optimistically and keeps the checked state stable after settlement", async () => {
    currentShoppingList = makeList({
      items: [makeItem("apples"), makeItem("bananas")],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Check all items in Fresh Produce" }))
    })

    expect(bulkMutationEvents).toEqual(["mutate", "optimistic"])
    expect(screen.getByText("All items checked!")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Complete Shopping" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Fresh Produce 2\/2 All/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand category" })).toBeInTheDocument()

    resolveNextBulkMutation()

    expect(bulkMutationEvents).toEqual(["mutate", "optimistic", "resolve"])
    expect(screen.getByText("All items checked!")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Fresh Produce 2\/2 All/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand category" })).toBeInTheDocument()
  })

  it("hides an item immediately, then restores it in the same category when undo is clicked", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic")],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Remove from list" }))
    })

    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
    expect(screen.queryByText("Fresh Produce")).not.toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent('"garlic" removed from list')

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    })

    expect(screen.getByText("Fresh Produce")).toBeInTheDocument()
    expect(screen.getByText("garlic")).toBeInTheDocument()
    expect(removeItemMutate).not.toHaveBeenCalled()
  })

  it("commits the deferred delete once the undo window expires", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic")],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Remove from list" }))
    })

    expect(screen.queryByText("garlic")).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(removeItemMutate).toHaveBeenCalledTimes(1)
    expect(removeItemMutate).toHaveBeenCalledWith("row-garlic")
    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
    expect(screen.queryByText("Fresh Produce")).not.toBeInTheDocument()
  })

  it("commits the visible destructive action immediately when dismiss is clicked", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic")],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Remove from list" }))
    })

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    })

    expect(removeItemMutate).toHaveBeenCalledTimes(1)
    expect(removeItemMutate).toHaveBeenCalledWith("row-garlic")
    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
  })

  it("queues later destructive actions without force-committing the earlier one", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic"), makeItem("onion")],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove from list" })[0])
    })

    expect(screen.getByRole("alert")).toHaveTextContent('"garlic" removed from list')
    expect(screen.queryByText("garlic")).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Remove from list" })[0])
    })

    expect(removeItemMutate).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent('"garlic" removed from list')
    expect(screen.queryByText("onion")).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    })

    expect(screen.getByText("garlic")).toBeInTheDocument()
    expect(screen.queryByText("onion")).not.toBeInTheDocument()
    expect(removeItemMutate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(removeItemMutate).toHaveBeenCalledTimes(1)
    expect(removeItemMutate).toHaveBeenCalledWith("row-onion")
    expect(screen.queryByText("onion")).not.toBeInTheDocument()
  })

  it("removes recipe items authoritatively and restores them on undo", async () => {
    currentShoppingList = makeList({
      items: [
        makeItem("garlic", { sources: [{ recipeName: "Stew" }] }),
        makeItem("rice", { sources: [{ recipeName: "Manual" }] }),
      ],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: 'Remove all items from Stew' })[0])
    })

    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
    expect(screen.getByText("rice")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent('Items from "Stew" removed')

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    })

    expect(removeRecipeItemsMutate).not.toHaveBeenCalled()
    expect(screen.getByText("garlic")).toBeInTheDocument()
    expect(screen.getAllByText("Stew").length).toBeGreaterThan(0)
  })

  it("clears the list optimistically and restores the full snapshot on undo", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic")],
      already_have: [makeItem("rice")],
      excluded: [makeItem("cilantro", { excludedBy: "cilantro" })],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }))
    })

    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
    expect(screen.queryByText("In Pantry")).not.toBeInTheDocument()
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    })

    expect(clearListMutate).not.toHaveBeenCalled()
    expect(screen.getByText("garlic")).toBeInTheDocument()
    expect(screen.getAllByText("In Pantry").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Excluded").length).toBeGreaterThan(0)
  })

  it("moves an excluded item back into its category immediately without duplicate rendering", async () => {
    currentShoppingList = makeList({
      items: [makeItem("apples")],
      excluded: [makeItem("cilantro", { excludedBy: "cilantro" })],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /cilantro/i }))
    })

    expect(moveExcludedMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument()
    expect(screen.getByText("Fresh Produce")).toBeInTheDocument()
    expect(screen.getAllByText("cilantro")).toHaveLength(1)

    resolveNextExcludedMove()

    expect(screen.getByText("Fresh Produce")).toBeInTheDocument()
    expect(screen.getAllByText("cilantro")).toHaveLength(1)
  })

  it("restores only the clicked duplicate from pantry and excluded sections", () => {
    currentShoppingList = makeList({
      items: [],
      already_have: [
        makeItem("milk", { rowId: "row-milk-cup", unit: "cup" }),
        makeItem("milk", { rowId: "row-milk-bottle", unit: "bottle" }),
      ],
      excluded: [
        makeItem("salt", { rowId: "row-salt-tsp", unit: "tsp", excludedBy: "salt" }),
        makeItem("salt", { rowId: "row-salt-tbsp", unit: "tbsp", excludedBy: "salt" }),
      ],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "milk" })[0])
    })
    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: /salt/i })[0])
    })

    expect(moveToListMutate).toHaveBeenCalledWith(expect.objectContaining({ rowId: "row-milk-cup" }))
    expect(moveExcludedMutate).toHaveBeenCalledWith(expect.objectContaining({ rowId: "row-salt-tsp" }))
    expect(currentShoppingList.items.map((item) => item.rowId)).toEqual([
      "row-milk-cup",
      "row-salt-tsp",
    ])
    expect(currentShoppingList.already_have.map((item) => item.rowId)).toEqual(["row-milk-bottle"])
    expect(currentShoppingList.excluded.map((item) => item.rowId)).toEqual(["row-salt-tbsp"])
  })

  it("keeps pantry and excluded sections reachable when active items are empty", async () => {
    currentShoppingList = makeList({
      items: [],
      already_have: [makeItem("rice")],
      excluded: [makeItem("cilantro", { excludedBy: "cilantro" })],
    })

    renderShoppingList()

    expect(screen.queryByText("No shopping list yet")).not.toBeInTheDocument()
    expect(screen.getAllByText("In Pantry").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Excluded").length).toBeGreaterThan(0)
  })
})
