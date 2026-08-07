import { describe, expect, it, vi } from "vitest"
import { createEmptyShoppingDocument, type ShoppingDocumentStateV1 } from "../shopping-document"
import {
  persistShoppingMutationWithReplay,
  ShoppingDocumentConflictError,
} from "../shopping-document-persistence"

function state(revision: number): ShoppingDocumentStateV1 {
  return { document: createEmptyShoppingDocument(), contentRevision: revision }
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
})
