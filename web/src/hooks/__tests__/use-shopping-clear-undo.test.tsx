import { shoppingContent } from '@/lib/shopping-clear'
import { runHookCommand, type HookLifecycle } from '@/test/shopping-hook-command-mock'
import type { ShoppingCommand } from '@/lib/shopping-command'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useClearShoppingList,
  useRestoreShoppingContent,
  ShoppingClearUndoConflictError,
  type ShoppingClearResult,
} from '@/hooks/shopping/use-shopping-document'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV3,
  type ShoppingManualItemV1,
} from '@/lib/shopping-document'
import { shoppingKeys } from '@/lib/query-keys'
import { setActivePrincipalId } from '@/lib/principal-session'

const OWNER = 'owner-a'
const KEY = shoppingKeys.detail(OWNER)
const auth = vi.hoisted(() => ({ id: 'owner-a' as string | null }))
const show = vi.hoisted(() => vi.fn())
const db = vi.hoisted(() => ({
  lifecycle: { epoch: 0 } as HookLifecycle,
  states: new Map<string, ShoppingDocumentStateV3>(),
  beforeWrite: undefined as (() => void) | undefined,
  afterWrite: undefined as (() => Promise<void> | void) | undefined,
  beforeRead: undefined as (() => Promise<void> | void) | undefined,
  failWrite: false,
  writes: [] as { owner: string; revision: number; applied: boolean }[],
}))

vi.mock('@/lib/shopping-command-client', () => ({
  executeShoppingCommand: async (owner: string, command: ShoppingCommand) =>
    runHookCommand(command, () => db.states.get(owner)!, async (before, next) => {
      db.beforeWrite?.()
      const applied = !db.failWrite && auth.id === owner && db.states.get(owner)!.contentRevision === before.contentRevision
      db.writes.push({ owner, revision: before.contentRevision, applied })
      if (db.failWrite) throw new Error('Write failed')
      if (!applied) return false
      if (JSON.stringify(shoppingContent(before.document)) !== JSON.stringify(shoppingContent(next.document))) db.lifecycle.epoch++
      db.states.set(owner, structuredClone(next))
      await db.afterWrite?.()
      return true
    }, [], db.lifecycle),
}))
vi.mock('@/lib/auth-context', () => ({
  useAuthContext: () => ({ user: auth.id ? { id: auth.id } : null, loading: false }),
}))
vi.mock('@/hooks/use-undo-toast', () => ({ useUndoToast: () => ({ show }) }))
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== 'shopping_list') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => {
          let owner = auth.id!
          const read = {
            eq: (_column: string, value: string) => { owner = value; return read },
            maybeSingle: async () => {
              const snapshot = structuredClone(db.states.get(owner)!)
              await db.beforeRead?.()
              return { data: { document: snapshot.document, content_revision: snapshot.contentRevision }, error: null }
            },
          }
          return read
        },
        update: (values: { document: ShoppingDocumentStateV3['document']; content_revision: number }) => {
          const filters: Record<string, string | number> = {}
          const write = {
            eq: (column: string, value: string | number) => { filters[column] = value; return write },
            select: () => write,
            maybeSingle: async () => {
              db.beforeWrite?.()
              const owner = filters.user_id as string
              const revision = filters.content_revision as number
              const current = db.states.get(owner)!
              const applied = !db.failWrite && auth.id === owner && current.contentRevision === revision
              db.writes.push({ owner, revision, applied })
              if (db.failWrite) return { data: null, error: { message: 'Write failed' } }
              if (!applied) return { data: null, error: null }
              const committed = structuredClone({ document: values.document, contentRevision: values.content_revision })
              db.states.set(owner, committed)
              await db.afterWrite?.()
              return { data: { document: committed.document, content_revision: committed.contentRevision }, error: null }
            },
          }
          return write
        },
      }
    },
  }),
}))

function manual(id: string, changes: Partial<ShoppingManualItemV1> = {}): ShoppingManualItemV1 {
  return { id, displayName: id, quantity: null, categoryKey: 'misc', bucket: 'items', checked: false, ...changes }
}

function setup(withRecipes = false) {
  const document = createEmptyShoppingDocument()
  document.manualItems = [
    manual('garlic', { quantity: { amount: 2, unit: 'count' }, checked: true }),
    manual('rice', { bucket: 'already_have' }),
    manual('cilantro', { bucket: 'excluded' }),
  ]
  document.preferences.categoryOrder = ['misc', 'produce']
  document.preferences.excludedIngredientKeys = ['salt']
  if (withRecipes) {
    document.recipeEntries.recipe = {
      recipeId: 'recipe', recipeName: 'Soup', selectedServings: 2,
      scaleV1: { numerator: '1', denominator: '1' }, ingredients: [],
    }
  }
  const original = { document, contentRevision: 7 }
  db.states.set(OWNER, structuredClone(original))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(KEY, structuredClone(original))
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => ({ clear: useClearShoppingList(), undo: useRestoreShoppingContent() }), { wrapper })
  return { ...hook, client, original }
}

function commit(mutation: ShoppingDocumentMutation) {
  const before = db.states.get(OWNER)!
  const after = applyShoppingDocumentMutation(before, mutation)
  if (JSON.stringify(shoppingContent(before.document)) !== JSON.stringify(shoppingContent(after.document))) db.lifecycle.epoch++
  db.states.set(OWNER, after)
}

async function clear(hook: ReturnType<typeof setup>) {
  let result: ShoppingClearResult | null = null
  await act(async () => { result = await hook.result.current.clear.mutateAsync() })
  return result as ShoppingClearResult | null
}

async function refuse(hook: ReturnType<typeof setup>, token: ShoppingClearResult,
  message = 'Shopping changed after Clear; Undo was not applied.') {
  const persisted = structuredClone([...db.states])
  await act(async () => {
    await expect(hook.result.current.undo.mutateAsync(token)).rejects.toBeInstanceOf(ShoppingClearUndoConflictError)
  })
  expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message }))
  expect([...db.states]).toEqual(persisted)
}

beforeEach(() => {
  auth.id = OWNER
  setActivePrincipalId(OWNER)
  show.mockReset()
  db.states.clear()
  db.lifecycle = { epoch: 0 }
  db.beforeWrite = undefined
  db.afterWrite = undefined
  db.beforeRead = undefined
  db.failWrite = false
  db.writes = []
})

afterEach(() => { onlineManager.setOnline(true) })

describe('conditional Shopping Clear Undo', () => {
  it('restores exact manual content across all buckets and preserves preferences', async () => {
    const hook = setup()
    const token = await clear(hook)
    expect(token).toEqual({
      ownerUserId: OWNER, postClearRevision: 8, synchronizationFailed: false,
      undoAvailable: true, historical: false,
      content: { manualItems: hook.original.document.manualItems, recipeEntries: {}, itemOverrides: {} },
    })
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([])
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
    expect(db.states.get(OWNER)).toEqual({ ...hook.original, contentRevision: 9 })
    expect(hook.client.getQueryData(KEY)).toEqual(db.states.get(OWNER))
    expect(show).not.toHaveBeenCalled()
  })

  it.each(['add', 'edit', 'remove', 'add-then-delete'] as const)(
    'refuses after %s, preserving final persisted state and settings', async (action) => {
      const hook = setup()
      const token = await clear(hook)
        commit({ type: 'addManualItem', item: manual('bread') })
        if (action === 'edit') commit({ type: 'editManualItem', id: 'bread', changes: { displayName: 'rye bread' } })
        if (action === 'remove') {
          commit({ type: 'addManualItem', item: manual('milk') })
          commit({ type: 'deleteManualItem', id: 'bread' })
        }
        if (action === 'add-then-delete') commit({ type: 'deleteManualItem', id: 'bread' })
      hook.client.setQueryData(KEY, structuredClone(db.states.get(OWNER)))
      await refuse(hook, token!)
    })

  it('rejects a stale post-Clear cache after CAS conflict/refetch instead of restoring at the new revision', async () => {
    const hook = setup()
    const token = await clear(hook)
    commit({ type: 'addManualItem', item: manual('bread') })
    await refuse(hook, token!)
    expect(hook.client.getQueryData(KEY)).toEqual(db.states.get(OWNER))
    expect(db.writes.filter((write) => write.applied)).toHaveLength(1)
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([manual('bread')])
  })

  it('fails the fixed CAS when another write arrives between validation and write', async () => {
    const hook = setup()
    const token = await clear(hook)
    db.beforeWrite = () => {
      db.beforeWrite = undefined
      commit({ type: 'addManualItem', item: manual('bread') })
    }
    await act(async () => {
      await expect(hook.result.current.undo.mutateAsync(token!)).rejects.toThrow('Shopping changed after Clear; Undo was not applied.')
    })
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Shopping changed after Clear; Undo was not applied.' }))
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([manual('bread')])
    expect(db.writes.slice(1)).toEqual([{ owner: OWNER, revision: token!.postClearRevision, applied: false }])
  })

  it('does not acknowledge a restore reducer no-op from stale cache', async () => {
    const hook = setup()
    const token = await clear(hook)
    hook.client.setQueryData(KEY, { ...hook.original, contentRevision: token!.postClearRevision })
    commit({ type: 'addManualItem', item: manual('bread') })
    await refuse(hook, token!)
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([manual('bread')])
  })

  it('F3 refuses a changed confirmation, then returns the successful re-confirmed preimage', async () => {
    const hook = setup()
    commit({ type: 'addManualItem', item: manual('bread') })
    const actualPreimage = structuredClone(db.states.get(OWNER)!)
    await act(async () => { await expect(hook.result.current.clear.mutateAsync()).rejects.toThrow('confirm Clear again') })
    expect(db.states.get(OWNER)).toEqual(actualPreimage)
    const token = await clear(hook)
    expect(token!.content.manualItems).toEqual(actualPreimage.document.manualItems)
    expect(token!.postClearRevision).toBe(db.states.get(OWNER)!.contentRevision)
    expect(token!.postClearRevision).toBe(9)
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
    expect(db.states.get(OWNER)!.document).toEqual(actualPreimage.document)
  })

  it('F3 refuses a stale confirmation then returns no inverse for current empty Clear', async () => {
    const hook = setup()
    commit({ type: 'complete' })
    const persisted = structuredClone(db.states.get(OWNER))
    await act(async () => { await expect(hook.result.current.clear.mutateAsync()).rejects.toThrow('confirm Clear again') })
    expect(await clear(hook)).toBeNull()
    expect(await clear(hook)).toBeNull()
    expect(db.states.get(OWNER)).toEqual(persisted)
  })

  it('fails Clear without an inverse or persisted changes', async () => {
    const hook = setup()
    db.failWrite = true
    await act(async () => { await expect(hook.result.current.clear.mutateAsync()).rejects.toMatchObject({ message: 'Write failed' }) })
    expect(hook.result.current.clear.data).toBeUndefined()
    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not update the shopping list. Try again.' }))
    expect(db.states.get(OWNER)).toEqual(hook.original)
  })

  it('does not issue an inverse when the Clear response is lost after commit', async () => {
    const hook = setup()
    db.afterWrite = () => { throw new Error('Response lost') }
    await act(async () => {
      await expect(hook.result.current.clear.mutateAsync()).rejects.toThrow('Response lost')
    })
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([])
    expect(hook.result.current.clear.data).toBeUndefined()
    expect(show).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Could not update the shopping list. Try again.',
    }))
  })

  it.each(['clear', 'undo'] as const)('F3 preserves unknown delivery feedback after a committed %s', async (operation) => {
    const hook = setup()
    const token = operation === 'undo' ? await clear(hook) : null
    db.afterWrite = () => {
      throw Object.assign(new ShoppingClearUndoConflictError('The Shopping outcome is unknown. Review the saved list.'), { status: 'OutcomeUnknown' })
    }
    await act(async () => {
      const pending = operation === 'clear' ? hook.result.current.clear.mutateAsync()
        : hook.result.current.undo.mutateAsync(token!)
      await expect(pending).rejects.toThrow('outcome is unknown')
    })
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('outcome is unknown') }))
    expect(db.states.get(OWNER)!.document.manualItems.length).toBe(operation === 'clear' ? 0 : hook.original.document.manualItems.length)
  })

  it('F3 requires updated confirmation when a hidden recipe invalidates manual-only Undo', async () => {
    const hook = setup()
    const newer = structuredClone(db.states.get(OWNER)!)
    newer.contentRevision++
    newer.document.recipeEntries.recipe = {
      recipeId: 'recipe', recipeName: 'Hidden soup', selectedServings: 2,
      scaleV1: { numerator: '1', denominator: '1' }, ingredients: [],
    }
    db.states.set(OWNER, newer)
    await act(async () => { await expect(hook.result.current.clear.mutateAsync()).rejects.toThrow('confirm Clear again') })
    expect(db.states.get(OWNER)).toEqual(newer)
    const token = await clear(hook)
    expect(token!.postClearRevision).toBe(9)
    expect(token!.content.recipeEntries).toEqual(newer.document.recipeEntries)
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
  })

  it('restores recipe-bearing whole Undo through a compact reference', async () => {
    const hook = setup(true)
    const token = await clear(hook)
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
    expect(db.states.get(OWNER)!.document).toEqual(hook.original.document)
  })

  it('allows organization-only changes without replacing current preferences', async () => {
    const hook = setup()
    const token = await clear(hook)
    commit({ type: 'updatePreferences', preferences: { excludedIngredientKeys: ['pepper'] } })
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
    expect(db.states.get(OWNER)!.document.preferences.excludedIngredientKeys).toEqual(['pepper'])
    expect(db.states.get(OWNER)!.document.manualItems).toEqual(hook.original.document.manualItems)
  })

  it('refuses repeated Undo, including a stale cache from before the first Undo', async () => {
    const hook = setup()
    const token = await clear(hook)
    const postClear = structuredClone(db.states.get(OWNER))
    await act(async () => { await hook.result.current.undo.mutateAsync(token!) })
    await refuse(hook, token!)
    hook.client.setQueryData(KEY, postClear)
    await refuse(hook, token!)
    expect(db.states.get(OWNER)).toEqual({ ...hook.original, contentRevision: 9 })
  })

  it('rejects another owner using an old inverse', async () => {
    const hook = setup()
    const token = await clear(hook)
    auth.id = 'owner-b'
    setActivePrincipalId(auth.id)
    db.states.set(auth.id, { document: createEmptyShoppingDocument(), contentRevision: 8 })
    hook.rerender()
    await refuse(hook, token!)
    expect(db.states.get('owner-b')!.document.manualItems).toEqual([])
  })

  it.each(['clear', 'undo'] as const)('does not retarget a queued %s to the next owner', async (operation) => {
    const hook = setup()
    const token = operation === 'undo' ? await clear(hook) : null
    onlineManager.setOnline(false)
    let pending: Promise<unknown>
    act(() => {
      pending = (operation === 'clear'
        ? hook.result.current.clear.mutateAsync()
        : hook.result.current.undo.mutateAsync(token!)).catch((error) => error)
    })
    await waitFor(() => expect(hook.result.current[operation].isPaused).toBe(true))
    auth.id = 'owner-b'
    setActivePrincipalId(auth.id)
    db.states.set(auth.id, structuredClone(hook.original))
    const persisted = structuredClone([...db.states])
    hook.rerender()
    await act(async () => {
      onlineManager.setOnline(true)
      expect(await pending!).toBeInstanceOf(ShoppingClearUndoConflictError)
    })
    expect([...db.states]).toEqual(persisted)
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Shopping account changed') }))
  })

  it('fences an owner change during conflict refetch before replay can write', async () => {
    const hook = setup()
    const token = await clear(hook)
    commit({ type: 'addManualItem', item: manual('bread') })
    db.beforeRead = () => { auth.id = 'owner-b'; setActivePrincipalId(auth.id) }
    const persisted = structuredClone(db.states.get(OWNER))
    await act(async () => {
      await expect(hook.result.current.undo.mutateAsync(token!)).rejects.toThrow('Shopping account changed')
    })
    expect(db.states.get(OWNER)).toEqual(persisted)
    expect(db.states.has('owner-b')).toBe(false)
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Shopping account changed') }))
  })

  it.each(['clear', 'undo'] as const)('fences an owner switch while %s response is pending', async (operation) => {
    const hook = setup()
    const token = operation === 'undo' ? await clear(hook) : null
    db.afterWrite = () => {
      auth.id = 'owner-b'
      setActivePrincipalId(auth.id)
      hook.client.removeQueries({ queryKey: KEY })
    }
    await act(async () => {
      const pending = operation === 'clear'
        ? hook.result.current.clear.mutateAsync()
        : hook.result.current.undo.mutateAsync(token!)
      await expect(pending).rejects.toThrow('Shopping account changed')
    })
    expect(hook.client.getQueryData(KEY)).toBeUndefined()
    expect(hook.result.current[operation].data).toBeUndefined()
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('Shopping account changed') }))
    expect(db.states.get(OWNER)!.document.manualItems).toEqual(operation === 'clear' ? [] : hook.original.document.manualItems)
    expect(db.states.has('owner-b')).toBe(false)
  })

  it('does not replace newer cache or issue an inverse from a late Clear response', async () => {
    const hook = setup()
    db.afterWrite = () => {
      commit({ type: 'addManualItem', item: manual('bread') })
      hook.client.setQueryData(KEY, structuredClone(db.states.get(OWNER)))
    }
    const token = await clear(hook)
    await refuse(hook, token!)
    expect(hook.client.getQueryData(KEY)).toEqual(db.states.get(OWNER))
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([manual('bread')])
    expect(show).toHaveBeenCalled()
  })

  it('keeps committed Clear successful when its captured read loses to newer cache (review F3)', async () => {
    const hook = setup()
    let once = true
    db.beforeRead = () => {
      if (!once) return
      once = false
      commit({ type: 'addManualItem', item: manual('bread') })
      hook.client.setQueryData(KEY, structuredClone(db.states.get(OWNER)))
    }
    const token = await clear(hook)
    expect(token).toMatchObject({ postClearRevision: 8, undoAvailable: false })
    await waitFor(() => expect(hook.result.current.clear.isSuccess).toBe(true))
    expect(show).not.toHaveBeenCalled()
    expect(hook.client.getQueryData(KEY)).toEqual(db.states.get(OWNER))
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([manual('bread')])
    expect(db.writes.filter(write => write.applied)).toHaveLength(1)
  })

  it('reports confirmed Clear separately from a failed follow-up read', async () => {
    const hook = setup()
    db.beforeRead = () => { throw new Error('Read unavailable') }
    const token = await clear(hook)
    expect(token).toMatchObject({ postClearRevision: 8, undoAvailable: false })
    await waitFor(() => expect(hook.result.current.clear.isSuccess).toBe(true))
    expect(show).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining('change confirmed') }))
    expect(db.states.get(OWNER)!.document.manualItems).toEqual([])
    expect(db.writes.filter(write => write.applied)).toHaveLength(1)
  })
})
