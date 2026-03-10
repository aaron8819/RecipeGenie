import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MealPlanner } from "../meal-planner"
import { getWeekStartDate } from "../meal-planner.utils"
import type { Recipe, UserConfig, WeeklyPlan } from "@/types/database"

globalThis.React = React

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const generatePlanMutateAsync = vi.fn()
const swapRecipeMutateAsync = vi.fn()
const markRecipeMadeMutateAsync = vi.fn()
const markRecipeMadeMutate = vi.fn()
const addToShoppingListMutateAsync = vi.fn()
const undoToastShow = vi.fn()
const removeFromPlanMutate = vi.fn()
const addRecipeToPlanMutate = vi.fn()

let currentWeeklyPlan: WeeklyPlan
let currentUserConfig: UserConfig
let currentRecipes: Recipe[]
let currentWeeklyPlanRecipes: Recipe[]
let currentShoppingSourceRecipes: string[]

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
  PointerSensor: function PointerSensor() {
    return null
  },
  closestCenter: {},
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({
    setNodeRef: () => {},
    isOver: false,
  }),
  useSensor: () => ({}),
  useSensors: () => [],
}))

vi.mock("@dnd-kit/modifiers", () => ({
  snapCenterToCursor: () => null,
}))

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Translate: {
      toString: () => "",
    },
  },
}))

vi.mock("@/hooks/use-planner", () => ({
  useWeeklyPlan: () => ({
    data: currentWeeklyPlan,
    isLoading: false,
  }),
  useWeeklyPlanRecipes: () => ({
    data: currentWeeklyPlanRecipes,
  }),
  useUserConfig: () => ({
    data: currentUserConfig,
  }),
  useUpdateUserConfig: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useGenerateMealPlan: () => ({
    mutateAsync: generatePlanMutateAsync,
    isPending: false,
  }),
  useFetchRecipeIds: () => ({
    mutateAsync: vi.fn(),
  }),
  useSwapRecipe: () => ({
    mutateAsync: swapRecipeMutateAsync,
    isPending: false,
  }),
  useMarkRecipeMade: () => ({
    mutateAsync: markRecipeMadeMutateAsync,
    mutate: markRecipeMadeMutate,
    isPending: false,
  }),
  useRemoveRecipeFromPlan: () => ({
    mutate: removeFromPlanMutate,
    isPending: false,
  }),
  useAddRecipeToPlan: () => ({
    mutate: addRecipeToPlanMutate,
    isPending: false,
  }),
  useRecentRecipeHistory: () => ({
    data: [],
  }),
  useRecipeHistoryStats: () => ({
    data: [],
  }),
  useSaveDayAssignments: () => ({
    mutate: vi.fn(),
  }),
  usePlannerCategories: () => ["Dinner"],
  useSaveWeeklyPlan: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useAddToShoppingList: () => ({
    mutateAsync: addToShoppingListMutateAsync,
    isPending: false,
  }),
  useShoppingList: () => ({
    data: {
      source_recipes: currentShoppingSourceRecipes,
    },
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/hooks/use-recipes", () => ({
  useCategories: () => ({
    data: ["Dinner"],
  }),
  useToggleFavorite: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRecipes: () => ({
    data: currentRecipes,
  }),
}))

vi.mock("@/components/recipes/recipe-detail-dialog", () => ({
  RecipeDetailDialog: () => null,
}))

vi.mock("@/components/recipes/recipe-dialog", () => ({
  RecipeDialog: () => null,
}))

vi.mock("../add-recipe-to-plan-modal", () => ({
  AddRecipeToPlanModal: () => null,
}))

vi.mock("../plan-settings-modal", () => ({
  PlanSettingsModal: () => null,
}))

vi.mock("../load-template-dialog", () => ({
  LoadTemplateDialog: () => null,
}))

vi.mock("../save-template-dialog", () => ({
  SaveTemplateDialog: () => null,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: () => <span>Select value</span>,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
  }) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/calendar", () => ({
  Calendar: () => <div>Calendar</div>,
}))

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string
    description: string
    action?: { label: string; onClick: () => void }
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {action ? <button type="button" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  ),
}))

vi.mock("../meal-planner-components", () => ({
  PlannerActionBar: ({
    leading,
    children,
  }: {
    leading?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      {leading}
      {children}
    </div>
  ),
  PlannerDaySection: React.forwardRef<HTMLElement, {
    children: React.ReactNode
    header?: React.ReactNode
  }>(function MockPlannerDaySection({ children, header }, ref) {
    return (
      <section ref={ref}>
        {header}
        {children}
      </section>
    )
  }),
  PlannerDesktopWeekShell: ({
    children,
    onPrevious,
    onNext,
  }: {
    children: React.ReactNode
    onPrevious?: () => void
    onNext?: () => void
  }) => (
    <div>
      <button type="button" onClick={onPrevious}>
        Previous week
      </button>
      <button type="button" onClick={onNext}>
        Next week
      </button>
      {children}
    </div>
  ),
  PlannerDayAddButton: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel}>
      Add Meal
    </button>
  ),
  PlannerEmptyWeekPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PlannerMobileHeader: ({
    weekLabel,
    controls,
  }: {
    weekLabel?: string
    controls?: React.ReactNode
  }) => (
    <div>
      <h2>{weekLabel}</h2>
      {controls}
    </div>
  ),
  PlannerMobileTabBar: ({
    tabs,
  }: {
    tabs: Array<{ key: string; label: string; onClick: () => void }>
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.key} type="button" onClick={tab.onClick}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
  PlannerSectionShell: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) => (
    <section>
      {header}
      {children}
    </section>
  ),
}))

function recipeFixture(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Planner Recipe",
    category: "Dinner",
    servings: 4,
    ingredients: [],
    instructions: [],
    tags: null,
    image_url: null,
    favorite: false,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function weeklyPlanFixture(overrides: Partial<WeeklyPlan> = {}): WeeklyPlan {
  return {
    user_id: "user-1",
    week_date: getWeekStartDate(new Date(), 1),
    recipe_ids: [],
    made_recipe_ids: [],
    day_assignments: null,
    scale: 1,
    generated_at: null,
    ...overrides,
  }
}

function userConfigFixture(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    user_id: "user-1",
    week_start_day: 1,
    categories: null,
    category_order: null,
    default_selection: { Dinner: 1 },
    enabled_planner_categories: null,
    history_exclusion_days: 14,
    excluded_days: [],
    excluded_keywords: [],
    onboarding_completed_at: null,
    preferred_days: [],
    auto_assign_days: false,
    category_overrides: {},
    custom_categories: [],
    ...overrides,
  }
}

function setDesktopMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(min-width: 1024px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe("MealPlanner interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setDesktopMatchMedia(true)

    currentWeeklyPlan = weeklyPlanFixture({
      recipe_ids: ["recipe-1"],
      day_assignments: {
        "recipe-1": 1,
      },
    })
    currentUserConfig = userConfigFixture()
    currentRecipes = [recipeFixture()]
    currentWeeklyPlanRecipes = [recipeFixture()]
    currentShoppingSourceRecipes = []
  })

  it("keeps regenerate confirmation in context on failure and closes it only after a confirmed retry success", async () => {
    generatePlanMutateAsync
      .mockRejectedValueOnce(new Error("Planner offline"))
      .mockResolvedValueOnce(undefined)

    render(<MealPlanner />)

    fireEvent.click(screen.getByRole("button", { name: "Generate Plan" }))
    fireEvent.click(screen.getByRole("button", { name: "Generate New Plan" }))

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert")
      expect(alerts[0]).toHaveTextContent("Planner offline")
      expect(alerts[1]).toHaveTextContent("Planner offline")
    })

    expect(screen.getByText("Replace existing plan?")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Generate New Plan" }))

    await waitFor(() => {
      expect(generatePlanMutateAsync).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(screen.queryByText("Replace existing plan?")).not.toBeInTheDocument()
    })
  })

  it("waits for mark-made success before showing undo feedback and disables the active control while pending", async () => {
    const pendingMark = deferred<unknown>()
    markRecipeMadeMutateAsync.mockReturnValueOnce(pendingMark.promise)

    render(<MealPlanner />)

    const markButton = screen.getByTitle("Mark as cooked")
    fireEvent.click(markButton)

    await waitFor(() => {
      expect(screen.getByTitle("Mark as cooked")).toBeDisabled()
    })

    expect(undoToastShow).not.toHaveBeenCalled()

    await act(async () => {
      pendingMark.resolve(undefined)
      await pendingMark.promise
    })

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '"Planner Recipe" marked as made',
          onUndo: expect.any(Function),
        })
      )
    })
  })

  it("surfaces swap failures to the user and clears the pending state after the request settles", async () => {
    const pendingSwap = deferred<unknown>()
    swapRecipeMutateAsync.mockReturnValueOnce(pendingSwap.promise)

    render(<MealPlanner />)

    fireEvent.click(screen.getByTitle("Swap recipe"))

    await waitFor(() => {
      expect(screen.getByTitle("Swap recipe")).toBeDisabled()
    })

    await act(async () => {
      pendingSwap.reject(new Error("No more Dinner recipes available"))
      try {
        await pendingSwap.promise
      } catch {}
    })

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'No more Dinner recipes available',
        duration: 4000,
      })
    })

    expect(screen.getByTitle("Swap recipe")).toBeEnabled()
  })

  it("shows remove undo only after confirmed success", async () => {
    let pendingCallbacks:
      | {
          onSuccess?: () => void
          onSettled?: () => void
        }
      | undefined

    removeFromPlanMutate.mockImplementation((_variables, callbacks) => {
      pendingCallbacks = callbacks
    })

    render(<MealPlanner />)

    fireEvent.click(screen.getByTitle("Remove"))

    expect(undoToastShow).not.toHaveBeenCalled()

    act(() => {
      pendingCallbacks?.onSuccess?.()
      pendingCallbacks?.onSettled?.()
    })

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '"Planner Recipe" removed from plan',
          onUndo: expect.any(Function),
        })
      )
    })
  })

  it("shows when a planned recipe is already in Shopping and explains that re-adding will merge updates", () => {
    currentShoppingSourceRecipes = ["recipe-1"]

    render(<MealPlanner />)

    expect(screen.getAllByText("In shopping").length).toBeGreaterThan(0)
    expect(
      screen.getByText("All planned recipes are already in Shopping. Re-adding merges any ingredient changes.")
    ).toBeInTheDocument()
    expect(
      screen.getByText("Shopping rows keep recipe source labels, so you can trace each item back to this plan.")
    ).toBeInTheDocument()
  })

  it("keeps the bulk shopping action in its neutral state when nothing new is added", async () => {
    addToShoppingListMutateAsync.mockResolvedValueOnce({
      added: 0,
      merged: 2,
    })

    render(<MealPlanner />)

    const cartButton = screen.getByRole("button", { name: "Add planned meal ingredients to Shopping" })
    fireEvent.click(cartButton)

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: "Merged 2 shopping items with items already on the shopping list",
        duration: 4000,
      })
    })

    expect(screen.getByRole("button", { name: "Add planned meal ingredients to Shopping" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Plan Added" })).not.toBeInTheDocument()
  })

  it("offers a direct route to Recipes when the planner is empty", () => {
    currentRecipes = []
    currentWeeklyPlan = weeklyPlanFixture()
    currentWeeklyPlanRecipes = []

    render(<MealPlanner />)

    fireEvent.click(screen.getByRole("button", { name: "Go to Recipes" }))

    expect(window.localStorage.getItem("recipe-genie-active-tab")).toBe("recipes")
  })

  it("disables repeat taps on the mobile card action and returns to a neutral state when nothing new is added", async () => {
    setDesktopMatchMedia(false)
    const pendingAdd = deferred<{ added: number; merged: number }>()
    addToShoppingListMutateAsync.mockReturnValueOnce(pendingAdd.promise)

    render(<MealPlanner />)

    const addToCartButton = screen.getByRole("button", { name: "Add Planner Recipe ingredients to Shopping" })
    fireEvent.click(addToCartButton)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Planner Recipe ingredients to Shopping" })).toBeDisabled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Add Planner Recipe ingredients to Shopping" }))
    expect(addToShoppingListMutateAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingAdd.resolve({
        added: 0,
        merged: 2,
      })
      await pendingAdd.promise
    })

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'Merged 2 shopping items from "Planner Recipe" with items already on the shopping list',
        duration: 4000,
      })
    })

    expect(screen.getByRole("button", { name: "Add Planner Recipe ingredients to Shopping" })).toBeEnabled()
  })
})
