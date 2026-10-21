import React from "react"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RecipeList } from "../recipe-list"
import type { RecipeRouteState } from "@/lib/recipe-route-state"
import type { Recipe } from "@/types/database"
import {
  canonicalizeRecipeFixture,
  type RecipeFixtureInput,
} from "@/test/recipe-fixtures"
import { createEmptyShoppingDocument } from "@/lib/shopping-document"

vi.mock("@/hooks/shopping/use-shopping-document", () => ({
  useShoppingDocumentState: () => ({ data: { document: createEmptyShoppingDocument() }, isLoading: false, isError: false }),
}))

const DEFAULT_ROUTE_STATE: RecipeRouteState = {
  category: null,
  favoritesOnly: false,
  query: "",
  sortBy: "lastMade",
  tags: [],
  viewMode: null,
}

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
const favoriteMutate = vi.fn()
const markMadeMutateAsync = vi.fn()
const unmarkMadeMutate = vi.fn()
const undoToastShow = vi.fn()
let recipeError: Error | null = null
const refetchRecipes = vi.fn()
const routerPush = vi.fn()
const routerReplace = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
    back: vi.fn(),
  }),
}))

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
      error: recipeError,
      refetch: refetchRecipes,
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
    mutate: favoriteMutate,
  }),
  useDeleteRecipe: () => ({
    mutateAsync: deleteRecipeMutateAsync,
  }),
}))

vi.mock("@/hooks/use-planner", () => ({
  useRecipeHistoryStats: () => ({ data: [] }),
  useMarkRecipeAsMade: () => ({ mutateAsync: markMadeMutateAsync }),
  useUnmarkRecipeAsMade: () => ({ mutateAsync: unmarkMadeMutate }),
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
  buttonVariants: () => "",
  Button: ({
    children,
    onClick,
    disabled,
    className,
    title,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
      data-variant={variant}
      {...props}
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
    onValueChange,
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <select aria-label="Sort recipes" value={value} onChange={event => onValueChange(event.target.value)}>
      {["timesMade", "lastMade", "name", "newest"].map(option => (
        <option key={option} value={option}>{option}</option>
      ))}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/multi-select", () => ({
  MultiSelect: ({ placeholder, onChange }: { placeholder?: string; onChange: (value: string[]) => void }) => <button type="button" onClick={() => onChange(["Quick"])}>{placeholder}</button>,
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
    onClick,
    onToggleFavorite,
    onMarkMade,
    onPrint,
  }: {
    recipe: Recipe
    onAddToShoppingList?: (recipe: Recipe) => void
    onDelete?: (recipe: Recipe) => void
    onClick?: (recipe: Recipe) => void
    onToggleFavorite?: (recipe: Recipe) => void
    onMarkMade?: (recipe: Recipe) => void
    onPrint?: (recipe: Recipe) => void
  }) => (
    <div>
      <span>{recipe.name}</span>
      <button onClick={() => onToggleFavorite?.(recipe)}>Favorite {recipe.name}</button>
      <button onClick={() => onMarkMade?.(recipe)}>Made {recipe.name}</button>
      <button onClick={() => onPrint?.(recipe)}>Print {recipe.name}</button>
      <button type="button" onClick={() => onClick?.(recipe)}>
        View {recipe.name}
      </button>
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

function recipeFixture(overrides: RecipeFixtureInput = {}): Recipe {
  return canonicalizeRecipeFixture({
    id: "recipe-1",
    user_id: "user-1",
    name: "Chicken Soup",
    category: "Dinner",
    favorite: false,
    tags: [],
    servings: 4,
    fixtureIngredients: [{ item: "onion", amount: 1, unit: "" }],
    fixtureInstructions: [],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  })
}

describe("RecipeList", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    recipeError = null
    refetchRecipes.mockReset()
    lastRecipeOptions = undefined
    baseRecipes = [recipeFixture()]
    isDesktopViewport = true
    addToShoppingListMutateAsync.mockReset()
    deleteRecipeMutateAsync.mockReset()
    favoriteMutate.mockReset()
    markMadeMutateAsync.mockReset()
    markMadeMutateAsync.mockResolvedValue({ recipeId: "recipe-1", historyId: 42 })
    unmarkMadeMutate.mockReset()
    unmarkMadeMutate.mockResolvedValue({ recipeId: "recipe-1" })
    undoToastShow.mockReset()
    routerPush.mockReset()
    routerReplace.mockReset()
    window.history.replaceState(null, "", "/recipes")
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  it.each(["timesMade", "lastMade", "name", "newest"])(
    "remembers %s across fresh list mounts without persisting filters",
    (sort) => {
      const view = render(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, query: "chicken" }} />)
      fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), {
        target: { value: sort },
      })
      expect(window.localStorage.getItem("recipe-genie:recipe-sort:v1")).toBe(sort)
      expect(window.localStorage.length).toBe(1)
      view.unmount()
      routerReplace.mockClear()
      const returned = render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
      if (sort !== "lastMade") {
        expect(routerReplace).toHaveBeenCalledWith(`/recipes?sort=${sort}`, { scroll: false })
        returned.rerender(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, sortBy: sort as RecipeRouteState["sortBy"] }} />)
      } else {
        expect(routerReplace).not.toHaveBeenCalled()
      }
      expect(screen.getByRole("combobox", { name: "Sort recipes" })).toHaveValue(sort)
      expect(lastRecipeOptions?.search).toBeNull()
    }
  )

  it.each([null, "invalid", '{"sort":"name"}', "NAME"])(
    "preserves the default for absent or invalid storage (%s)",
    (saved) => {
      if (saved !== null) window.localStorage.setItem("recipe-genie:recipe-sort:v1", saved)
      render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
      expect(screen.getByRole("combobox", { name: "Sort recipes" })).toHaveValue("lastMade")
      expect(routerReplace).not.toHaveBeenCalled()
    }
  )

  it("honors explicit URLs, including the default, without changing the saved choice", () => {
    window.localStorage.setItem("recipe-genie:recipe-sort:v1", "name")
    window.history.replaceState(null, "", "/recipes?sort=lastMade")
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    expect(routerReplace).not.toHaveBeenCalled()
    expect(window.localStorage.getItem("recipe-genie:recipe-sort:v1")).toBe("name")
  })

  it("keeps sorting usable when storage reads and writes fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full") })
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), {
      target: { value: "newest" },
    })
    expect(routerReplace).toHaveBeenCalledWith("/recipes?sort=newest", { scroll: false })
  })
  it("restores the actual recipe ordering and replaces the saved choice when changed again", () => {
    baseRecipes = [
      recipeFixture({ id: "apple", name: "Apple", created_at: "2025-01-01T00:00:00Z" }),
      recipeFixture({ id: "zebra", name: "Zebra", created_at: "2026-01-01T00:00:00Z" }),
    ]
    window.localStorage.setItem("recipe-genie:recipe-sort:v1", "newest")
    const view = render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    expect(routerReplace).toHaveBeenCalledWith("/recipes?sort=newest", { scroll: false })
    view.rerender(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, sortBy: "newest" }} />)
    expect(screen.getAllByRole("button", { name: /^View (Apple|Zebra)$/ }).map(button => button.textContent))
      .toEqual(["View Zebra", "View Apple"])
    fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), {
      target: { value: "lastMade" },
    })
    expect(window.localStorage.getItem("recipe-genie:recipe-sort:v1")).toBe("lastMade")
    view.unmount()
    routerReplace.mockClear()
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    expect(routerReplace).not.toHaveBeenCalled()
    expect(screen.getAllByRole("button", { name: /^View (Apple|Zebra)$/ }).map(button => button.textContent))
      .toEqual(["View Apple", "View Zebra"])
  })
  it("aligns the search copy with the actual search scope", () => {
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)

    expect(screen.getByLabelText("Search recipes by name or category")).toBeInTheDocument()

  })

  it("shows favorite failures and uses the global history owner with Undo", async () => {
    favoriteMutate.mockImplementation((_input, options) => options.onError(new Error("Favorite unavailable")))
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.click(screen.getByRole("button", { name: "Favorite Chicken Soup" }))
    expect(undoToastShow).toHaveBeenCalledWith({ message: "Favorite unavailable" })
    fireEvent.click(screen.getByRole("button", { name: "Made Chicken Soup" }))
    await waitFor(() => expect(markMadeMutateAsync).toHaveBeenCalledWith("recipe-1"))
    await waitFor(() => expect(undoToastShow).toHaveBeenCalledWith(expect.objectContaining({ message: '"Chicken Soup" marked as made' })))
    const toast = undoToastShow.mock.calls.find(([value]) => value.onUndo)?.[0]
    await act(async () => { toast.onUndo() })
    expect(unmarkMadeMutate).toHaveBeenCalledWith({ recipeId: "recipe-1", historyId: 42 })
    expect(undoToastShow).toHaveBeenLastCalledWith({ message: '"Chicken Soup" mark as made undone' })
    expect(screen.queryByRole("button", { name: "Retry Undo" })).not.toBeInTheDocument()
  })

  it("retains an explicit retry after rejected Undo and retries the same entry", async () => {
    unmarkMadeMutate.mockRejectedValueOnce(new Error("History unavailable"))
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.click(screen.getByRole("button", { name: "Made Chicken Soup" }))
    await waitFor(() => expect(undoToastShow).toHaveBeenCalled())
    await act(async () => { undoToastShow.mock.calls[0][0].onUndo() })
    expect(screen.getByRole("alert")).toHaveTextContent('Could not undo "Chicken Soup". History unavailable')
    expect(undoToastShow).not.toHaveBeenCalledWith({ message: '"Chicken Soup" mark as made undone' })
    fireEvent.click(screen.getByRole("button", { name: "Retry Undo" }))
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry Undo" })).not.toBeInTheDocument())
    expect(unmarkMadeMutate.mock.calls.map(([target]) => target)).toEqual([
      { recipeId: "recipe-1", historyId: 42 }, { recipeId: "recipe-1", historyId: 42 },
    ])
    expect(markMadeMutateAsync).toHaveBeenCalledTimes(1)
    expect(undoToastShow).toHaveBeenLastCalledWith({ message: '"Chicken Soup" mark as made undone' })
  })

  it("guards overlapping Undo/retry clicks and waits for confirmed deletion", async () => {
    let reject!: (reason: Error) => void
    let resolve!: () => void
    unmarkMadeMutate.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.click(screen.getByRole("button", { name: "Made Chicken Soup" }))
    await waitFor(() => expect(undoToastShow).toHaveBeenCalled())
    const undo = undoToastShow.mock.calls[0][0].onUndo
    act(() => { undo(); undo(); undo() })
    expect(unmarkMadeMutate).toHaveBeenCalledTimes(1)
    await act(async () => { reject(new Error("Network failed")) })
    unmarkMadeMutate.mockReturnValueOnce(new Promise<void>(done => { resolve = done }))
    const retry = screen.getByRole("button", { name: "Retry Undo" })
    fireEvent.click(retry)
    fireEvent.click(retry)
    act(() => { undo() })
    expect(screen.getByRole("button", { name: "Retrying Undo…" })).toBeDisabled()
    expect(unmarkMadeMutate).toHaveBeenCalledTimes(2)
    expect(undoToastShow).not.toHaveBeenCalledWith({ message: '"Chicken Soup" mark as made undone' })
    await act(async () => { resolve() })
    act(() => { undo() })
    expect(unmarkMadeMutate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(undoToastShow).toHaveBeenLastCalledWith({ message: '"Chicken Soup" mark as made undone' })
  })

  it("handles a synchronously thrown Undo error and keeps retry available", async () => {
    unmarkMadeMutate.mockImplementationOnce(() => { throw new Error("Unexpected failure") })
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.click(screen.getByRole("button", { name: "Made Chicken Soup" }))
    await waitFor(() => expect(undoToastShow).toHaveBeenCalled())
    await act(async () => { undoToastShow.mock.calls[0][0].onUndo() })
    expect(screen.getByRole("alert")).toHaveTextContent("Unexpected failure")
    expect(screen.getByRole("button", { name: "Retry Undo" })).toBeEnabled()
  })

  it("routes Print to the canonical detail without printing collection chrome", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined)
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    fireEvent.click(screen.getByRole("button", { name: "Print Chicken Soup" }))
    expect(routerPush).toHaveBeenCalledWith("/recipes/recipe-1?from=recipes")
    expect(print).not.toHaveBeenCalled()
  })

  it("shows active route search clearly and sends it to data fetching", () => {
    render(
      <RecipeList
        routeState={{ ...DEFAULT_ROUTE_STATE, query: "chicken" }}
      />
    )

    expect(lastRecipeOptions?.search).toBe("chicken")
    expect(screen.getByText('Search: "chicken"')).toBeInTheDocument()
    expect(screen.getByText("1 recipe shown")).toBeInTheDocument()

  })

  it("does not overwrite newer typing when an older route query arrives", async () => {
    const view = render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    const search = screen.getByLabelText(
      "Search recipes by name or category"
    )

    fireEvent.change(search, { target: { value: "chicken" } })
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/recipes?q=chicken", {
        scroll: false,
      })
    })

    fireEvent.change(search, { target: { value: "chicken soup" } })
    view.rerender(
      <RecipeList
        routeState={{ ...DEFAULT_ROUTE_STATE, query: "chicken" }}
      />
    )

    expect(search).toHaveValue("chicken soup")
  })

  it("uses filtered empty-state copy that explains what search actually matches", () => {
    render(
      <RecipeList
        routeState={{ ...DEFAULT_ROUTE_STATE, query: "pasta" }}
      />
    )

    expect(screen.getByText("No recipes match the current search and filters")).toBeInTheDocument()
    expect(
      screen.getByText(
        "Search only checks recipe names and categories. Try adjusting the filters above or clear them to broaden results."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeInTheDocument()
  })

  it("keeps newer submitted search when an earlier cleared URL arrives late", async () => {
    const view = render(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, query: "missing" }} />)
    const input = screen.getByLabelText("Search recipes by name or category")
    fireEvent.change(input, { target: { value: "shawarma" } })
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith("/recipes?q=shawarma", { scroll: false }))
    view.rerender(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, sortBy: "name" }} />)
    expect(input).toHaveValue("shawarma")
  })

  it("does not restore stale filters when the pending search settles after clearing", () => {
    vi.useFakeTimers()
    try {
      render(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, query: "missing", category: "Dinner", tags: ["Quick"], favoritesOnly: true }} />)
      fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }))
      expect(routerReplace).toHaveBeenCalledWith("/recipes", { scroll: false })
      act(() => vi.advanceTimersByTime(300))
      expect(routerReplace).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it("composes tag and favorite changes before the preceding URL has rendered", () => {
    render(<RecipeList routeState={{ ...DEFAULT_ROUTE_STATE, query: "chicken", category: "Dinner" }} />)
    fireEvent.click(screen.getByRole("button", { name: "Filters (1)" }))
    fireEvent.click(screen.getByRole("button", { name: "Filter by tags" }))
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }))
    expect(routerReplace).toHaveBeenLastCalledWith("/recipes?q=chicken&category=Dinner&tags=Quick&favorite=true", { scroll: false })
  })

  it("keeps filters and collection utilities reachable on mobile", () => {
    isDesktopViewport = false
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    expect(screen.queryByLabelText("Recipe browse filters")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Filters" }))
    const filters = screen.getByLabelText("Recipe browse filters")
    expect(within(filters).getByRole("button", { name: "Favorites" })).toBeInTheDocument()
    fireEvent.keyDown(filters, { key: "Escape" })
    fireEvent.pointerDown(screen.getByRole("button", { name: "Collection actions" }), { button: 0, ctrlKey: false })
    // Menu opening/keyboard behavior is verified with real Radix in the browser journey.
    expect(screen.getByRole("button", { name: "Collection actions" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add recipe" })).toBeInTheDocument()
  })

  it("shows a recoverable recipe read error rather than empty results", () => {
    recipeError = new Error("Recipe service unavailable")
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Recipe service unavailable")
    expect(screen.getByText("Chicken Soup")).toBeInTheDocument()
    expect(screen.queryByText("No recipes yet")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetchRecipes).toHaveBeenCalledOnce()
  })

  it("reports update-only shopping results without claiming new additions", async () => {
    addToShoppingListMutateAsync.mockResolvedValueOnce({
      added: 0,
      merged: 2,
    })

    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)

    fireEvent.click(screen.getByRole("button", { name: "Add Chicken Soup" }))
    expect(addToShoppingListMutateAsync).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Selected yield for Chicken Soup")).toHaveValue(4)
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }))

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

    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)

    fireEvent.click(screen.getByRole("button", { name: "Add Chicken Soup" }))
    fireEvent.click(screen.getByRole("button", { name: "Add selected ingredients" }))

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'All shopping items from "Chicken Soup" are already on the shopping list',
      })
    })
  })

  it("waits for recipe deletion to succeed before confirming it", async () => {
    deleteRecipeMutateAsync.mockResolvedValueOnce("recipe-1")

    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)

    fireEvent.click(screen.getByRole("button", { name: "Delete Chicken Soup" }))
    expect(deleteRecipeMutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      expect(deleteRecipeMutateAsync).toHaveBeenCalledWith("recipe-1")
    })

    expect(undoToastShow).toHaveBeenCalledWith({
      message: '"Chicken Soup" deleted',
    })
  })

  it("opens recipe results on the canonical full-page route", () => {
    render(<RecipeList routeState={DEFAULT_ROUTE_STATE} />)

    fireEvent.click(screen.getByRole("button", { name: "View Chicken Soup" }))

    expect(routerPush).toHaveBeenCalledOnce()
    expect(routerPush).toHaveBeenCalledWith(
      "/recipes/recipe-1?from=recipes"
    )
  })
})
