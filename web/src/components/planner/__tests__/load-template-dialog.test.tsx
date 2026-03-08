import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LoadTemplateDialog } from "../load-template-dialog"
import type { PlanTemplate, Recipe } from "@/types/database"

const deleteTemplateMutateAsync = vi.fn()
const renameTemplateMutateAsync = vi.fn()

let templates: PlanTemplate[] = []
let recipes: Recipe[] = []

vi.mock("@/hooks/use-plan-templates", () => ({
  usePlanTemplates: () => ({
    data: templates,
    isLoading: false,
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

describe("LoadTemplateDialog", () => {
  beforeEach(() => {
    deleteTemplateMutateAsync.mockReset()
    renameTemplateMutateAsync.mockReset()
    templates = [templateFixture()]
    recipes = [recipeFixture(), recipeFixture({ id: "recipe-2" })]
  })

  it("requires an explicit confirmation before loading a template", () => {
    const onLoadTemplate = vi.fn()

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

    expect(onLoadTemplate).toHaveBeenCalledWith(templates[0])
  })

  it("shows template context without loading on row click alone", () => {
    const onLoadTemplate = vi.fn()

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
})
