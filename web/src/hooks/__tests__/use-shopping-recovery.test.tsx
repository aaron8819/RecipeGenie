import { setActivePrincipalId } from '@/lib/principal-session'
import { runHookCommand } from '@/test/shopping-hook-command-mock'
import type { ShoppingCommand } from '@/lib/shopping-command'
import type { ShoppingDocumentV3 } from '@/lib/shopping-document'
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
vi.mock('@/lib/shopping-command-client', () => ({
  executeShoppingCommand: async (_owner: string, command: ShoppingCommand) => {
    if (command.mutation.type === 'pantry') {
      const result = await db.bridge()
      if (result.error) throw result.error
      const row = result.data[0]
      db.document = row.document; db.revision = row.content_revision
      return { status: 'Applied', receipt: { outcome: 'Applied', revision: db.revision,
        pantryId: row.pantry_item.id, pantryWasAdded: row.pantry_was_inserted } }
    }
    return runHookCommand(command, () => ({ document: db.document as ShoppingDocumentV3,
      contentRevision: db.revision }), async (_before, next) => {
      db.writes({ document: next.document, content_revision: next.contentRevision })
      db.document = next.document; db.revision = next.contentRevision
      return true
    })
  },
}))
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
    const read = { eq: () => read, maybeSingle: async () => {
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
  setActivePrincipalId('owner')
  client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
  db.document = createEmptyShoppingDocument()
  db.revision = 0
  db.shoppingError = db.pantryError = false
  db.reads = db.pantryReads = 0
  db.writes.mockClear(); db.bridge.mockClear()
})
afterEach(() => { cleanup(); client.clear() })

describe('Shopping dependency recovery', () => {
  it('keeps a confirmed Pantry move successful when the following Shopping read fails', async () => {
    client.setQueryData(shoppingKeys.detail('owner'), {
      document: createEmptyShoppingDocument(), contentRevision: 0,
    })
    db.bridge.mockImplementationOnce(async () => {
      db.shoppingError = true
      return { data: [{ document: createEmptyShoppingDocument(), content_revision: 1,
        pantry_item: { id: 'milk' }, pantry_was_inserted: true }], error: null }
    })
    const { result } = renderHook(useAddToPantryAndRemove, { wrapper })
    await act(async () => {
      const saved = await result.current.mutateAsync({ rowId: 'manual:milk', item: 'milk',
        amount: null, unit: '', categoryKey: 'dairy', categoryOrder: 1 })
      expect(saved.pantryItem?.id).toBe('milk')
      expect(saved.state).toBeNull()
    })
    expect(db.bridge).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(shoppingKeys.detail('owner'))).toMatchObject({ contentRevision: 0 })
  })

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
