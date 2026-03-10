import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { PantryItem } from "@/types/database"
import {
  PANTRY_KEY,
  useAddPantryItems,
  useRemovePantryItem,
  useRestorePantryItem,
} from "@/hooks/use-pantry"

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: vi.fn(() => ({ user: { id: "user-1" } })),
}))

let insertResponses: Array<{ data: PantryItem | null; error: { code?: string; message: string } | null }> = []
let pantryRows: PantryItem[] = []

const mockSupabase = {
  from: vi.fn(() => ({
    insert: (value: { id?: string; user_id: string; item: string }) => ({
      select: () => ({
        single: async () => {
          const response = insertResponses.shift()
          if (response) {
            if (!response.error && response.data) {
              pantryRows.push(response.data)
            }
            return response
          }

          const inserted = {
            id: value.id || `pantry-${value.item}`,
            user_id: value.user_id,
            item: value.item,
            created_at: new Date().toISOString(),
          }
          pantryRows.push(inserted)
          return { data: inserted, error: null }
        },
      }),
    }),
    delete: () => ({
      eq: () => ({
        eq: async (_column: string, id: string) => {
          pantryRows = pantryRows.filter((row) => row.id !== id)
          return { error: null }
        },
      }),
    }),
    select: () => ({
      eq: () => ({
        eq: () => ({
          single: async () => ({ data: pantryRows[0] ?? null, error: null }),
        }),
      }),
      order: async () => ({ data: pantryRows, error: null }),
    }),
  })),
}

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: vi.fn(() => mockSupabase),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  return { wrapper: Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  insertResponses = []
  pantryRows = []
})

describe("useAddPantryItems", () => {
  it("classifies success, duplicate, and failure outcomes deterministically", async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<PantryItem[]>([...PANTRY_KEY], [
      { id: "pantry-pepper", user_id: "user-1", item: "pepper", created_at: "2026-01-01T00:00:00.000Z" },
    ])

    insertResponses = [
      {
        data: { id: "pantry-garlic", user_id: "user-1", item: "garlic", created_at: "2026-01-01T00:00:00.000Z" },
        error: null,
      },
      {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
      {
        data: null,
        error: { message: "insert failed" },
      },
    ]

    const { result } = renderHook(() => useAddPantryItems(), { wrapper })
    const addResult = await result.current.mutateAsync("Garlic, pepper, onion, salt")

    expect(addResult.outcomes.map((outcome) => outcome.status)).toEqual([
      "success",
      "duplicate",
      "duplicate",
      "failure",
    ])
    expect(addResult.unresolvedInput).toBe("salt")

    const pantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY]) || []
    expect(pantry.some((item) => item.id === "pantry-garlic")).toBe(true)
    expect(pantry.filter((item) => item.item === "pepper")).toHaveLength(1)
  })
})

describe("Pantry id-based mutations", () => {
  it("optimistically removes and restores the exact pantry row id", async () => {
    const { wrapper, queryClient } = createWrapper()
    const pantryItem: PantryItem = {
      id: "pantry-garlic",
      user_id: "user-1",
      item: "garlic",
      created_at: "2026-01-01T00:00:00.000Z",
    }

    pantryRows = [pantryItem]
    queryClient.setQueryData<PantryItem[]>([...PANTRY_KEY], [pantryItem])

    const { result: removeResult } = renderHook(() => useRemovePantryItem(), { wrapper })
    removeResult.current.mutate(pantryItem)

    await waitFor(() => {
      const pantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY]) || []
      expect(pantry.some((item) => item.id === pantryItem.id)).toBe(false)
    })

    const { result: restoreResult } = renderHook(() => useRestorePantryItem(), { wrapper })
    restoreResult.current.mutate(pantryItem)

    await waitFor(() => {
      const pantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY]) || []
      expect(pantry.some((item) => item.id === pantryItem.id)).toBe(true)
    })
  })
})
