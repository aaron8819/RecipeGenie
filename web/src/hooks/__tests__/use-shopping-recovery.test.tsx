import type { ReactNode } from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useShoppingList, useClearShoppingList, useAddShoppingItem,
  useRemoveRecipeItems, useAddToPantryAndRemove, ShoppingDocumentReadError } from '../shopping/use-shopping-document'
import { createEmptyShoppingDocument } from '@/lib/shopping-document'
import { pantryKeys, shoppingKeys } from '@/lib/query-keys'

const db = vi.hoisted(() => ({ document: null as unknown, revision: 0,
  shoppingError: false, pantryError: false, reads: 0, pantryReads: 0,
  writes: vi.fn(), bridge: vi.fn() }))
vi.mock('@/lib/auth-context', () => ({ useAuthContext: () => ({ user: { id: 'owner' }, loading: false }) }))
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show: vi.fn() }) }))
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => ({
  rpc: db.bridge,
  from: (table: string) => {
    if (table === 'pantry_items') return { select: () => ({ order: async () => {
      db.pantryReads++
      return db.pantryError ? { data: null, error: new Error('offline') } :
        { data: [{ id: 'rice', user_id: 'owner', item: 'rice' }], error: null }
    } }) }
    const read = { eq: () => read, single: async () => {
      db.reads++
      return db.shoppingError ? { data: null, error: new Error('offline') } :
        { data: { document: db.document, content_revision: db.revision }, error: null }
    } }
    return { select: () => read, update: (values: { document: unknown; content_revision: number }) => {
      db.writes(values)
      const write = { eq: () => write, select: () => write, maybeSingle: async () => {
        db.document = values.document
        db.revision = values.content_revision
        return { data: values, error: null }
      } }
      return write
    } }
  },
}) }))

let client: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
const selectionId = '10000000-0000-4000-8000-000000000001'
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
  db.document = createEmptyShoppingDocument()
  db.revision = 0
  db.shoppingError = db.pantryError = false
  db.reads = db.pantryReads = 0
  db.writes.mockClear(); db.bridge.mockClear()
})
afterEach(() => { cleanup(); client.clear() })

describe('Shopping dependency recovery', () => {
  it('distinguishes initial loading from a successfully loaded empty document without writing', async () => {
    const { result } = renderHook(useShoppingList, { wrapper })
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.canAddItem).toBe(true))
    expect(result.current.data?.items).toEqual([])
    expect(db.writes).not.toHaveBeenCalled()
  })

  it.each(['read failure', 'unsupported', 'malformed'])('%s never becomes a writable empty list', async (kind) => {
    if (kind === 'read failure') db.shoppingError = true
    else db.document = kind === 'unsupported' ? { version: 999 } : { version: 3, recipeEntries: [] }
    const before = structuredClone(db.document)
    const { result } = renderHook(() => ({ list: useShoppingList(), add: useAddShoppingItem() }), { wrapper })
    await waitFor(() => expect(result.current.list.documentError).toBeTruthy())
    expect(result.current.list.data).toBeUndefined()
    expect(result.current.list.canAddItem).toBe(false)
    if (kind !== 'read failure') expect(result.current.list.documentError).toBeInstanceOf(ShoppingDocumentReadError)
    await act(async () => {
      await expect(result.current.add.mutateAsync({ itemName: 'bread', rowId: 'bread' })).rejects.toThrow()
    })
    expect(db.document).toEqual(before)
    expect(db.writes).not.toHaveBeenCalled()
    db.shoppingError = false; db.document = createEmptyShoppingDocument()
    await act(async () => { await result.current.list.retryDocument() })
    await waitFor(() => expect(result.current.list.canAddItem).toBe(true))
    expect(result.current.list.data?.items).toEqual([])
    expect(db.writes).not.toHaveBeenCalled()
  })

  it('retains selections during Pantry failure, permits removal and retries only Pantry', async () => {
    const document = createEmptyShoppingDocument()
    document.recipeEntries[selectionId] = { recipeId: selectionId, recipeName: 'Manual',
      selectedServings: 4, scaleV1: { numerator: '1', denominator: '1' }, ingredients: [] }
    db.document = document; db.pantryError = true
    const { result } = renderHook(() => ({ list: useShoppingList(), remove: useRemoveRecipeItems(), add: useAddShoppingItem() }), { wrapper })
    await waitFor(() => expect(result.current.list.pantryError).toBeTruthy())
    expect(result.current.list.data).toBeUndefined()
    expect(result.current.list.selections.map(entry => entry.recipeId)).toEqual([selectionId])
    await act(async () => {
      await expect(result.current.add.mutateAsync({ itemName: 'rice', rowId: 'rice' })).rejects.toThrow()
    })
    expect(db.writes).not.toHaveBeenCalled()
    await act(async () => { await result.current.remove.mutateAsync({ recipeId: selectionId, recipeName: 'Manual' }) })
    expect(db.writes).toHaveBeenCalledTimes(1)
    const reads = db.reads
    db.pantryError = false
    await act(async () => { await result.current.list.retryPantry() })
    await waitFor(() => expect(result.current.list.canAddItem).toBe(true))
    expect(result.current.list.selections).toEqual([])
    expect(db.reads).toBe(reads)
    expect(db.writes).toHaveBeenCalledTimes(1)
  })

  it('labels cached Shopping failure and protects every write seam until recovery', async () => {
    const { result } = renderHook(() => ({ list: useShoppingList(), clear: useClearShoppingList(), bridge: useAddToPantryAndRemove() }), { wrapper })
    await waitFor(() => expect(result.current.list.canAddItem).toBe(true))
    db.document = { version: 999 }
    await act(async () => { await result.current.list.retryDocument() })
    expect(result.current.list.hasDocument).toBe(true)
    await waitFor(() => expect(result.current.list.documentError).toBeInstanceOf(ShoppingDocumentReadError))
    expect(result.current.list.data).toBeDefined()
    await act(async () => {
      await expect(result.current.clear.mutateAsync()).rejects.toThrow()
      await expect(result.current.bridge.mutateAsync({ rowId: 'manual:bread', item: 'bread', amount: null,
        unit: '', categoryKey: 'misc', categoryOrder: 1 })).rejects.toThrow()
    })
    expect(db.writes).not.toHaveBeenCalled(); expect(db.bridge).not.toHaveBeenCalled()
    expect(client.getQueryState(shoppingKeys.detail('owner'))?.status).toBe('error')
  })

  it('does not use a failed cached Pantry snapshot to authorize manual additions', async () => {
    const { result } = renderHook(() => ({ list: useShoppingList(), add: useAddShoppingItem() }), { wrapper })
    await waitFor(() => expect(result.current.list.canAddItem).toBe(true))
    db.pantryError = true
    await act(async () => { await result.current.list.retryPantry() })
    expect(result.current.list.hasPantry).toBe(true)
    await waitFor(() => expect(result.current.list.pantryError).toBeTruthy())
    expect(result.current.list.data).toBeDefined()
    await act(async () => {
      await expect(result.current.add.mutateAsync({ itemName: 'rice', rowId: 'rice' })).rejects.toThrow()
    })
    expect(client.getQueryState(pantryKeys.list('owner'))?.status).toBe('error')
    expect(db.writes).not.toHaveBeenCalled()
  })
})
