import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LoadTemplateDialog } from "../load-template-dialog"
import type { PlanTemplate, Recipe } from "@/types/database"
import { canonicalizeRecipeFixture, type RecipeFixtureInput } from "@/test/recipe-fixtures"

const deleteTemplateMutateAsync = vi.fn()
const renameTemplateMutateAsync = vi.fn()

let templates: PlanTemplate[] = []
let recipes: Recipe[] = []
let isTemplatesLoading = false

vi.mock("@/hooks/use-plan-templates", () => ({
  usePlanTemplates: () => ({
    data: templates,
    isLoading: isTemplatesLoading,
  }),
  useDeletePlanTemplate: () => ({
    mutateAsync: deleteTemplateMutateAsync,
    isPending: false,
  }),
  useRenamePlanTemplate: () => ({
    mutateAsync: renameTemplateMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-recipes", () => ({
  useRecipes: () => ({
    data: recipes,
  }),
}))

function templateFixture(overrides: Partial<PlanTemplate> = {}): PlanTemplate {
  return {
    id: "template-1",
    user_id: "user-1",
    name: "Weeknight Rotation",
    recipe_ids: ["recipe-1", "recipe-2"],
    day_assignments: {
      "recipe-1": 1,
    },
    category_selection: {
      Dinner: 2,
    },
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

function recipeFixture(overrides: RecipeFixtureInput = {}): Recipe {
  return canonicalizeRecipeFixture({
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
  })
}

describe("LoadTemplateDialog", () => {
  beforeEach(() => {
    deleteTemplateMutateAsync.mockReset()
    renameTemplateMutateAsync.mockReset()
    isTemplatesLoading = false
    templates = [templateFixture()]
    recipes = [recipeFixture(), recipeFixture({ id: "recipe-2" })]
  })

  it("requires an explicit confirmation before loading a template", () => {
    const onLoadTemplate = vi.fn().mockResolvedValue(undefined)

    render(
      <LoadTemplateDialog
        open
        onOpenChange={vi.fn()}
        onLoadTemplate={onLoadTemplate}
        weekLabel="Mar 2 - Mar 8"
        currentRecipeCount={3}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Load" }))

    expect(screen.getByText("Load template into Mar 2 - Mar 8?")).toBeInTheDocument()
    expect(
      screen.getByText(/It will replace 3 currently planned recipes/i)
    ).toBeInTheDocument()
    expect(onLoadTemplate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Load Template" }))

    return waitFor(() => {
      expect(onLoadTemplate).toHaveBeenCalledWith(templates[0])
    })
  })

  it("shows template context without loading on row click alone", () => {
    const onLoadTemplate = vi.fn().mockResolvedValue(undefined)

    render(
      <LoadTemplateDialog
        open
        onOpenChange={vi.fn()}
        onLoadTemplate={onLoadTemplate}
        weekLabel="Mar 2 - Mar 8"
        currentRecipeCount={0}
      />
    )

    expect(screen.getByText("Weeknight Rotation")).toBeInTheDocument()
    expect(screen.getByText("2 recipes")).toBeInTheDocument()
    expect(screen.getByText("1 day assignment")).toBeInTheDocument()
    expect(screen.getByText("Includes meal mix")).toBeInTheDocument()
    expect(onLoadTemplate).not.toHaveBeenCalled()
  })

  it("keeps the dialog actionable when loading a template fails", async () => {
    const onLoadTemplate = vi.fn().mockRejectedValue(new Error("Network down"))

    render(
      <LoadTemplateDialog
        open
        onOpenChange={vi.fn()}
        onLoadTemplate={onLoadTemplate}
        weekLabel="Mar 2 - Mar 8"
        currentRecipeCount={3}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Load" }))
    fireEvent.click(screen.getByRole("button", { name: "Load Template" }))

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Network down")
    })

    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument()
  })

  it("uses clearer loading and empty-state copy", () => {
    isTemplatesLoading = true

    const { rerender } = render(
      <LoadTemplateDialog
        open
        onOpenChange={vi.fn()}
        onLoadTemplate={vi.fn()}
        weekLabel="Mar 2 - Mar 8"
        currentRecipeCount={0}
      />
    )

    expect(screen.getByText("Loading saved templates...")).toBeInTheDocument()

    isTemplatesLoading = false
    templates = []

    rerender(
      <LoadTemplateDialog
        open
        onOpenChange={vi.fn()}
        onLoadTemplate={vi.fn()}
        weekLabel="Mar 2 - Mar 8"
        currentRecipeCount={0}
      />
    )

    expect(screen.getByText("No saved templates yet. Save a week from Planner to reuse it later.")).toBeInTheDocument()
  })
})
