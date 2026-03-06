import { describe, expect, it } from "vitest"
import { getUnassignedDayOfWeek } from "@/lib/planner-utils"
import type { Recipe } from "@/types/database"
import {
  deriveActiveRecipeOverlay,
  derivePlannerProgress,
  deriveTotalMeals,
  filterTemplateLoadData,
  groupRecipesByPlannerDay,
  isRecipeMadeForWeek,
  normalizeStoredDayAssignments,
} from "../meal-planner.selectors"

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    name: "Recipe",
    category: "Dinner",
    servings: 4,
    image_url: null,
    ingredients: [],
    instructions: [],
    ...overrides,
  } as Recipe
}

function findRecipeIdForDay(dayOfWeek: number, priority: number[]): string {
  for (let index = 0; index < 200; index += 1) {
    const candidate = `recipe-${index}`
    if (getUnassignedDayOfWeek(candidate, priority) === dayOfWeek) {
      return candidate
    }
  }

  throw new Error(`Unable to find recipe id for day ${dayOfWeek}`)
}

describe("meal-planner selectors", () => {
  it("treats manual and in-week history matches as made", () => {
    const lastMadeMap = new Map([
      ["history-made", "2026-01-07T12:00:00.000Z"],
      ["old-history", "2025-12-30T12:00:00.000Z"],
    ])

    expect(isRecipeMadeForWeek({
      recipeId: "manual-made",
      currentWeekDate: "2026-01-05",
      madeRecipeIds: ["manual-made"],
      lastMadeMap,
    })).toBe(true)

    expect(isRecipeMadeForWeek({
      recipeId: "history-made",
      currentWeekDate: "2026-01-05",
      madeRecipeIds: [],
      lastMadeMap,
    })).toBe(true)

    expect(isRecipeMadeForWeek({
      recipeId: "old-history",
      currentWeekDate: "2026-01-05",
      madeRecipeIds: [],
      lastMadeMap,
    })).toBe(false)
  })

  it("derives planner progress from centralized made-state logic", () => {
    const recipes = [
      recipe({ id: "manual-made" }),
      recipe({ id: "history-made" }),
      recipe({ id: "not-made" }),
    ]
    const lastMadeMap = new Map([["history-made", "2026-01-06T12:00:00.000Z"]])

    expect(derivePlannerProgress({
      recipes,
      currentWeekDate: "2026-01-05",
      madeRecipeIds: ["manual-made"],
      lastMadeMap,
    })).toEqual({
      made: 2,
      total: 3,
      percentage: 67,
    })
  })

  it("groups assigned recipes ahead of unassigned recipes for the same day", () => {
    const recipes = [
      recipe({ id: "unassigned-1", name: "Unassigned 1" }),
      recipe({ id: "assigned-monday", name: "Assigned Monday" }),
      recipe({ id: "unassigned-2", name: "Unassigned 2" }),
    ]

    const grouped = groupRecipesByPlannerDay({
      recipes,
      recipeDayAssignments: { "assigned-monday": 1 },
      weekDayNumbers: [1, 2, 3],
      unassignedDayPriority: [1],
    })

    expect(grouped[0].map((item) => item.id)).toEqual([
      "assigned-monday",
      "unassigned-1",
      "unassigned-2",
    ])
    expect(grouped[1]).toEqual([])
    expect(grouped[2]).toEqual([])
  })

  it("distributes unassigned recipes using the configured priority buckets", () => {
    const priority = [1, 3]
    const mondayRecipeId = findRecipeIdForDay(1, priority)
    const wednesdayRecipeId = findRecipeIdForDay(3, priority)

    const grouped = groupRecipesByPlannerDay({
      recipes: [
        recipe({ id: mondayRecipeId }),
        recipe({ id: wednesdayRecipeId }),
      ],
      recipeDayAssignments: {},
      weekDayNumbers: [1, 2, 3],
      unassignedDayPriority: priority,
    })

    expect(grouped[0].map((item) => item.id)).toEqual([mondayRecipeId])
    expect(grouped[1]).toEqual([])
    expect(grouped[2].map((item) => item.id)).toEqual([wednesdayRecipeId])
  })

  it("derives active drag overlay metadata deterministically", () => {
    const overlay = deriveActiveRecipeOverlay({
      recipes: [
        recipe({
          id: "active",
          name: "Active Recipe",
          image_url: "https://images.example.com/recipe.jpg",
        }),
      ],
      activeRecipeId: "active",
    })

    expect(overlay?.recipe.id).toBe("active")
    expect(overlay?.imageUrl).toBe("https://images.example.com/recipe.jpg")
    expect(overlay?.unoptimized).toBe(true)
  })

  it("sums planned meals from selection counts", () => {
    expect(deriveTotalMeals({
      breakfast: 2,
      dinner: 4,
      lunch: 1,
    })).toBe(7)
  })

  it("normalizes v2 and legacy stored day assignments without touching storage", () => {
    expect(normalizeStoredDayAssignments({
      storedAssignments: {
        version: 2,
        weeks: {
          "2026-01-05": { a: 1, b: 3 },
        },
      },
      currentWeekDate: "2026-01-05",
      weekStartDay: 1,
    })).toEqual({ a: 1, b: 3 })

    expect(normalizeStoredDayAssignments({
      storedAssignments: {
        "2026-01-05": { a: 0, b: 6 },
      },
      currentWeekDate: "2026-01-05",
      weekStartDay: 1,
    })).toEqual({ a: 1, b: 0 })
  })

  it("filters template recipe ids, missing count, and day assignments to existing recipes", () => {
    expect(filterTemplateLoadData({
      template: {
        recipe_ids: ["a", "missing", "b"],
        day_assignments: { a: 1, missing: 3, b: 5 },
        category_selection: null,
      },
      existingRecipeIds: new Set(["a", "b"]),
    })).toEqual({
      recipeIds: ["a", "b"],
      missingCount: 1,
      dayAssignments: { a: 1, b: 5 },
      categorySelection: null,
    })
  })

  it("preserves category selection when present", () => {
    expect(filterTemplateLoadData({
      template: {
        recipe_ids: [],
        day_assignments: null,
        category_selection: { breakfast: 2, dinner: 3 },
      },
      existingRecipeIds: new Set<string>(),
    })).toEqual({
      recipeIds: [],
      missingCount: 0,
      dayAssignments: null,
      categorySelection: { breakfast: 2, dinner: 3 },
    })
  })

  it("handles empty or partially missing template data", () => {
    expect(filterTemplateLoadData({
      template: {
        recipe_ids: ["missing"],
        day_assignments: {},
        category_selection: null,
      },
      existingRecipeIds: new Set<string>(),
    })).toEqual({
      recipeIds: [],
      missingCount: 1,
      dayAssignments: {},
      categorySelection: null,
    })
  })
})
