import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Recipe, ShoppingList } from "@/types/database"

let rpcAttempt = 0
const rpcMock = vi.fn()
const RECIPE_A = "11111111-1111-4111-8111-111111111111"
const RECIPE_B = "22222222-2222-4222-8222-222222222222"
const RECIPE_C = "33333333-3333-4333-8333-333333333333"

const recipeB = {
  id: "legacy-b",
  recipe_uuid: RECIPE_B,
  user_id: "user-a",
  name: "Recipe B",
  category: "test",
  servings: 4,
  ingredients: [{ item: "milk", amount: 2, unit: "cup" }],
  instructions: [],
  tags: [],
  favorite: false,
  image_url: null,
  created_at: "2026-07-14T00:00:00.000Z",
  updated_at: "2026-07-14T00:00:00.000Z",
} as unknown as Recipe

function storedContribution(recipeId: string, amount: number) {
  return {
    user_id: "user-a",
    recipe_uuid: recipeId,
    servings: 4,
    scale: 1,
    normalization_version: 1,
    idempotency_key: `existing-${recipeId}`,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
    snapshot: {
      recipeName: `Recipe ${recipeId.toUpperCase()}`,
      items: [
        {
          bucket: "items",
          item: "milk",
          amount,
          unit: "cup",
          categoryKey: "dairy",
          categoryOrder: 5,
          sources: [{
            recipeId,
            recipeUuid: recipeId,
            recipeName: `Recipe ${recipeId.toUpperCase()}`,
          }],
        },
      ],
    },
  }
}

function currentList(recipeIds: string[], amount: number, revision: number): ShoppingList {
  return {
    user_id: "user-a",
    items: [
      {
        rowId: "milk-row",
        item: "milk",
        amount,
        unit: "cup",
        categoryKey: "dairy",
        categoryOrder: 5,
        sources: recipeIds.map((recipeId) => ({
          recipeId,
          recipeUuid: recipeId,
          recipeName: `Recipe ${recipeId.toUpperCase()}`,
        })) as never,
        contributionKey: "milk",
        derivedQuantity: { amount, unit: "cup" },
      },
    ],
    already_have: [],
    excluded: [],
    source_recipes: recipeIds,
    source_recipe_uuids: recipeIds,
    scale: 1,
    total_servings: recipeIds.length * 4,
    custom_order: false,
    generated_at: "2026-07-14T00:00:00.000Z",
    contribution_revision: revision,
    contribution_overrides: {},
    legacy_items_preserved: true,
  }
}

const states = [
  {
    list: currentList([RECIPE_A], 1, 0),
    contributions: [storedContribution(RECIPE_A, 1)],
  },
  {
    list: currentList([RECIPE_A, RECIPE_C], 5, 1),
    contributions: [
      storedContribution(RECIPE_A, 1),
      storedContribution(RECIPE_C, 4),
    ],
  },
]

const supabaseMock = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: { id: "user-a" } },
      error: null,
    })),
  },
  from: vi.fn((table: string) => {
    if (table === "pantry_items") {
      return { select: async () => ({ data: [], error: null }) }
    }
    if (table === "user_config") {
      return {
        select: () => ({
          maybeSingle: async () => ({
            data: {
              excluded_keywords: [],
              category_overrides: {},
              shopping_item_order: {},
            },
            error: null,
          }),
        }),
      }
    }
    if (table === "recipes") {
      return {
        select: () => ({
          in: () => ({
            eq: async () => ({ data: [recipeB], error: null }),
          }),
        }),
      }
    }
    throw new Error(`Unexpected table ${table}`)
  }),
  rpc: rpcMock,
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseMock,
}))

import { POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  rpcAttempt = 0
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  rpcMock.mockImplementation(async (functionName, args) => {
    if (functionName === "get_recipe_shopping_contribution_state") {
      const state = states[Math.min(rpcAttempt, states.length - 1)]
      return {
        data: {
          shopping_list: state.list,
          contributions: state.contributions,
        },
        error: null,
      }
    }

    if (rpcAttempt === 0) {
      rpcAttempt += 1
      return {
        data: null,
        error: {
          code: "40001",
          message: "shopping contribution revision conflict",
        },
      }
    }

    return {
      data: {
        outcome: "applied",
        shopping_list: {
          ...states[1].list,
          ...args.p_projection,
          contribution_revision: 2,
          contribution_overrides: args.p_contribution_overrides,
        },
      },
      error: null,
    }
  })
})

describe("recipe contribution command route", () => {
  it("retries a revision conflict from fresh state so concurrent distinct contributions survive", async () => {
    const request = new Request("http://localhost/api/shopping/recipe-contributions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipeIds: [RECIPE_B],
        scale: 0.75,
        scaleV1: { numerator: "3", denominator: "4" },
        idempotencyKey: "concurrent-add-b",
      }),
    })

    const response = await POST(request)
    const result = await response.json()

    expect(response.status).toBe(200)
    const writeCalls = rpcMock.mock.calls.filter(
      ([functionName]) => functionName === "apply_recipe_shopping_contribution_uuid_command"
    )
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls[0][1].p_expected_revision).toBe(0)
    expect(writeCalls[1][1].p_expected_revision).toBe(1)
    expect(writeCalls[1][1].p_projection.source_recipe_uuids).toEqual([
      RECIPE_A,
      RECIPE_B,
      RECIPE_C,
    ])
    expect(writeCalls[1][1].p_projection.items[0].amount).toBe(6.5)
    expect(result.shopping_list.items[0].amount).toBe(6.5)
    const recipeBContribution = writeCalls[1][1].p_contributions[0].snapshot
    expect(recipeBContribution.exactScaleV1).toEqual({
      numerator: "3",
      denominator: "4",
    })
    expect(recipeBContribution.items[0].sources[0]).toMatchObject({
      exactScaleV1: { numerator: "3", denominator: "4" },
      exactQuantityV1: {
        version: 1,
        kind: "exact",
        value: { numerator: "3", denominator: "2" },
      },
    })
  })
})
