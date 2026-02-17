import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ShoppingList, ShoppingItem } from '@/types/database'
import { SHOPPING_KEY } from '@/hooks/shopping/shared'
import {
  useCheckOffItem,
  useRemoveShoppingItem,
  useAddShoppingItem,
} from '@/hooks/shopping'

// --- Mocks ---

vi.mock('@/lib/auth-context', () => ({
  useAuthContext: vi.fn(() => ({ user: { id: 'test-user-id' } })),
}))

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  single: vi.fn(),
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
  mockSupabase.select.mockReturnThis()
  mockSupabase.update.mockReturnThis()
  mockSupabase.insert.mockReturnThis()
  mockSupabase.delete.mockReturnThis()
  // Default: terminal calls succeed
  // .select(...).single() — used for reads
  // .update({...}).eq(...) — used for writes (eq is terminal)
  mockSupabase.single.mockResolvedValue({ data: null, error: null })
  mockSupabase.eq.mockResolvedValue({ data: null, error: null })
})

// --- Tests ---

describe('useCheckOffItem', () => {
  it('should optimistically toggle the target item from unchecked to checked', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: false })] })
    )

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })

    result.current.mutate(makeItem('milk', { checked: false }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(true)
  })

  it('should optimistically toggle the target item from checked to unchecked', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: true })] })
    )

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })

    result.current.mutate(makeItem('milk', { checked: true }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(false)
  })

  it('should use case-insensitive name match for optimistic update', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('Whole Milk', { checked: false })] })
    )

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })

    // mutate with lowercase — should still match 'Whole Milk' in cache
    result.current.mutate(makeItem('whole milk', { checked: false }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items[0].checked).toBe(true)
  })

  it('should only modify the target item — unrelated items remain unchanged', async () => {
    // Regression test: previously, isPending was used to disable ALL checkboxes,
    // meaning a mutation on 'milk' would affect the whole list state.
    // The optimistic update must be item-scoped, not list-wide.
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({
        items: [
          makeItem('milk', { checked: false }),
          makeItem('eggs', { checked: false }),
          makeItem('bread', { checked: false }),
          makeItem('butter', { checked: false }),
          makeItem('cheese', { checked: false }),
        ],
      })
    )

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })

    result.current.mutate(makeItem('milk', { checked: false }))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(true)
    expect(cached?.items.find((i) => i.item === 'eggs')?.checked).toBe(false)
    expect(cached?.items.find((i) => i.item === 'bread')?.checked).toBe(false)
    expect(cached?.items.find((i) => i.item === 'butter')?.checked).toBe(false)
    expect(cached?.items.find((i) => i.item === 'cheese')?.checked).toBe(false)
  })

  it('should roll back cache to original state on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: false })] })
    )

    // Fail the Supabase fetch in mutationFn
    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: 'network error', code: 'NETWORK_ERROR' },
    })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })

    result.current.mutate(makeItem('milk', { checked: false }))

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(false)
  })
})

describe('useRemoveShoppingItem', () => {
  it('should optimistically remove only the target item from cache', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('garlic'), makeItem('onion')] })
    )

    const { result } = renderHook(() => useRemoveShoppingItem(), { wrapper })

    result.current.mutate('garlic')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1)
    expect(cached?.items[0].item).toBe('onion')
  })

  it('should use case-insensitive match when removing item', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('Garlic')] })
    )

    const { result } = renderHook(() => useRemoveShoppingItem(), { wrapper })

    result.current.mutate('garlic') // lowercase — should match 'Garlic'

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(0)
  })

  it('should roll back cache on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('garlic'), makeItem('onion')] })
    )

    mockSupabase.single.mockResolvedValue({
      data: null,
      error: { message: 'fail', code: 'ERR' },
    })

    const { result } = renderHook(() => useRemoveShoppingItem(), { wrapper })

    result.current.mutate('garlic')

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(2)
  })
})

describe('useAddShoppingItem', () => {
  it('should optimistically add new item to cache', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk')] })
    )

    const { result } = renderHook(() => useAddShoppingItem(), { wrapper })

    result.current.mutate({ itemName: 'eggs' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(2)
    expect(cached?.items.some((i) => i.item === 'eggs')).toBe(true)
  })

  it('should not add duplicate item optimistically (case-insensitive)', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk')] })
    )

    const { result } = renderHook(() => useAddShoppingItem(), { wrapper })

    result.current.mutate({ itemName: 'Milk' }) // uppercase — duplicate of 'milk'

    // Mutation will fail in mutationFn (duplicate check) — wait for it to settle
    await waitFor(() =>
      expect(result.current.isSuccess || result.current.isError).toBe(true)
    )

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1) // no duplicate added
  })

  it('should roll back optimistic add on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk')] })
    )

    // onMutate makes a user_config fetch (single #1), mutationFn makes user_config (single #2)
    // then shopping_list fetch (single #3 — this one fails to trigger rollback)
    mockSupabase.single
      .mockResolvedValueOnce({ data: null, error: null }) // onMutate: user_config
      .mockResolvedValueOnce({ data: null, error: null }) // mutationFn: user_config
      .mockResolvedValueOnce({ data: null, error: { message: 'fail', code: 'ERR' } }) // mutationFn: shopping_list

    const { result } = renderHook(() => useAddShoppingItem(), { wrapper })

    result.current.mutate({ itemName: 'eggs' })

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1) // rolled back — eggs removed
    expect(cached?.items[0].item).toBe('milk')
  })
})
