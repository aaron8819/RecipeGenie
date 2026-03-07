import React, { useSyncExternalStore, useState } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ShoppingListView } from "../shopping-list"
import { UndoToastProvider } from "@/components/ui/undo-toast"
import type { ShoppingItem, ShoppingList, UserConfig } from "@/types/database"

globalThis.React = React

type ResolveFn = () => void

const shoppingListeners = new Set<() => void>()
const removeItemMutate = vi.fn<(itemName: string) => void>()
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

function makeItem(item: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
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
    isPending: false,
  }),
  useRemoveRecipeItems: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useClearShoppingList: () => ({
    mutate: vi.fn(),
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
            items.some((target) => target.item === listItem.item && target.unit === listItem.unit)
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
    mutate: vi.fn(),
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

  removeItemMutate.mockImplementation((itemName: string) => {
    updateShoppingList((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.item !== itemName),
    }))
  })

  moveExcludedMutate.mockImplementation((item: ShoppingItem) => {
    updateShoppingList((prev) => ({
      ...prev,
      excluded: prev.excluded.filter((excludedItem) => excludedItem.item !== item.item),
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
    expect(removeItemMutate).toHaveBeenCalledWith("garlic")
    expect(screen.queryByText("garlic")).not.toBeInTheDocument()
    expect(screen.queryByText("Fresh Produce")).not.toBeInTheDocument()
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
})
