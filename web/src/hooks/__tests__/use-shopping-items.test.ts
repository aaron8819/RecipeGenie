import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ShoppingList, ShoppingItem } from '@/types/database'
import { SHOPPING_KEY } from '@/hooks/shopping/shared'
import {
  useCheckOffItem,
  useRemoveShoppingItem,
  useAddShoppingItem,
} from '@/hooks/shopping'

vi.mock('@/lib/auth-context', () => ({
  useAuthContext: vi.fn(() => ({ user: { id: 'test-user-id' } })),
}))

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  rpc: vi.fn(),
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
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null })
  mockSupabase.select.mockReturnThis()
  mockSupabase.update.mockReturnThis()
  mockSupabase.insert.mockReturnThis()
  mockSupabase.delete.mockReturnThis()
  mockSupabase.single.mockResolvedValue({ data: null, error: null })
  mockSupabase.eq.mockResolvedValue({ data: null, error: null })
})

describe('useCheckOffItem', () => {
  it('toggling once flips state', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: false })] })
    )

    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ item_name: 'milk', checked: true, updated_at: new Date().toISOString() }],
      error: null,
    })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(makeItem('milk', { checked: false }))
    })

    expect(mockSupabase.rpc).toHaveBeenCalledWith('toggle_shopping_item_checked', {
      p_item_name: 'milk',
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(true)
  })

  it('toggling twice returns original state', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: false })] })
    )

    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{ item_name: 'milk', checked: true, updated_at: new Date().toISOString() }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ item_name: 'milk', checked: false, updated_at: new Date().toISOString() }],
        error: null,
      })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(makeItem('milk', { checked: false }))
      await result.current.mutateAsync(makeItem('milk', { checked: true }))
    })

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items.find((i) => i.item === 'milk')?.checked).toBe(false)
  })

  it('concurrent toggles resolve to last write deterministically', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk', { checked: false })] })
    )

    mockSupabase.rpc
      .mockResolvedValueOnce({
        data: [{ item_name: 'milk', checked: true, updated_at: '2026-01-01T00:00:00.000Z' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ item_name: 'milk', checked: false, updated_at: '2026-01-01T00:00:01.000Z' }],
        error: null,
      })

    const { result } = renderHook(() => useCheckOffItem(), { wrapper })
    await act(async () => {
      await Promise.all([
        result.current.mutateAsync(makeItem('milk', { checked: false })),
        result.current.mutateAsync(makeItem('milk', { checked: true })),
      ])
    })

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

    result.current.mutate('garlic')

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

    result.current.mutate({ itemName: 'Milk' })

    await waitFor(() =>
      expect(result.current.isSuccess || result.current.isError).toBe(true)
    )

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1)
  })

  it('should roll back optimistic add on error', async () => {
    const { wrapper, queryClient } = createWrapper()
    queryClient.setQueryData(
      [...SHOPPING_KEY],
      makeList({ items: [makeItem('milk')] })
    )

    mockSupabase.single
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'fail', code: 'ERR' } })

    const { result } = renderHook(() => useAddShoppingItem(), { wrapper })

    result.current.mutate({ itemName: 'eggs' })

    await waitFor(() => expect(result.current.isError).toBe(true))

    const cached = queryClient.getQueryData<ShoppingList>([...SHOPPING_KEY])
    expect(cached?.items).toHaveLength(1)
    expect(cached?.items[0].item).toBe('milk')
  })
})
