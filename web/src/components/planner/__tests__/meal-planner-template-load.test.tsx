import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MealPlanner } from "../meal-planner"
import { getWeekStartDate } from "../meal-planner.utils"
import type { PlanTemplate, Recipe, UserConfig, WeeklyPlan } from "@/types/database"

globalThis.React = React

const fetchRecipeIdsMutateAsync = vi.fn<() => Promise<string[]>>()
const saveWeeklyPlanMutateAsync = vi.fn<
  (args: { weekDate: string; recipeIds: string[]; dayAssignments?: Record<string, number> | null }) => Promise<unknown>
>()
const saveDayAssignmentsMutate = vi.fn<
  (args: { weekDate: string; dayAssignments: Record<string, number> }) => void
>()
const undoToastShow = vi.fn<(args: { message: string; duration?: number }) => void>()

let loadTemplateToApply: PlanTemplate
let currentWeeklyPlan: WeeklyPlan
let currentUserConfig: UserConfig
let currentRecipes: Recipe[]
let currentWeeklyPlanRecipes: Recipe[]

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
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useFetchRecipeIds: () => ({
    mutateAsync: fetchRecipeIdsMutateAsync,
  }),
  useSwapRecipe: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useMarkRecipeMade: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveRecipeFromPlan: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAddRecipeToPlan: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRecentRecipeHistory: () => ({
    data: [],
  }),
  useRecipeHistoryStats: () => ({
    data: [],
  }),
  useSaveDayAssignments: () => ({
    mutate: saveDayAssignmentsMutate,
  }),
  usePlannerCategories: () => ["Dinner", "Lunch"],
  useSaveWeeklyPlan: () => ({
    mutateAsync: saveWeeklyPlanMutateAsync,
  }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useAddToShoppingList: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/hooks/use-recipes", () => ({
  useCategories: () => ({
    data: ["Dinner", "Lunch"],
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
  LoadTemplateDialog: ({
    open,
    onLoadTemplate,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onLoadTemplate: (template: PlanTemplate) => void
  }) =>
    open ? (
      <button type="button" onClick={() => onLoadTemplate(loadTemplateToApply)}>
        Apply mocked template
      </button>
    ) : null,
}))

vi.mock("../save-template-dialog", () => ({
  SaveTemplateDialog: ({
    dayAssignments,
    categorySelection,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    recipeIds: string[]
    dayAssignments: Record<string, number> | null
    categorySelection: Record<string, number>
  }) => (
    <div
      data-testid="save-template-dialog-state"
      data-day-assignments={JSON.stringify(dayAssignments)}
      data-category-selection={JSON.stringify(categorySelection)}
    />
  ),
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
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
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
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
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
  PlannerDaySection: React.forwardRef<HTMLElement, { children: React.ReactNode; header?: React.ReactNode }>(
    function MockPlannerDaySection({ children, header }, ref) {
      return (
        <section ref={ref}>
          {header}
          {children}
        </section>
      )
    }
  ),
  PlannerDesktopWeekShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PlannerDayAddButton: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel}>
      Add Meal
    </button>
  ),
  PlannerEmptyWeekPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PlannerMobileHeader: ({ controls }: { controls?: React.ReactNode }) => <div>{controls}</div>,
  PlannerMobileTabBar: () => <div>Mobile tabs</div>,
  PlannerMobileWeekStrip: () => <div>Mobile week strip</div>,
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
    name: "Recipe",
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

function planTemplateFixture(overrides: Partial<PlanTemplate> = {}): PlanTemplate {
  return {
    id: "template-1",
    user_id: "user-1",
    name: "Weeknight Rotation",
    recipe_ids: ["existing-1"],
    day_assignments: null,
    category_selection: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("MealPlanner template loading", () => {
  beforeEach(() => {
    fetchRecipeIdsMutateAsync.mockReset()
    saveWeeklyPlanMutateAsync.mockReset()
    saveDayAssignmentsMutate.mockReset()
    undoToastShow.mockReset()

    fetchRecipeIdsMutateAsync.mockResolvedValue(["existing-1", "existing-2"])
    saveWeeklyPlanMutateAsync.mockResolvedValue(undefined)
    loadTemplateToApply = planTemplateFixture()
    currentWeeklyPlan = weeklyPlanFixture()
    currentUserConfig = userConfigFixture()
    currentRecipes = [recipeFixture({ id: "existing-1" })]
    currentWeeklyPlanRecipes = []

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(min-width: 1024px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it("filters missing recipe ids and persists filtered assignments and category selection through the load flow", async () => {
    loadTemplateToApply = planTemplateFixture({
      recipe_ids: ["existing-2", "missing-1", "existing-1"],
      day_assignments: {
        "existing-2": 4,
        "missing-1": 2,
        "existing-1": 1,
      },
      category_selection: {
        Dinner: 3,
        Lunch: 1,
      },
    })

    render(<MealPlanner />)

    expect(screen.getByTestId("save-template-dialog-state")).toHaveAttribute(
      "data-category-selection",
      JSON.stringify({ Dinner: 1 })
    )

    fireEvent.click(screen.getByRole("button", { name: "Load Template" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply mocked template" }))

    await waitFor(() => {
      expect(saveWeeklyPlanMutateAsync).toHaveBeenCalledWith({
        weekDate: getWeekStartDate(new Date(), 1),
        recipeIds: ["existing-2", "existing-1"],
        dayAssignments: {
          "existing-2": 4,
          "existing-1": 1,
        },
      })
    })

    expect(fetchRecipeIdsMutateAsync).toHaveBeenCalledTimes(1)
    expect(fetchRecipeIdsMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      saveWeeklyPlanMutateAsync.mock.invocationCallOrder[0]
    )

    expect(saveDayAssignmentsMutate).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByTestId("save-template-dialog-state")).toHaveAttribute(
        "data-category-selection",
        JSON.stringify({
          Dinner: 3,
          Lunch: 1,
        })
      )
    })

    expect(undoToastShow).toHaveBeenCalledWith({
      message: 'Template "Weeknight Rotation" loaded (1 deleted recipe removed)',
      duration: 4000,
    })
  })

  it("skips optional assignment persistence when the template has no day assignments or category selection", async () => {
    loadTemplateToApply = planTemplateFixture({
      name: "Simple Rotation",
      recipe_ids: ["existing-1"],
      day_assignments: null,
      category_selection: null,
    })

    render(<MealPlanner />)

    fireEvent.click(screen.getByRole("button", { name: "Load Template" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply mocked template" }))

    await waitFor(() => {
      expect(saveWeeklyPlanMutateAsync).toHaveBeenCalledWith({
        weekDate: getWeekStartDate(new Date(), 1),
        recipeIds: ["existing-1"],
        dayAssignments: null,
      })
    })

    expect(saveDayAssignmentsMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId("save-template-dialog-state")).toHaveAttribute(
      "data-day-assignments",
      JSON.stringify({})
    )
    expect(screen.getByTestId("save-template-dialog-state")).toHaveAttribute(
      "data-category-selection",
      JSON.stringify({ Dinner: 1 })
    )
    expect(undoToastShow).toHaveBeenCalledWith({
      message: 'Template "Simple Rotation" loaded',
      duration: 4000,
    })
  })

  it("shows an explicit move-to-day control on desktop recipe cards", () => {
    currentWeeklyPlan = weeklyPlanFixture({
      recipe_ids: ["existing-1"],
      day_assignments: {
        "existing-1": 1,
      },
    })
    currentWeeklyPlanRecipes = [
      recipeFixture({
        id: "existing-1",
        name: "Planner Recipe",
      }),
    ]

    render(<MealPlanner />)

    expect(screen.getByRole("button", { name: "Move to another day" })).toBeInTheDocument()
  })

  it("removes the redundant mobile week strip while keeping mobile tabs visible", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "(min-width: 1024px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    currentWeeklyPlan = weeklyPlanFixture({
      recipe_ids: ["existing-1"],
      day_assignments: {
        "existing-1": 1,
      },
    })
    currentWeeklyPlanRecipes = [
      recipeFixture({
        id: "existing-1",
        name: "Planner Recipe",
      }),
    ]

    render(<MealPlanner />)

    expect(screen.getByText("Mobile tabs")).toBeInTheDocument()
    expect(screen.queryByText("Mobile week strip")).not.toBeInTheDocument()
  })
})
