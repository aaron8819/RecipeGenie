import { setActivePrincipalId } from '@/lib/principal-session'
import { runHookCommand } from '@/test/shopping-hook-command-mock'
import type { ShoppingCommand } from '@/lib/shopping-command'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useAddShoppingItem,
  useUpdateShoppingItem,
  useShoppingList,
  shoppingDocumentToList,
} from '@/hooks/shopping/use-shopping-document'
import {
  createEmptyShoppingDocument,
  applyShoppingDocumentMutation,
  projectShoppingDocument,
  type ShoppingDocumentStateV3,
  type ShoppingDocumentV3,
  type ShoppingRecipeIngredientV2,
} from '@/lib/shopping-document'
import { resolveShoppingIngredient } from '@/lib/shopping-ingredient-resolution'
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics'
import { parseIngredientLine } from '@/lib/recipe-parser'
import { pantryKeys, shoppingKeys } from '@/lib/query-keys'
import type { PantryItem, ShoppingItem } from '@/types/database'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const SHOPPING_KEY = shoppingKeys.detail(USER_ID)
const PANTRY_KEY = pantryKeys.list(USER_ID)

const undoToastShow = vi.hoisted(() => vi.fn())
const database = vi.hoisted(() => ({
  pantryRows: [] as unknown[],
  pantryResponse: null as Promise<unknown> | null,
  shoppingRow: null as {
    document: unknown
    content_revision: number
  } | null,
  conflictState: null as ShoppingDocumentStateV3 | null,
  shoppingSelectCalls: vi.fn(),
  updateError: null as { message: string } | null,
  updateCalls: vi.fn(),
}))

vi.mock('@/lib/shopping-command-client', () => ({
  executeShoppingCommand: async (_owner: string, command: ShoppingCommand) =>
    runHookCommand(command, () => ({ document: database.shoppingRow!.document as ShoppingDocumentV3,
      contentRevision: database.shoppingRow!.content_revision }), async (_before, next) => {
      database.updateCalls({ document: next.document, content_revision: next.contentRevision })
      if (database.updateError) throw database.updateError
      if (database.conflictState) {
        database.shoppingRow = { document: database.conflictState.document, content_revision: database.conflictState.contentRevision }
        database.conflictState = null
        return false
      }
      database.shoppingRow = { document: next.document, content_revision: next.contentRevision }
      return true
    }, database.pantryRows as PantryItem[]),
}))
vi.mock('@/lib/auth-context', () => ({
  useAuthContext: () => ({ user: { id: USER_ID }, loading: false }),
}))

vi.mock('@/hooks/use-undo-toast', () => ({
  useUndoToast: () => ({ show: undoToastShow }),
}))

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'pantry_items') {
        return {
          select: () => ({
            order: () => database.pantryResponse || Promise.resolve({
              data: database.pantryRows,
              error: null,
            }),
          }),
        }
      }

      if (table !== 'shopping_list') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: () => {
          const selection = {
            eq: () => selection,
            maybeSingle: async () => {
              database.shoppingSelectCalls()
              return database.shoppingRow
                ? { data: database.shoppingRow, error: null }
                : { data: null, error: { message: 'Shopping document not found' } }
            },
          }
          return selection
        },
        update: (values: { document: unknown; content_revision: number }) => {
          database.updateCalls(values)
          const chain = {
            eq: () => chain,
            select: () => chain,
            maybeSingle: async () => {
              if (database.updateError) {
                return { data: null, error: database.updateError }
              }
              if (database.conflictState) {
                database.shoppingRow = {
                  document: database.conflictState.document,
                  content_revision: database.conflictState.contentRevision,
                }
                database.conflictState = null
                return { data: null, error: null }
              }
              database.shoppingRow = {
                document: values.document,
                content_revision: values.content_revision,
              }
              return { data: database.shoppingRow, error: null }
            },
          }
          return chain
        },
      }
    },
  }),
}))

function pantry(item: string): PantryItem {
  return {
    id: `pantry-${item}`,
    user_id: USER_ID,
    item,
    created_at: '2026-08-17T00:00:00.000Z',
  }
}

function persistedLine(line: string): ShoppingRecipeIngredientV2 {
  const {
    runtime: _runtime,
    sourceOrdinal: _sourceOrdinal,
    defaultCategoryOrder: _defaultCategoryOrder,
    ...ingredient
  } = resolveShoppingIngredient({
    ingredient: parseIngredientLine(line),
    recipeId: 'recipe-olive',
  })
  return ingredient
}

function withDerivedOliveOil(line = '2 tbsp olive oil'): ShoppingDocumentV3 {
  const document = createEmptyShoppingDocument()
  document.recipeEntries['recipe-olive'] = {
    recipeId: 'recipe-olive',
    recipeName: 'Synthetic Olive Recipe',
    selectedServings: 4,
    scaleV1: { numerator: '1', denominator: '1' },
    ingredients: [persistedLine(line)],
  }
  return document
}

function withManualOliveOil(
  input = 'olive oil',
  id = 'manual-existing'
): ShoppingDocumentV3 {
  const document = createEmptyShoppingDocument()
  const semantics = resolveShoppingIngredientSemantics({ item: input })
  document.manualItems.push({
    id,
    displayName: semantics.purchaseName,
    quantity: null,
    categoryKey: 'pantry',
    bucket: 'items',
    checked: false,
  })
  return document
}

function state(
  document: ShoppingDocumentV3,
  contentRevision = 7
): ShoppingDocumentStateV3 {
  return { document, contentRevision }
}

function setup(
  document: ShoppingDocumentV3,
  pantryItems?: PantryItem[]
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const initial = state(document)
  queryClient.setQueryData(SHOPPING_KEY, initial)
  database.shoppingRow = {
    document: initial.document,
    content_revision: initial.contentRevision,
  }
  if (pantryItems) { queryClient.setQueryData(PANTRY_KEY, pantryItems); database.pantryRows = pantryItems }

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return {
    queryClient,
    wrapper,
    ...renderHook(() => useAddShoppingItem(), { wrapper }),
  }
}

async function addOliveOil(
  hook: ReturnType<typeof setup>
): Promise<unknown> {
  return addManualItem(hook, 'olive oil')
}

async function addManualItem(
  hook: ReturnType<typeof setup>,
  itemName: string,
  rowId = 'manual-new'
): Promise<unknown> {
  let error: unknown
  await act(async () => {
    try {
      await hook.result.current.mutateAsync({
        itemName,
        rowId,
      })
    } catch (caught) {
      error = caught
    }
  })
  return error
}

async function updateManualItem(
  hook: ReturnType<typeof setup>,
  item: ShoppingItem,
  itemName: string,
  amount?: number,
  unit?: string
): Promise<unknown> {
  let error: unknown
  const { result } = renderHook(() => useUpdateShoppingItem(), {
    wrapper: hook.wrapper,
  })
  await act(async () => {
    try {
      await result.current.mutateAsync({
        item,
        updates: { itemName, amount, unit },
      })
    } catch (caught) {
      error = caught
    }
  })
  return error
}

describe('useAddShoppingItem active-list duplicate behavior', () => {
  beforeEach(() => {
  setActivePrincipalId(USER_ID)
    vi.clearAllMocks()
    database.pantryRows = []
    database.pantryResponse = null
    database.shoppingRow = null
    database.conflictState = null
    database.updateError = null
  })

  it('adds olive oil when only Pantry contains it and sends one PATCH', async () => {
    const hook = setup(createEmptyShoppingDocument(), [pantry('olive oil')])

    expect(await addOliveOil(hook)).toBeUndefined()
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
    expect(hook.queryClient.getQueryData<ShoppingDocumentStateV3>(SHOPPING_KEY)
      ?.document.manualItems).toHaveLength(1)
  })

  it.each([
    ['eggs', 'egg'],
    ['mushrooms', 'mushroom'],
  ])('persists manual surface text %s with semantic identity %s', async (
    displayName,
    purchaseKey
  ) => {
    const hook = setup(createEmptyShoppingDocument(), [])

    expect(await addManualItem(hook, displayName)).toBeUndefined()
    const persisted = hook.queryClient.getQueryData<ShoppingDocumentStateV3>(
      SHOPPING_KEY
    )?.document
    expect(persisted?.manualItems).toEqual([
      expect.objectContaining({ displayName }),
    ])
    expect(projectShoppingDocument(persisted!).items).toEqual([
      expect.objectContaining({
        displayName,
        orderingKey: purchaseKey,
      }),
    ])
  })

  it('still rejects singular and plural manual semantic duplicates', async () => {
    const hook = setup(withManualOliveOil('egg'), [])

    expect(await addManualItem(hook, 'eggs')).toEqual(
      new Error('Item already in shopping list')
    )
    expect(database.updateCalls).not.toHaveBeenCalled()
  })

  it('preserves an explicitly edited plural while retaining semantic identity', async () => {
    const document = withManualOliveOil('egg', 'manual-egg')
    const hook = setup(document, [])

    expect(await updateManualItem(hook, {
      rowId: 'manual:manual-egg',
      orderingKey: 'egg',
      item: 'egg',
      amount: null,
      unit: '',
      categoryKey: 'pantry',
      categoryOrder: 1,
      sources: [{ recipeName: 'Manual' }],
      checked: false,
    }, 'eggs')).toBeUndefined()
    const persisted = hook.queryClient.getQueryData<ShoppingDocumentStateV3>(
      SHOPPING_KEY
    )?.document
    expect(persisted?.manualItems).toEqual([
      expect.objectContaining({ id: 'manual-egg', displayName: 'eggs' }),
    ])
    expect(projectShoppingDocument(persisted!).items).toEqual([
      expect.objectContaining({ displayName: 'eggs', orderingKey: 'egg' }),
    ])
  })

  it('rejects an active manual duplicate with actionable feedback and no PATCH', async () => {
    const hook = setup(withManualOliveOil(), [])

    expect(await addOliveOil(hook)).toEqual(
      new Error('Item already in shopping list')
    )
    expect(database.updateCalls).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledTimes(1)
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'That item is already on the shopping list.',
        duration: 4000,
      })
    })
  })

  it('adds when Pantry hides a recipe-derived olive oil row', async () => {
    const document = withDerivedOliveOil()
    const pantryItems = [pantry('olive oil')]
    const projection = projectShoppingDocument(document, pantryItems)
    expect(projection.items).toHaveLength(0)
    expect(projection.alreadyHave[0]).toMatchObject({
      orderingKey: 'olive oil',
      rowRef: expect.stringMatching(/^derived:/),
    })
    const hook = setup(document, pantryItems)

    expect(await addOliveOil(hook)).toBeUndefined()
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
  })

  it('rejects an active recipe-derived semantic duplicate with no PATCH', async () => {
    const document = withDerivedOliveOil('2 tbsp olive oil, divided')
    expect(document.recipeEntries['recipe-olive'].ingredients[0]).toMatchObject({
      purchaseKey: 'olive oil',
      preparation: ['divided'],
    })
    const hook = setup(document, [])

    expect(await addOliveOil(hook)).toEqual(
      new Error('Item already in shopping list')
    )
    expect(database.updateCalls).not.toHaveBeenCalled()
  })

  it.each([
    ['the same purchase name', 'olive oil'],
    ['a semantic equivalent', 'olive oil, divided'],
  ])('rejects a replay when another session adds %s', async (_case, competingInput) => {
    const hook = setup(createEmptyShoppingDocument(), [])
    database.conflictState = state(
      withManualOliveOil(competingInput, 'manual-other-session'),
      8
    )

    expect(await addOliveOil(hook)).toEqual(
      new Error('Item already in shopping list')
    )

    expect(database.updateCalls).toHaveBeenCalledTimes(1)
    expect(database.shoppingSelectCalls).toHaveBeenCalledTimes(1)
    const persisted = database.shoppingRow
    expect(persisted?.content_revision).toBe(8)
    const finalProjection = projectShoppingDocument(
      persisted?.document as ShoppingDocumentV3,
      []
    )
    expect(finalProjection.items.map((row) => ({
      rowRef: row.rowRef,
      purchaseKey: row.orderingKey,
    }))).toEqual([{
      rowRef: 'manual:manual-other-session',
      purchaseKey: 'olive oil',
    }])
    expect((persisted?.document as ShoppingDocumentV3).manualItems
      .map((item) => item.id)).toEqual(['manual-other-session'])
    expect(hook.queryClient.getQueryData<ShoppingDocumentStateV3>(SHOPPING_KEY))
      .toMatchObject({ contentRevision: 8 })
    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledTimes(1)
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'That item is already on the shopping list.',
        duration: 4000,
      })
    })
  })

  it('adds when a recipe-derived olive oil row is excluded', async () => {
    const document = withDerivedOliveOil()
    document.preferences.excludedIngredientKeys = ['olive oil']
    expect(projectShoppingDocument(document).excluded).toHaveLength(1)
    const hook = setup(document, [])

    expect(await addOliveOil(hook)).toBeUndefined()
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
  })

  it('keeps extra virgin olive oil distinct from olive oil Pantry state', async () => {
    expect(resolveShoppingIngredientSemantics({ item: 'extra virgin olive oil' })
      .purchaseKey).not.toBe(
        resolveShoppingIngredientSemantics({ item: 'olive oil' }).purchaseKey
      )
    const hook = setup(
      createEmptyShoppingDocument(),
      [pantry('extra virgin olive oil')]
    )

    expect(await addOliveOil(hook)).toBeUndefined()
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
  })

  it('waits for unresolved Pantry before checking a hidden derived row', async () => {
    let resolvePantry!: (value: unknown) => void
    database.pantryResponse = new Promise((resolve) => {
      resolvePantry = resolve
    })
    const hook = setup(withDerivedOliveOil())
    let pending!: Promise<unknown>

    await act(async () => {
      pending = hook.result.current.mutateAsync({
        itemName: 'olive oil',
        rowId: 'manual-new',
      })
      await Promise.resolve()
    })
    expect(database.updateCalls).not.toHaveBeenCalled()

    database.pantryRows = [pantry('olive oil')]
    resolvePantry({ data: database.pantryRows, error: null })
    await act(async () => {
      await pending
    })
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
  })

  it('preserves generic feedback for a real Shopping update failure', async () => {
    database.updateError = { message: 'network down' }
    const hook = setup(createEmptyShoppingDocument(), [])

    expect(await addOliveOil(hook)).toEqual(database.updateError)
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledTimes(1)
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'Could not update the shopping list. Try again.',
        duration: 4000,
      })
    })
  })

  it('edits a manual quantity after recipe addition without changing requirements or sources, including a fresh read', async () => {
    const document = withManualOliveOil('lemons')
    document.manualItems[0].quantity = { amount: 2, unit: 'count' }
    document.manualItems[0].categoryKey = 'produce'
    const recipe = withDerivedOliveOil('2 lemons').recipeEntries['recipe-olive']
    const withRecipe = applyShoppingDocumentMutation(state(document), {
      type: 'upsertRecipe', entry: recipe,
    })
    const hook = setup(withRecipe.document, [])
    const before = shoppingDocumentToList(USER_ID, withRecipe)
    const manual = before.items.find((item) => item.rowId?.startsWith('manual:'))!
    const derived = before.items.find((item) => item.rowId?.startsWith('derived:'))!
    expect(before.items).toHaveLength(2)
    expect(await updateManualItem(hook, manual, 'lemon', 3.5, 'count')).toBeUndefined()
    expect(database.shoppingRow?.document).toMatchObject({ recipeEntries: withRecipe.document.recipeEntries })
    hook.queryClient.removeQueries({ queryKey: SHOPPING_KEY })
    const reloaded = renderHook(() => useShoppingList(), { wrapper: hook.wrapper })
    await waitFor(() => expect(reloaded.result.current.data?.items).toHaveLength(2))
    expect(reloaded.result.current.data?.items.find((item) => item.rowId === manual.rowId))
      .toMatchObject({ item: 'lemon', amount: 3.5, sources: [{ recipeName: 'Manual' }] })
    expect(reloaded.result.current.data?.items.find((item) => item.rowId === derived.rowId)).toEqual(derived)
  })

  it('continues to edit an ordinary nonduplicate manual row', async () => {
    const document = withManualOliveOil('yogurt')
    const hook = setup(document, [])
    const manual = shoppingDocumentToList(USER_ID, state(document)).items[0]
    expect(await updateManualItem(hook, manual, 'yogurt', 1.5, 'cup')).toBeUndefined()
    expect(database.shoppingRow?.document).toMatchObject({
      manualItems: [{ displayName: 'yogurt', quantity: { amount: 1.5, unit: 'cup' } }],
    })
  })

  it('rechecks canonical identity collisions before retrying an edit', async () => {
    const document = withManualOliveOil('yogurt')
    const hook = setup(document, [])
    const manual = shoppingDocumentToList(USER_ID, state(document)).items[0]
    database.conflictState = state({
      ...document,
      recipeEntries: withDerivedOliveOil('2 yellow onions').recipeEntries,
    }, 8)
    expect(await updateManualItem(hook, manual, 'onion', 3, 'count'))
      .toEqual(new Error('Item already in shopping list'))
    expect(database.updateCalls).toHaveBeenCalledTimes(1)
    expect(database.shoppingRow?.document).toMatchObject({ manualItems: document.manualItems })
  })

  it('allows replay of an unchanged identity when another session adds a recipe requirement', async () => {
    const document = withManualOliveOil('lemons')
    document.manualItems[0].quantity = { amount: 2, unit: 'count' }
    const hook = setup(document, [])
    const manual = shoppingDocumentToList(USER_ID, state(document)).items[0]
    const recipeEntries = withDerivedOliveOil('2 lemons').recipeEntries
    database.conflictState = state({ ...document, recipeEntries }, 8)
    expect(await updateManualItem(hook, manual, 'lemons', 4, 'count')).toBeUndefined()
    expect(database.updateCalls).toHaveBeenCalledTimes(2)
    expect(database.shoppingRow?.document).toMatchObject({
      recipeEntries, manualItems: [{ quantity: { amount: 4, unit: 'count' } }],
    })
  })

  it('leaves duplicate feedback to the manual edit UI', async () => {
    const document = createEmptyShoppingDocument()
    document.manualItems.push(
      {
        id: 'manual-garlic',
        displayName: 'garlic',
        quantity: null,
        categoryKey: 'produce',
        bucket: 'items',
        checked: false,
      },
      {
        id: 'manual-milk',
        displayName: 'milk',
        quantity: null,
        categoryKey: 'dairy',
        bucket: 'items',
        checked: false,
      }
    )
    const hook = setup(document, [])

    expect(await updateManualItem(hook, {
      rowId: 'manual:manual-garlic',
      orderingKey: 'garlic',
      item: 'garlic',
      amount: null,
      unit: '',
      categoryKey: 'produce',
      categoryOrder: 1,
      sources: [{ recipeName: 'Manual' }],
      checked: false,
    }, 'milk')).toEqual(new Error('Item already in shopping list'))

    expect(database.updateCalls).not.toHaveBeenCalled()
    expect(undoToastShow).not.toHaveBeenCalled()
  })
})
