import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ShoppingList, ShoppingItem, PantryItem } from '@/types/database'
import { pantryKeys, shoppingKeys } from '@/lib/query-keys'
import {
  useAddToPantryAndRemove,
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
} from '@/hooks/shopping'

// --- Mocks ---

vi.mock('@/lib/auth-context', () => ({
  useAuthContext: vi.fn(() => ({ user: { id: 'test-user-id' } })),
}))

const SHOPPING_KEY = shoppingKeys.detail('test-user-id')
const PANTRY_KEY = pantryKeys.list('test-user-id')

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  rpc: vi.fn(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
}

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: vi.fn(() => mockSupabase),
}))

// --- Helpers ---

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
  return { wrapper: Wrapper, queryClient }
}

function makeItem(item: string, overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    rowId: `row-${item}-${overrides.unit || 'cup'}-${overrides.amount ?? 1}`,
    item,
    amount: 1,
    unit: 'cup',
    categoryKey: 'produce',
    categoryOrder: 1,
    sources: [{ recipeName: 'Test Recipe' }],
    checked: false,
    ...overrides,
  }
}

function makeList(overrides: Partial<ShoppingList> = {}): ShoppingList {
  return {
    user_id: 'test-user-id',
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1.0,
    total_servings: 4,
    custom_order: false,
    generated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSupabase.from.mockReturnThis()
  mockSupabase.rpc.mockResolvedValue({
    data: [{
      removed_item: { rowId: 'row-garlic-cup-1', item: 'garlic', amount: 1, unit: 'cup', categoryKey: 'produce', categoryOrder: 1 },
      pantry_item: { id: 'pantry-garlic', user_id: 'test-user-id', item: 'garlic', created_at: new Date().toISOString() },
      shopping_list_updated_at: new Date().toISOString(),
      pantry_was_inserted: true,
    }],
    error: null,
  })
  mockSupabase.select.mockReturnThis()
  mockSupabase.update.mockReturnThis()
  mockSupabase.insert.mockReturnThis()
  mockSupabase.delete.mockReturnThis()
  // Terminal calls — default to success
  // single() is terminal for reads and pantry inserts
  // eq() is terminal for updates (await mockSupabase resolves to mockSupabase which has no .error)
  mockSupabase.single.mockResolvedValue({ data: null, error: null })
  mockSupabase.maybeSingle.mockResolvedValue({ data: null, error: null })
  mockSupabase.eq.mockResolvedValue({ data: null, error: null })
})

// --- Tests ---

describe('useAddToPantryAndRemove', () => {
  it('happy path removes correct item index and adds pantry item', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [
          makeItem('garlic', { rowId: 'row-garlic-cup', unit: 'cup' }),
          makeItem('onion', { rowId: 'row-onion-cup', unit: 'cup' }),
          makeItem('garlic', { rowId: 'row-garlic-tbsp', unit: 'tbsp' }),
        ],
        already_have: [],
      })
    )
    queryClient.setQueryData([...PANTRY_KEY], [] as PantryItem[])

    const { result } = renderHook(() => useAddToPantryAndRemove(), { wrapper })
    const input = makeItem('garlic', { rowId: 'row-garlic-tbsp', unit: 'tbsp' })

    result.current.mutate(input)

    await waitFor(() => {
      const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      expect(cached?.items).toHaveLength(2)
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('move_shopping_item_to_pantry', {
      p_row_id: 'row-garlic-tbsp',
      p_pantry_qty: 1,
      p_pantry_unit: 'tbsp',
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.map((i) => i.item)).toEqual(['garlic', 'onion'])
    expect(cached?.already_have).toHaveLength(1)
    expect(cached?.already_have[0].item).toBe('garlic')

    const pantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY])
    expect(pantry?.some((p) => p.item === 'garlic')).toBe(true)
  })

  it('item mismatch surfaces an error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('onion')], already_have: [] })
    )
    queryClient.setQueryData([...PANTRY_KEY], [] as PantryItem[])

    const { result } = renderHook(() => useAddToPantryAndRemove(), { wrapper })

    result.current.mutate(makeItem('garlic'))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('duplicate pantry merge behavior remains unchanged (no pantry duplicates)', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [makeItem('garlic')],
        already_have: [makeItem('garlic')],
      })
    )
    queryClient.setQueryData(
      [...PANTRY_KEY],
      [{ id: 'pantry-garlic', user_id: 'test-user-id', item: 'garlic', created_at: '2026-01-01T00:00:00.000Z' }] as PantryItem[]
    )
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{
        removed_item: { rowId: 'row-garlic-cup-1', item: 'garlic', amount: 1, unit: 'cup', categoryKey: 'produce', categoryOrder: 1 },
        pantry_item: { id: 'pantry-garlic', user_id: 'test-user-id', item: 'garlic', created_at: '2026-01-01T00:00:00.000Z' },
        shopping_list_updated_at: new Date().toISOString(),
        pantry_was_inserted: false,
      }],
      error: null,
    })

    const { result } = renderHook(() => useAddToPantryAndRemove(), { wrapper })

    result.current.mutate(makeItem('garlic'))

    await waitFor(() =>
      expect(result.current.isSuccess || result.current.isError).toBe(true)
    )

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.already_have).toHaveLength(1)

    const pantry = queryClient.getQueryData<PantryItem[]>([...PANTRY_KEY]) || []
    expect(pantry.filter((p) => p.item === 'garlic')).toHaveLength(1)
  })

  it('passes rowId to the RPC when duplicate names exist', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [
          makeItem('garlic', { rowId: 'row-garlic-clove', unit: 'clove' }),
          makeItem('garlic', { rowId: 'row-garlic-bulb', unit: 'bulb' }),
        ],
        already_have: [],
      })
    )
    queryClient.setQueryData([...PANTRY_KEY], [] as PantryItem[])

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{
        removed_item: { rowId: 'row-garlic-bulb', item: 'garlic', amount: 1, unit: 'bulb', categoryKey: 'produce', categoryOrder: 1 },
        pantry_item: { id: 'pantry-garlic', user_id: 'test-user-id', item: 'garlic', created_at: new Date().toISOString() },
        shopping_list_updated_at: new Date().toISOString(),
        pantry_was_inserted: true,
      }],
      error: null,
    })

    const { result } = renderHook(() => useAddToPantryAndRemove(), { wrapper })

    result.current.mutate(makeItem('garlic', { rowId: 'row-garlic-bulb', unit: 'bulb' }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mockSupabase.rpc).toHaveBeenCalledWith('move_shopping_item_to_pantry', {
      p_row_id: 'row-garlic-bulb',
      p_pantry_qty: 1,
      p_pantry_unit: 'bulb',
    })
  })
})

describe('useMoveToShoppingList', () => {
  it('should immediately move item from already_have to items', async () => {
    // Regression: this hook lacked onMutate, causing UI delay on restore click.
    // Verify the cache is updated before the mutationFn settles.
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [makeItem('onion')],
        already_have: [makeItem('garlic')],
      })
    )

    const { result } = renderHook(() => useMoveToShoppingList(), { wrapper })

    result.current.mutate(makeItem('garlic'))

    await waitFor(() => {
      const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      // garlic should be in items now
      expect(cached?.items.some((i) => i.item === 'garlic')).toBe(true)
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(2)
    expect(cached?.already_have).toHaveLength(0)
  })

  it('should not duplicate item in items if it is already there', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [makeItem('garlic')],
        already_have: [makeItem('garlic')],
      })
    )

    const { result } = renderHook(() => useMoveToShoppingList(), { wrapper })

    result.current.mutate(makeItem('garlic'))

    await waitFor(() =>
      expect(result.current.isSuccess || result.current.isError).toBe(true)
    )

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1) // not duplicated
    expect(cached?.already_have).toHaveLength(0)
  })

  it('should roll back cache on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [],
        already_have: [makeItem('garlic')],
      })
    )

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: 'fail', code: 'ERR' },
    })

    const { result } = renderHook(() => useMoveToShoppingList(), { wrapper })

    result.current.mutate(makeItem('garlic'))

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(0) // garlic not moved
    expect(cached?.already_have).toHaveLength(1) // garlic still in already_have
  })
})

describe('useMoveExcludedToShoppingList', () => {
  it('should immediately move item from excluded to items', async () => {
    // Regression: this hook lacked onMutate, causing UI delay on restore click.
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [],
        excluded: [makeItem('pepper', { excludedBy: 'pepper' })],
      })
    )

    const { result } = renderHook(() => useMoveExcludedToShoppingList(), { wrapper })

    result.current.mutate(makeItem('pepper', { excludedBy: 'pepper' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
      expect(cached?.items.some((i) => i.item === 'pepper')).toBe(true)
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1)
    expect(cached?.excluded).toHaveLength(0)
  })

  it('should not duplicate item in items if it is already there', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [makeItem('pepper')],
        excluded: [makeItem('pepper', { excludedBy: 'pepper' })],
      })
    )

    const { result } = renderHook(() => useMoveExcludedToShoppingList(), { wrapper })

    result.current.mutate(makeItem('pepper', { excludedBy: 'pepper' }))

    await waitFor(() =>
      expect(result.current.isSuccess || result.current.isError).toBe(true)
    )

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1) // not duplicated
    expect(cached?.excluded).toHaveLength(0)
  })

  it('should roll back cache on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [],
        excluded: [makeItem('pepper', { excludedBy: 'pepper' })],
      })
    )

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: 'fail', code: 'ERR' },
    })

    const { result } = renderHook(() => useMoveExcludedToShoppingList(), { wrapper })

    result.current.mutate(makeItem('pepper', { excludedBy: 'pepper' }))

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(0) // pepper not moved
    expect(cached?.excluded).toHaveLength(1) // pepper still in excluded
  })
})

