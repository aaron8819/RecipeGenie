import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingListView } from "../shopping-list"
import { UndoToastProvider, useUndoToast } from "@/components/ui/undo-toast"
import type { ShoppingItem, ShoppingList, UserConfig } from "@/types/database"

globalThis.React = React

type ResolveFn = () => void

const shoppingListeners = new Set<() => void>()
const removeItemMutate = vi.fn<(rowId: string) => void>()
const removeRecipeItemsMutate = vi.fn<
  (recipe: { recipeId?: string; recipeName: string }) => void
>()
const clearListMutate = vi.fn<() => void>()
const moveToListMutate = vi.fn<
  (item: ShoppingItem, options?: { onSuccess?: () => void; onError?: () => void }) => void
>()
const moveExcludedMutate = vi.fn<
  (item: ShoppingItem, options?: { onSuccess?: () => void; onError?: () => void }) => void
>()
const addShoppingItemMutateAsync = vi.fn<(args: { itemName: string }) => Promise<unknown>>()
const updateShoppingItemMutateAsync = vi.fn<
  (args: { item: ShoppingItem; updates: { itemName: string; amount?: number | null; unit?: string } }) => Promise<unknown>
>()
const addToPantryAndRemoveMutate = vi.fn<
  (item: ShoppingItem, options?: { onSuccess?: (data: { wasAdded: boolean }) => void; onSettled?: () => void }) => void
>()
const bulkMutationEvents: string[] = []
const bulkMutationResolvers: ResolveFn[] = []
const moveExcludedResolvers: ResolveFn[] = []
const originalConsoleError = console.error
const routerPush = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
}))

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
    shopping_item_order: {},
    exclude_salt_variants: false,
    exclude_black_pepper_variants: false,
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
    <div
      data-home-tab-panel="shopping"
      data-testid="shopping-test-pane"
      aria-hidden="false"
      style={{ overflowY: "auto", maxHeight: "600px" }}
    >
      <UndoToastProvider>
        <ShoppingListView />
      </UndoToastProvider>
    </div>
  )
}

function expectCategoryExpanded(categoryKey: string, expanded: boolean) {
  const section = screen.getByTestId(`shopping-category-${categoryKey}`)
  const header = section.querySelector('[role="button"][aria-expanded]')
  expect(header).toHaveAttribute("aria-expanded", String(expanded))
}

function toggleCategory(categoryKey: string) {
  const section = screen.getByTestId(`shopping-category-${categoryKey}`)
  const label = section.querySelector('[role="button"][aria-expanded="true"]')
    ? "Collapse category"
    : "Expand category"
  fireEvent.click(within(section).getByRole("button", { name: label }))
}

function setMobileViewport() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 390,
  })

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width") ? true : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
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

vi.mock("@/hooks/use-recipes", () => ({
  useRecipes: () => ({ data: [] }),
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
    mutateAsync: addShoppingItemMutateAsync,
    isPending: false,
  }),
  useUpdateShoppingItem: () => ({
    mutateAsync: updateShoppingItemMutateAsync,
    isPending: false,
  }),
  useRemoveShoppingItem: () => ({
    mutate: removeItemMutate,
    mutateAsync: vi.fn(async (rowId: string) => removeItemMutate(rowId)),
    isPending: false,
  }),
  useRemoveRecipeItems: () => ({
    mutate: removeRecipeItemsMutate,
    mutateAsync: vi.fn(async (recipe: { recipeId?: string; recipeName: string }) =>
      removeRecipeItemsMutate(recipe)
    ),
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
    mutate: addToPantryAndRemoveMutate,
    isPending: false,
  }),
  useShoppingPendingActions: ({
    removeItemCommit,
    removeRecipeCommit,
    clearListCommit,
  }: {
    removeItemCommit: { mutateAsync: (rowId: string) => Promise<unknown> }
    removeRecipeCommit: {
      mutateAsync: (recipe: { recipeId?: string; recipeName: string }) => Promise<unknown>
    }
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
      enqueueRemoveRecipe: (recipe: { recipeId?: string; recipeName: string }) => {
        setQueue((current) => [
          ...current,
          {
            id: `remove-recipe-${nextIdRef.current++}`,
            message: `Items from "${recipe.recipeName}" removed`,
            commit: () => removeRecipeCommit.mutateAsync(recipe),
            rollback: () => undefined,
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
    const renderedMessage = [message, ...args]
      .map((part) => {
        if (typeof part === "string") return part
        if (part instanceof Error) return part.message
        try {
          return String(part)
        } catch {
          return ""
        }
      })
      .join(" ")

    if (
      renderedMessage.includes("not wrapped in act") ||
      renderedMessage.includes("Warning: An update to")
    ) {
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

  removeRecipeItemsMutate.mockImplementation((recipe) => {
    const recipeName = recipe.recipeName
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

  moveToListMutate.mockImplementation((item: ShoppingItem, options) => {
    updateShoppingList((prev) => ({
      ...prev,
      already_have: prev.already_have.filter((alreadyHaveItem) => alreadyHaveItem.rowId !== item.rowId),
      items: [...prev.items, item],
    }))
    options?.onSuccess?.()
  })

  moveExcludedMutate.mockImplementation((item: ShoppingItem, options) => {
    updateShoppingList((prev) => ({
      ...prev,
      excluded: prev.excluded.filter((excludedItem) => excludedItem.rowId !== item.rowId),
      items: [...prev.items, item],
    }))
    options?.onSuccess?.()
    moveExcludedResolvers.push(() => undefined)
  })

  addToPantryAndRemoveMutate.mockImplementation((item: ShoppingItem, options) => {
    updateShoppingList((prev) => ({
      ...prev,
      items: prev.items.filter((shoppingItem) => shoppingItem.rowId !== item.rowId),
      already_have: [...prev.already_have, item],
    }))
    options?.onSuccess?.({ wasAdded: true })
    options?.onSettled?.()
  })
  addShoppingItemMutateAsync.mockResolvedValue({ rowId: "row-new-item" })
  updateShoppingItemMutateAsync.mockImplementation(async ({ item, updates }) => {
    updateShoppingList((prev) => ({
      ...prev,
      items: prev.items.map((candidate) =>
        candidate.rowId === item.rowId
          ? {
              ...candidate,
              item: updates.itemName.toLowerCase().trim(),
              amount: updates.amount ?? null,
              unit: updates.unit || "",
            }
          : candidate
      ),
    }))
    return { rowId: item.rowId }
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
  act(() => {
    vi.runOnlyPendingTimers()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
  consoleErrorSpy.mockRestore()
})

describe("ShoppingListView orchestration", () => {
  it("uses identical content-derived defaults on desktop and mobile, including more than three active categories", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { rowId: "row-apples", categoryKey: "produce" }),
        makeItem("ham", { rowId: "row-ham", categoryKey: "deli" }),
        makeItem("bread", { rowId: "row-bread", categoryKey: "bakery" }),
        makeItem("chicken", { rowId: "row-chicken", categoryKey: "protein" }),
        makeItem("milk", { rowId: "row-milk", categoryKey: "dairy" }),
        makeItem("completed", { rowId: "row-completed", categoryKey: "pantry", checked: true }),
      ],
    })

    const desktop = renderShoppingList()
    for (const key of ["produce", "deli", "bakery", "protein", "dairy"]) {
      expectCategoryExpanded(key, true)
    }
    expectCategoryExpanded("pantry", false)
    desktop.unmount()

    setMobileViewport()
    renderShoppingList()
    for (const key of ["produce", "deli", "bakery", "protein", "dairy"]) {
      expectCategoryExpanded(key, true)
    }
    expectCategoryExpanded("pantry", false)
  })

  it("preserves manual intent across tab visibility, rerenders, category reordering, and unrelated changes", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { rowId: "row-apples", categoryKey: "produce" }),
        makeItem("milk", { rowId: "row-milk", categoryKey: "dairy" }),
      ],
    })
    currentConfig = makeConfig({ category_order: ["produce", "dairy"] })

    const view = renderShoppingList()
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)

    act(() => {
      currentConfig = makeConfig({ category_order: ["dairy", "produce"] })
      updateShoppingList((list) => ({ ...list, items: [list.items[1], list.items[0]] }))
    })
    view.rerender(
      <div data-home-tab-panel="shopping" data-testid="shopping-test-pane" aria-hidden="true">
        <UndoToastProvider><ShoppingListView /></UndoToastProvider>
      </div>
    )
    view.rerender(
      <div data-home-tab-panel="shopping" data-testid="shopping-test-pane" aria-hidden="false">
        <UndoToastProvider><ShoppingListView /></UndoToastProvider>
      </div>
    )

    expectCategoryExpanded("produce", false)
    act(() => {
      updateShoppingList((list) => ({
        ...list,
        items: list.items.filter((candidate) => candidate.rowId !== "row-milk"),
      }))
    })
    expectCategoryExpanded("produce", false)
  })

  it("reopens a manually collapsed category when a new unchecked row enters", () => {
    currentShoppingList = makeList({ items: [makeItem("apples", { rowId: "row-apples" })] })
    renderShoppingList()
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)

    act(() => {
      updateShoppingList((list) => ({
        ...list,
        items: [...list.items, makeItem("carrots", { rowId: "row-carrots" })],
      }))
    })

    expectCategoryExpanded("produce", true)
    expect(screen.getByText("carrots")).toBeInTheDocument()
  })

  it("reopens on uncheck, collapses on final completion, then honors a manual reopen", () => {
    const completed = makeItem("apples", { rowId: "row-apples", checked: true })
    currentShoppingList = makeList({ items: [completed] })
    renderShoppingList()
    expectCategoryExpanded("produce", false)

    toggleCategory("produce")
    expectCategoryExpanded("produce", true)
    act(() => {
      updateShoppingList((list) => ({
        ...list,
        items: list.items.map((candidate) => ({ ...candidate, checked: false })),
      }))
    })
    expectCategoryExpanded("produce", true)

    act(() => {
      updateShoppingList((list) => ({
        ...list,
        items: list.items.map((candidate) => ({ ...candidate, checked: true })),
      }))
    })
    expectCategoryExpanded("produce", false)

    toggleCategory("produce")
    expectCategoryExpanded("produce", true)
    act(() => updateShoppingList((list) => ({ ...list })))
    expectCategoryExpanded("produce", true)
  })

  it("deletes intent when a category empties and recomputes defaults after undo or repopulation", () => {
    currentShoppingList = makeList({ items: [makeItem("apples", { rowId: "row-apples" })] })
    renderShoppingList()
    toggleCategory("produce")

    act(() => setShoppingList(makeList()))
    expect(screen.queryByTestId("shopping-category-produce")).not.toBeInTheDocument()

    act(() => setShoppingList(makeList({ items: [makeItem("apples", { rowId: "row-apples" })] })))
    expectCategoryExpanded("produce", true)
  })

  it("supports custom category defaults and keeps intent while switching Shop and Manage modes", () => {
    currentConfig = makeConfig({
      custom_categories: [{ id: "farmers-market", name: "Farmers Market", order: 10 }],
    })
    currentShoppingList = makeList({
      items: [makeItem("local honey", { rowId: "row-honey", categoryKey: "custom_farmers-market" })],
    })
    renderShoppingList()
    expectCategoryExpanded("custom_farmers-market", true)
    toggleCategory("custom_farmers-market")

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Organize" })[1])
    fireEvent.click(screen.getByRole("menuitem", { name: "Enter Manage Mode" }))
    expectCategoryExpanded("custom_farmers-market", false)

    fireEvent.pointerDown(screen.getAllByRole("button", { name: "Organize" })[1])
    fireEvent.click(screen.getByRole("menuitem", { name: "Exit Manage Mode" }))
    expectCategoryExpanded("custom_farmers-market", false)
  })

  it("resets intent on remount", () => {
    currentShoppingList = makeList({ items: [makeItem("apples", { rowId: "row-apples" })] })
    const first = renderShoppingList()
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)
    first.unmount()

    renderShoppingList()
    expectCategoryExpanded("produce", true)
  })

  it("reveals quick mobile pantry correction actions with a swipe and restores the same row", () => {
    setMobileViewport()
    currentShoppingList = makeList({
      items: [makeItem("garlic", { rowId: "row-garlic-clove" })],
    })

    renderShoppingList()

    const row = screen.getByTestId("shopping-row-row-garlic-clove")

    act(() => {
      fireEvent.touchStart(row, {
        touches: [{ clientX: 280, clientY: 40 }],
      })
      fireEvent.touchMove(row, {
        touches: [{ clientX: 160, clientY: 42 }],
      })
      fireEvent.touchEnd(row)
    })

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Quick add to pantry" }))
    })

    expect(addToPantryAndRemoveMutate).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "row-garlic-clove" }),
      expect.any(Object)
    )
    expect(currentShoppingList.items.map((item) => item.rowId)).toEqual([])
    expect(currentShoppingList.already_have.map((item) => item.rowId)).toEqual(["row-garlic-clove"])
    expect(screen.getAllByText("In Pantry").length).toBeGreaterThan(0)
    expect(screen.getByRole("alert")).toHaveTextContent('Moved "garlic" to pantry')
  })

  it("starts in shopping mode and only reveals reorder controls after entering manage mode", async () => {
    currentShoppingList = makeList({
      items: [makeItem("apples"), makeItem("bananas")],
    })

    renderShoppingList()

    expect(screen.queryByRole("button", { name: "Drag to reorder" })).not.toBeInTheDocument()
    expect(screen.queryByText("Manage Mode")).not.toBeInTheDocument()

    act(() => {
      fireEvent.pointerDown(screen.getAllByRole("button", { name: "Organize" })[1])
    })
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Enter Manage Mode" }))
    })

    expect(screen.getByText("Manage Mode")).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Drag to reorder" }).length).toBeGreaterThan(0)

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Done" }))
    })

    expect(screen.queryByText("Manage Mode")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Drag to reorder" })).not.toBeInTheDocument()
  })

  it("collapses recipe context by default so the shopping rows stay near the top", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { sources: [{ recipeName: "Stew" }] }),
        makeItem("rice", { rowId: "row-rice", categoryKey: "pantry", categoryOrder: 6, sources: [{ recipeName: "Curry" }] }),
      ],
    })

    renderShoppingList()

    expect(screen.getByText("Recipes in list")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove all items from Stew" })).not.toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show recipes in list" }))
    })

    expect(screen.getByRole("button", { name: "Remove all items from Stew" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Hide recipes in list" })).toBeInTheDocument()
  })

  it("keeps completed categories below active ones in shopping mode", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { checked: false, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("milk", { rowId: "row-milk", checked: true, categoryKey: "dairy", categoryOrder: 5 }),
      ],
    })

    renderShoppingList()

    const categoryTitles = screen
      .getAllByText(/Fresh Produce|Dairy/i)
      .map((node) => node.textContent)

    expect(categoryTitles[0]).toMatch(/Fresh Produce/i)
    expect(categoryTitles[1]).toMatch(/Dairy/i)
  })

  it("keeps checked rows at the bottom of a category in shopping mode without entering manage mode", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { rowId: "row-apples", checked: true, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("bananas", { rowId: "row-bananas", checked: false, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("carrots", { rowId: "row-carrots", checked: false, categoryKey: "produce", categoryOrder: 1 }),
      ],
    })

    renderShoppingList()

    const rows = screen.getAllByTestId("shopping-item-row")
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("bananas"),
      expect.stringContaining("carrots"),
      expect.stringContaining("apples"),
    ])
  })

  it("hides completed rows and fully completed sections behind a single shopping-mode toggle", () => {
    currentShoppingList = makeList({
      items: [
        makeItem("apples", { rowId: "row-apples", checked: false, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("bananas", { rowId: "row-bananas", checked: true, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("milk", { rowId: "row-milk", checked: true, categoryKey: "dairy", categoryOrder: 5 }),
      ],
    })

    renderShoppingList()

    expect(screen.getByText("67% done")).toBeInTheDocument()
    expect(screen.getByText("bananas")).toBeInTheDocument()
    expect(screen.getByText(/Dairy/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Hide 2 done" }))

    expect(screen.queryByText("bananas")).not.toBeInTheDocument()
    expect(screen.queryByText(/Dairy/i)).not.toBeInTheDocument()
    expect(screen.getByText("1 done")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Show 2 done" })).toBeInTheDocument()
  })

  it("uses progress jump chips to reopen a collapsed active category and scroll the active pane", () => {
    setMobileViewport()
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      callback(0)
      return 0
    }))

    currentShoppingList = makeList({
      items: [
        makeItem("apples", { rowId: "row-apples", checked: false, categoryKey: "produce", categoryOrder: 1 }),
        makeItem("rice", { rowId: "row-rice", checked: false, categoryKey: "pantry", categoryOrder: 6 }),
      ],
    })

    renderShoppingList()

    const pane = screen.getByTestId("shopping-test-pane")
    const scrollTo = vi.fn(({ top }: ScrollToOptions) => {
      Object.defineProperty(pane, "scrollTop", {
        configurable: true,
        writable: true,
        value: top ?? 0,
      })
    })

    Object.defineProperty(pane, "clientHeight", {
      configurable: true,
      value: 600,
    })
    Object.defineProperty(pane, "scrollHeight", {
      configurable: true,
      value: 1600,
    })
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      writable: true,
      value: 80,
    })
    Object.defineProperty(pane, "scrollTo", {
      configurable: true,
      value: scrollTo,
    })
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 20,
      width: 390,
      height: 600,
      top: 20,
      right: 390,
      bottom: 620,
      left: 0,
      toJSON: () => ({}),
    })

    const pantrySection = screen.getByTestId("shopping-category-pantry")
    vi.spyOn(pantrySection, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 620,
      width: 390,
      height: 180,
      top: 620,
      right: 390,
      bottom: 800,
      left: 0,
      toJSON: () => ({}),
    })

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse category" })[1])
    expect(screen.queryByText("rice")).not.toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole("button", { name: "Jump to shopping section" }))
    fireEvent.click(screen.getByRole("menuitem", { name: /Pantry/i }))

    expect(screen.getByText("rice")).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith({ top: 584, behavior: "auto" })
  })

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
    expect(screen.getByText("0 left")).toBeInTheDocument()
    expect(screen.getByText("2 done")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand category" })).toBeInTheDocument()

    resolveNextBulkMutation()

    expect(bulkMutationEvents).toEqual(["mutate", "optimistic", "resolve"])
    expect(screen.getByText("All items checked!")).toBeInTheDocument()
    expect(screen.getByText("0 left")).toBeInTheDocument()
    expect(screen.getByText("2 done")).toBeInTheDocument()
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
        makeItem("garlic", { sources: [{
          recipeId: "11111111-1111-4111-8111-111111111111",
          recipeName: "Stew",
        }] }),
        makeItem("rice", { sources: [{ recipeName: "Manual" }] }),
      ],
    })

    renderShoppingList()

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Show recipes in list" }))
    })

    act(() => {
      fireEvent.click(screen.getAllByRole("button", { name: 'Remove all items from Stew' })[0])
    })

    expect(screen.getByText("garlic")).toBeInTheDocument()
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
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)

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
    expectCategoryExpanded("produce", true)
    expect(screen.getAllByText("In Pantry").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Excluded").length).toBeGreaterThan(0)
  })

  it("moves an excluded item back into its category immediately without duplicate rendering", async () => {
    currentShoppingList = makeList({
      items: [makeItem("apples")],
      excluded: [
        makeItem("cilantro", {
          amount: 2,
          unit: "bunches",
          excludedBy: "cilantro",
          sources: [{ recipeName: "Taco Night" }],
        }),
      ],
    })

    renderShoppingList()
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Restore cilantro 2 bunches Excluded: cilantro" }))
    })

    expect(moveExcludedMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Excluded")).not.toBeInTheDocument()
    expect(screen.getByText("Fresh Produce")).toBeInTheDocument()
    expectCategoryExpanded("produce", true)
    expect(screen.getAllByText("cilantro")).toHaveLength(1)
    expect(screen.getByRole("alert")).toHaveTextContent('Restored "cilantro" to shopping list')

    resolveNextExcludedMove()

    expect(screen.getByText("Fresh Produce")).toBeInTheDocument()
    expect(screen.getAllByText("cilantro")).toHaveLength(1)
  })

  it("restores only the clicked duplicate from pantry and excluded sections", () => {
    currentShoppingList = makeList({
      items: [makeItem("apples", { rowId: "row-apples" })],
      already_have: [
        makeItem("milk", { rowId: "row-milk-cup", amount: 1, unit: "cup", sources: [{ recipeName: "Cereal" }] }),
        makeItem("milk", { rowId: "row-milk-bottle", amount: 1, unit: "bottle", sources: [{ recipeName: "Coffee" }] }),
      ],
      excluded: [
        makeItem("salt", { rowId: "row-salt-tsp", amount: 1, unit: "tsp", excludedBy: "salt", sources: [{ recipeName: "Soup" }] }),
        makeItem("salt", { rowId: "row-salt-tbsp", amount: 1, unit: "tbsp", excludedBy: "salt", sources: [{ recipeName: "Stew" }] }),
      ],
    })

    renderShoppingList()
    toggleCategory("produce")
    expectCategoryExpanded("produce", false)

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Restore milk 1 cup In pantry" }))
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Restore salt 1 tsp Excluded: salt" }))
    })

    expect(moveToListMutate).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "row-milk-cup" }),
      expect.any(Object)
    )
    expect(moveExcludedMutate).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: "row-salt-tsp" }),
      expect.any(Object)
    )
    expectCategoryExpanded("produce", true)
    expect(currentShoppingList.items.map((item) => item.rowId)).toEqual([
      "row-apples",
      "row-milk-cup",
      "row-salt-tsp",
    ])
    expect(currentShoppingList.already_have.map((item) => item.rowId)).toEqual(["row-milk-bottle"])
    expect(currentShoppingList.excluded.map((item) => item.rowId)).toEqual(["row-salt-tbsp"])
  })

  it("keeps pantry and excluded sections reachable when active items are empty", async () => {
    currentShoppingList = makeList({
      items: [],
      already_have: [makeItem("rice", { amount: 2, unit: "cups", sources: [{ recipeName: "Bowl" }] })],
      excluded: [makeItem("cilantro", { amount: 1, unit: "bunch", excludedBy: "cilantro", sources: [{ recipeName: "Tacos" }] })],
    })

    renderShoppingList()

    expect(screen.queryByText("No shopping list yet")).not.toBeInTheDocument()
    expect(screen.getAllByText("In Pantry").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Excluded").length).toBeGreaterThan(0)
    expect(screen.getAllByText("2 cups").length).toBeGreaterThan(0)
    expect(screen.getByText("Excluded: cilantro")).toBeInTheDocument()
  })

  it("gives the empty shopping state clear next steps", () => {
    currentShoppingList = makeList()

    renderShoppingList()

    expect(screen.getByText("Your shopping list is clear")).toBeInTheDocument()
    expect(screen.getByText("Add item")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Browse Recipes" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Browse Recipes" }))

    expect(window.localStorage.getItem("recipe-genie-active-tab")).toBe("recipes")
  })

  it("shows inline add feedback when some manual items are duplicates", async () => {
    currentShoppingList = makeList({
      items: [makeItem("milk")],
    })

    addShoppingItemMutateAsync.mockImplementation(async ({ itemName }: { itemName: string }) => {
      if (itemName.toLowerCase() === "milk") {
        throw new Error("Item already in shopping list")
      }

      updateShoppingList((prev) => ({
        ...prev,
        items: [...prev.items, makeItem(itemName.toLowerCase(), { rowId: `row-${itemName.toLowerCase()}` })],
      }))
      return { rowId: `row-${itemName.toLowerCase()}` }
    })

    renderShoppingList()

    fireEvent.change(screen.getByPlaceholderText(/add tomatoes, milk/i), {
      target: { value: "milk, eggs" },
    })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText(/add tomatoes, milk/i).closest("form")!)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText("eggs")).toBeInTheDocument()
    expect(screen.queryByText(
      'Added "eggs" to shopping list; "milk" was already on the shopping list'
    )).not.toBeInTheDocument()
  })

  it("edits a manual item inline without removing and re-adding it", async () => {
    currentShoppingList = makeList({
      items: [makeItem("garlic", { rowId: "row-garlic", amount: 1, unit: "" })],
    })

    renderShoppingList()

    fireEvent.click(screen.getByRole("button", { name: "Edit item" }))
    expect(screen.getByText("Edit manual item")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Manual item name"), {
      target: { value: "shallots" },
    })
    fireEvent.change(screen.getByLabelText("Manual item amount"), {
      target: { value: "1/2" },
    })
    fireEvent.change(screen.getByLabelText("Manual item unit"), {
      target: { value: "lb" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await Promise.resolve()
    })

    expect(updateShoppingItemMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.objectContaining({ rowId: "row-garlic" }),
        updates: {
          itemName: "shallots",
          amount: 0.5,
          unit: "lb",
        },
      })
    )
    expect(screen.queryByText("Edit manual item")).not.toBeInTheDocument()
    const updatedRow = screen.getByText("shallots").closest("li")
    expect(updatedRow).not.toBeNull()
    expect(updatedRow).toHaveTextContent(/(1\/2|½)\s*lb/i)
  })

  it("keeps manual edits inline when the rename would create a duplicate", async () => {
    currentShoppingList = makeList({
      items: [
        makeItem("garlic", { rowId: "row-garlic", amount: 1 }),
        makeItem("milk", { rowId: "row-milk", amount: 1 }),
      ],
    })

    updateShoppingItemMutateAsync.mockRejectedValueOnce(new Error("Item already in shopping list"))

    renderShoppingList()

    fireEvent.click(screen.getAllByRole("button", { name: "Edit item" })[0])
    fireEvent.change(screen.getByLabelText("Manual item name"), {
      target: { value: "milk" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
      await Promise.resolve()
    })

    const editor = screen.getByText("Edit manual item").closest("form")
    expect(editor).not.toBeNull()
    expect(within(editor as HTMLFormElement).getByRole("alert")).toHaveTextContent(
      '"milk" is already on the shopping list.'
    )
    expect(screen.getByText("Edit manual item")).toBeInTheDocument()
    expect(screen.getByText("garlic")).toBeInTheDocument()
  })
})
