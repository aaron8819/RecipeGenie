import { describe, expect, it, vi } from "vitest"
import {
  createEmptyShoppingDocument,
  projectShoppingDocument,
  type ShoppingDocumentStateV3,
} from '../shopping-document'
import {
  persistShoppingMutationWithReplay,
  ShoppingDocumentConflictError,
} from "../shopping-document-persistence"

function state(revision: number): ShoppingDocumentStateV3 {
  return { document: createEmptyShoppingDocument(), contentRevision: revision }
}

function frozenRecipeState(revision: number): ShoppingDocumentStateV3 {
  const result = state(revision)
  const purchaseKey = 'finely chopped cilantro'
  const aggregateKey = JSON.stringify([
    'shopping-aggregate',
    2,
    purchaseKey,
  ])
  result.document.recipeEntries['recipe-frozen'] = {
    recipeId: 'recipe-frozen',
    recipeName: 'Frozen cilantro',
    selectedServings: 1,
    scaleV1: { numerator: '1', denominator: '1' },
    ingredients: [{
      purchaseKey,
      aggregateKey,
      displayName: purchaseKey,
      quantity: { amount: 1.25, unit: 'count' },
      familyKey: purchaseKey,
      preparation: [],
      purchaseUnit: 'count',
      quantityKind: 'continuous',
      defaultCategoryKey: 'produce',
      pantryMatchKeys: [purchaseKey],
      familyMatchPolicy: {},
    }],
  }
  return result
}

const mutation = {
  type: "addManualItem" as const,
  item: {
    id: "manual-a",
    displayName: "paper towels",
    quantity: null,
    categoryKey: "misc",
    bucket: "items" as const,
    checked: false,
  },
}

describe("Shopping document CAS persistence", () => {
  it("writes the expected revision once on an uncontended mutation", async () => {
    const write = vi.fn(async (_current, next) => next)
    const result = await persistShoppingMutationWithReplay({
      initial: state(3),
      mutation,
      write,
      refetch: vi.fn(),
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].contentRevision).toBe(3)
    expect(write.mock.calls[0][1].contentRevision).toBe(4)
    expect(result.document.manualItems).toHaveLength(1)
  })

  it('persists an unrelated mutation without regenerating frozen semantics', async () => {
    const initial = frozenRecipeState(3)
    const frozenEntry = JSON.parse(JSON.stringify(
      initial.document.recipeEntries['recipe-frozen']
    ))
    const write = vi.fn(async (_current, next) =>
      JSON.parse(JSON.stringify(next)))

    const result = await persistShoppingMutationWithReplay({
      initial,
      mutation,
      write,
      refetch: vi.fn(),
    })

    expect(write).toHaveBeenCalledTimes(1)
    expect(result.document.recipeEntries['recipe-frozen']).toEqual(frozenEntry)
    expect(result.document.manualItems).toHaveLength(1)
    expect(projectShoppingDocument(result.document).items[0].quantity)
      .toMatchObject({ amount: 1.25, unit: 'count' })
  })

  it("refetches, replays, and retries exactly once after a conflict", async () => {
    const fresh = state(9)
    const write = vi.fn()
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (_current, next) => next)
    const onRefetched = vi.fn()

    const result = await persistShoppingMutationWithReplay({
      initial: state(3),
      mutation,
      write,
      refetch: async () => fresh,
      onRefetched,
    })

    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][0]).toBe(fresh)
    expect(result.contentRevision).toBe(10)
    expect(onRefetched).toHaveBeenCalledWith(fresh)
  })

  it("fails visibly after a second conflict", async () => {
    await expect(persistShoppingMutationWithReplay({
      initial: state(1),
      mutation,
      write: vi.fn().mockResolvedValue(null),
      refetch: async () => state(2),
    })).rejects.toBeInstanceOf(ShoppingDocumentConflictError)
  })

  it("can force a CAS write for an atomic side effect even when the reducer is a no-op", async () => {
    const write = vi.fn(async (_current, next) => next)
    const initial = state(4)
    await persistShoppingMutationWithReplay({
      initial,
      mutation: { type: "setBucketOverride", aggregateKey: "missing", bucket: undefined },
      write,
      refetch: vi.fn(),
      forceWrite: true,
    })

    expect(write).toHaveBeenCalledWith(initial, initial)
  })

  it("round-trips an explicit checked intent through persistence and projection", async () => {
    const initial = state(6)
    initial.document.manualItems.push({
      id: "manual-a",
      displayName: "paper towels",
      quantity: null,
      categoryKey: "misc",
      bucket: "items",
      checked: false,
    })

    const persisted = await persistShoppingMutationWithReplay({
      initial,
      mutation: {
        type: "setChecked",
        rowRef: "manual:manual-a",
        checked: true,
      },
      write: async (_current, next) => JSON.parse(JSON.stringify(next)),
      refetch: vi.fn(),
    })

    expect(persisted.contentRevision).toBe(7)
    expect(projectShoppingDocument(persisted.document).rows[0]).toMatchObject({
      rowRef: "manual:manual-a",
      checked: true,
    })
  })
})
