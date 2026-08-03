import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RecipeDetailPage } from "../recipe-detail-page"
import type { Recipe } from "@/types/database"

globalThis.React = React

const router = {
  back: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}
const favoriteMutateAsync = vi.fn()
const addShoppingMutateAsync = vi.fn()
const refetch = vi.fn()
const showToast = vi.fn()
let recipeResult: {
  data: Recipe | null | undefined
  error: unknown
  isError: boolean
  isLoading: boolean
  isSuccess: boolean
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}))

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    priority: _priority,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean
    priority?: boolean
    unoptimized?: boolean
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt || ""} {...props} />
  ),
}))

vi.mock("@/hooks/use-recipes", () => ({
  useRecipe: () => ({
    ...recipeResult,
    refetch,
  }),
  useCategories: () => ({ data: ["Dinner"] }),
  useDeleteRecipe: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleFavorite: () => ({
    mutateAsync: favoriteMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-planner", () => ({
  useMarkRecipeAsMade: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRecipeHistoryStats: () => ({ data: [] }),
  useUnmarkRecipeAsMade: () => ({ mutate: vi.fn() }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useAddToShoppingList: () => ({
    mutateAsync: addShoppingMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({ show: showToast }),
}))

vi.mock("../recipe-dialog", () => ({
  RecipeDialog: ({ open }: { open: boolean }) =>
    open ? <div>Edit recipe dialog</div> : null,
}))

vi.mock("../share-recipe-dialog", () => ({
  ShareRecipeDialog: () => null,
}))

vi.mock("../add-to-plan-dialog", () => ({
  AddToPlanDialog: () => null,
}))

function makeRecipe(): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Curry",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: [{ item: "Onion", amount: 1, unit: "" }],
    instructions: ["Cook it"],
    instruction_groups: null,
    notes: [],
    image_url: null,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    created_at: null,
    updated_at: null,
  }
}

describe("RecipeDetailPage states", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recipeResult = {
      data: undefined,
      error: null,
      isError: false,
      isLoading: true,
      isSuccess: false,
    }
  })

  it("renders an explicit loading state for direct URLs", () => {
    render(<RecipeDetailPage recipeId="recipe-1" />)

    expect(screen.getByLabelText("Loading recipe")).toBeInTheDocument()
  })

  it("renders missing-recipe state safely", () => {
    recipeResult = {
      data: null,
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }

    render(<RecipeDetailPage recipeId="missing" />)

    expect(screen.getByRole("heading", { name: "Recipe not found" })).toBeInTheDocument()
  })

  it("renders query errors with a retry action", () => {
    recipeResult = {
      data: undefined,
      error: new Error("offline"),
      isError: true,
      isLoading: false,
      isSuccess: false,
    }

    render(<RecipeDetailPage recipeId="recipe-1" />)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))

    expect(screen.getByRole("heading", { name: "Couldn’t load recipe" })).toBeInTheDocument()
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("renders recipe data and keeps favorite and edit actions functional", async () => {
    recipeResult = {
      data: makeRecipe(),
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    favoriteMutateAsync.mockResolvedValueOnce(makeRecipe())

    render(<RecipeDetailPage recipeId="recipe-1" />)

    expect(screen.getByRole("heading", { name: "Curry", level: 1 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit Recipe" }))

    await waitFor(() => {
      expect(favoriteMutateAsync).toHaveBeenCalledWith({
        id: "recipe-1",
        favorite: false,
      })
    })
    expect(screen.getByText("Edit recipe dialog")).toBeInTheDocument()
  })

  it("adds the currently selected yield to shopping with an exact scale", async () => {
    recipeResult = {
      data: {
        ...makeRecipe(),
        yield_metadata: {
          version: 1,
          authoredText: "4–5 servings",
          kind: "servings",
          range: {
            start: { numerator: "4", denominator: "1" },
            end: { numerator: "5", denominator: "1" },
            startLexeme: "4",
            endLexeme: "5",
            separator: "–",
          },
          scalingBasis: { numerator: "4", denominator: "1" },
        },
      },
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    addShoppingMutateAsync.mockResolvedValueOnce({
      added: 1,
      merged: 0,
      outcome: "applied",
    })

    render(<RecipeDetailPage recipeId="recipe-1" />)
    fireEvent.click(screen.getByRole("button", { name: "Increase yield" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to Shopping List" }))

    await waitFor(() => {
      expect(addShoppingMutateAsync).toHaveBeenCalledWith({
        recipeIds: ["recipe-1"],
        scale: 1.25,
        scaleV1: { numerator: "5", denominator: "4" },
      })
    })
  })

  it.each([
    ["recipes", "Back to recipes"],
    ["planner", "Back to planner"],
    ["shopping", "Back to shopping"],
  ] as const)(
    "uses the validated %s origin for its visible and accessible return label",
    async (source, label) => {
      recipeResult = {
        data: makeRecipe(),
        error: null,
        isError: false,
        isLoading: false,
        isSuccess: true,
      }
      render(
        <RecipeDetailPage
          recipeId="recipe-1"
          returnSource={source}
        />
      )

      const returnButton = await screen.findByRole("button", { name: label })
      expect(returnButton).toHaveTextContent(label)
      fireEvent.click(returnButton)

      expect(router.back).toHaveBeenCalledOnce()
      expect(router.replace).not.toHaveBeenCalled()
    }
  )

  it("preserves route return context across a detail-page refresh", async () => {
    recipeResult = {
      data: makeRecipe(),
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }
    const firstRender = render(
      <RecipeDetailPage
        recipeId="recipe-1"
        returnSource="planner"
      />
    )

    expect(
      await screen.findByRole("button", { name: "Back to planner" })
    ).toBeInTheDocument()
    firstRender.unmount()

    render(
      <RecipeDetailPage
        recipeId="recipe-1"
        returnSource="planner"
      />
    )

    expect(
      await screen.findByRole("button", { name: "Back to planner" })
    ).toBeInTheDocument()
  })

  it("uses the Recipes fallback for direct URLs without route context", () => {
    recipeResult = {
      data: makeRecipe(),
      error: null,
      isError: false,
      isLoading: false,
      isSuccess: true,
    }

    render(<RecipeDetailPage recipeId="recipe-1" />)
    fireEvent.click(
      screen.getByRole("button", { name: "Back to recipes" })
    )

    expect(router.back).not.toHaveBeenCalled()
    expect(router.replace).toHaveBeenCalledWith("/recipes")
  })
})
