import React from "react"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RecipeList } from "../recipe-list"
import type { Recipe } from "@/types/database"

let lastRecipeOptions:
  | {
      category?: string | null
      search?: string | null
      favoritesOnly?: boolean
      tags?: string[]
    }
  | undefined

let baseRecipes: Recipe[] = []
let isDesktopViewport = true
const addToShoppingListMutateAsync = vi.fn()
const deleteRecipeMutateAsync = vi.fn()
const undoToastShow = vi.fn()

vi.mock("@/hooks/use-is-desktop", () => ({
  useIsDesktop: () => isDesktopViewport,
}))

vi.mock("@/hooks/use-recipes", () => ({
  useRecipes: (options?: {
    category?: string | null
    search?: string | null
    favoritesOnly?: boolean
    tags?: string[]
  }) => {
    lastRecipeOptions = options

    let data = [...baseRecipes]

    if (options?.category) {
      data = data.filter((recipe) => recipe.category === options.category)
    }

    if (options?.search) {
      const query = options.search.toLowerCase()
      data = data.filter((recipe) =>
        recipe.name.toLowerCase().includes(query) || recipe.category.toLowerCase().includes(query)
      )
    }

    if (options?.favoritesOnly) {
      data = data.filter((recipe) => recipe.favorite)
    }

    if (options?.tags?.length) {
      data = data.filter((recipe) => (recipe.tags ?? []).some((tag) => options.tags?.includes(tag)))
    }

    return {
      data,
      isLoading: false,
      isFetching: false,
    }
  },
  useCategories: () => ({
    data: ["Dinner", "Lunch"],
  }),
  useAllTags: () => ({
    data: ["Quick"],
  }),
  useTagsWithCounts: () => ({
    data: [{ tag: "Quick", count: 1 }],
  }),
  useToggleFavorite: () => ({
    mutate: vi.fn(),
  }),
  useDeleteRecipe: () => ({
    mutateAsync: deleteRecipeMutateAsync,
  }),
}))

vi.mock("@/hooks/use-planner", () => ({
  useRecipeHistoryStats: () => ({ data: [] }),
  useMarkRecipeAsMade: () => ({ mutateAsync: vi.fn() }),
  useUnmarkRecipeAsMade: () => ({ mutate: vi.fn() }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useAddToShoppingList: () => ({
    mutateAsync: addToShoppingListMutateAsync,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    title,
    variant,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
      data-variant={variant}
    >
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    children,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <div data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/multi-select", () => ({
  MultiSelect: ({ placeholder }: { placeholder?: string }) => <button type="button">{placeholder}</button>,
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
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <button onClick={action.onClick}>{action.label}</button> : null}
    </div>
  ),
}))

vi.mock("../recipe-card", () => ({
  RecipeCard: ({
    recipe,
    onAddToShoppingList,
    onDelete,
  }: {
    recipe: Recipe
    onAddToShoppingList?: (recipe: Recipe) => void
    onDelete?: (recipe: Recipe) => void
  }) => (
    <div>
      <span>{recipe.name}</span>
      <button type="button" onClick={() => onAddToShoppingList?.(recipe)}>
        Add {recipe.name}
      </button>
      <button type="button" onClick={() => onDelete?.(recipe)}>
        Delete {recipe.name}
      </button>
    </div>
  ),
}))

vi.mock("../recipe-dialog", () => ({
  RecipeDialog: () => null,
}))

vi.mock("../recipe-detail-dialog", () => ({
  RecipeDetailDialog: () => null,
}))

vi.mock("../add-to-plan-dialog", () => ({
  AddToPlanDialog: () => null,
}))

vi.mock("../recipe-settings-modal", () => ({
  RecipeSettingsModal: () => null,
}))

vi.mock("../share-recipe-dialog", () => ({
  ShareRecipeDialog: () => null,
}))

vi.mock("../shared-recipes-inbox", () => ({
  SharedRecipesInbox: () => null,
}))

vi.mock("@/lib/recipe-export", () => ({
  downloadRecipesAsJson: vi.fn(),
}))

function recipeFixture(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Chicken Soup",
    category: "Dinner",
    favorite: false,
    tags: [],
    servings: 4,
    ingredients: [],
    instructions: [],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("RecipeList", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    lastRecipeOptions = undefined
    baseRecipes = [recipeFixture()]
    isDesktopViewport = true
    addToShoppingListMutateAsync.mockReset()
    deleteRecipeMutateAsync.mockReset()
    undoToastShow.mockReset()
    window.localStorage.clear()
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  it("aligns the search copy with the actual search scope", () => {
    render(<RecipeList />)

    expect(screen.getByPlaceholderText("Search by recipe name or category...")).toBeInTheDocument()
    expect(screen.getByText("Search matches recipe names and categories.")).toBeInTheDocument()
  })

  it("shows active search filters clearly and trims the query before sending it to data fetching", () => {
    render(<RecipeList />)

    fireEvent.change(screen.getByLabelText("Search recipes by name or category"), {
      target: { value: "  chicken  " },
    })

    expect(lastRecipeOptions?.search).toBe("chicken")
    expect(screen.getByText('Search: "chicken"')).toBeInTheDocument()
    expect(screen.getByText("1 recipe shown")).toBeInTheDocument()
    expect(screen.getByText("Search checks names and categories. Category, tag, and favorites filters narrow further.")).toBeInTheDocument()
  })

  it("uses filtered empty-state copy that explains what search actually matches", () => {
    render(<RecipeList />)

    fireEvent.change(screen.getByLabelText("Search recipes by name or category"), {
      target: { value: "pasta" },
    })

    expect(screen.getByText("No recipes match the current search and filters")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Search only checks recipe names and categories. Try adjusting the filters above or clear them to broaden results."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeInTheDocument()
  })

  it("surfaces shared and settings in a dedicated mobile utilities row", () => {
    isDesktopViewport = false

    render(<RecipeList />)

    const utilitiesRow = screen.getByLabelText("Recipe mobile utilities")
    expect(utilitiesRow).toBeInTheDocument()
    expect(within(utilitiesRow).getByRole("button", { name: "Shared" })).toBeInTheDocument()
    expect(within(utilitiesRow).getByRole("button", { name: "Settings" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Favorites" }).length).toBeGreaterThan(0)
  })

  it("reports update-only shopping results without claiming new additions", async () => {
    addToShoppingListMutateAsync.mockResolvedValueOnce({
      added: 0,
      merged: 2,
    })

    render(<RecipeList />)

    fireEvent.click(screen.getByRole("button", { name: "Add Chicken Soup" }))

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'Merged 2 shopping items from "Chicken Soup" with items already on the shopping list',
      })
    })
  })

  it("reports when everything from a recipe is already on the shopping list", async () => {
    addToShoppingListMutateAsync.mockResolvedValueOnce({
      added: 0,
      merged: 0,
    })

    render(<RecipeList />)

    fireEvent.click(screen.getByRole("button", { name: "Add Chicken Soup" }))

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'All shopping items from "Chicken Soup" are already on the shopping list',
      })
    })
  })

  it("waits for recipe deletion to succeed before confirming it", async () => {
    deleteRecipeMutateAsync.mockResolvedValueOnce("recipe-1")

    render(<RecipeList />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Chicken Soup" }))

    await waitFor(() => {
      expect(deleteRecipeMutateAsync).toHaveBeenCalledWith("recipe-1")
    })

    expect(undoToastShow).toHaveBeenCalledWith({
      message: '"Chicken Soup" deleted',
    })
  })
})
