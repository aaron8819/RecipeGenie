'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '@/lib/auth-context'
import { useUndoToast } from '@/hooks/use-undo-toast'
import { usePantryItems } from '@/hooks/use-pantry'
import { mapRecipeRows } from '@/lib/recipe-identity'
import { pantryKeys, principalId, shoppingKeys } from '@/lib/query-keys'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  projectShoppingDocument,
  validateShoppingDocumentStateV3,
  type RowRef,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV3,
  type ShoppingDocumentV3,
  type ShoppingManualItemV1,
  type ShoppingRecipeEntryV2,
} from '@/lib/shopping-document'
import {
  persistShoppingMutationWithReplay,
  ShoppingDocumentConflictError,
  type ShoppingDocumentReplayValidator,
} from '@/lib/shopping-document-persistence'
import {
  createShoppingPurchaseKey,
  normalizeUnit,
} from '@/lib/shopping-list-normalization'
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics'
import { categorizeIngredient } from '@/lib/shopping-categories'
import {
  normalizeScaleRatioV1,
  parseRationalLexeme,
} from '@/lib/recipe-quantity'
import { normalizePantryItemName } from '@/lib/pantry'
import { isAlreadyInShoppingListError } from '@/lib/shopping-feedback'
import { getSupabase } from '@/lib/supabase/client'
import { requireShoppingRowRef } from '@/lib/shopping-row-reference'
import type {
  PantryItem,
  RationalV1,
  Recipe,
  ShoppingConfig,
  ShoppingItem,
  ShoppingList,
} from '@/types/database'

const SHOPPING_DOCUMENT_WRITE_SCOPE = 'shopping-document-write'

type ShoppingDocumentRow = {
  document: unknown
  content_revision: number
}

type MutationPlan<TResult> = {
  mutation: ShoppingDocumentMutation
  value: TResult
  validateReplay?: ShoppingDocumentReplayValidator
}

type DuplicateFeedbackOwner = 'mutation' | 'caller'

function parseShoppingDocumentRow(row: ShoppingDocumentRow): ShoppingDocumentStateV3 {
  const validation = validateShoppingDocumentStateV3({
    document: row.document,
    contentRevision: Number(row.content_revision),
  })
  if (!validation.ok || validation.contentRevision === undefined) {
    throw new Error('Stored Shopping document is invalid')
  }
  return {
    document: validation.document,
    contentRevision: validation.contentRevision,
  }
}

async function fetchShoppingDocumentState(): Promise<ShoppingDocumentStateV3> {
  const supabase = getSupabase()
  const request = supabase.from('shopping_list') as unknown as {
    select: (columns: string) => {
      single: () => Promise<{
        data: ShoppingDocumentRow | null
        error: { message: string } | null
      }>
    }
  }
  const { data, error } = await request
    .select('document,content_revision')
    .single()
  if (error) throw error
  if (!data) throw new Error('Shopping document not found')
  return parseShoppingDocumentRow(data)
}

async function writeShoppingDocumentCas(
  userId: string,
  current: ShoppingDocumentStateV3,
  next: ShoppingDocumentStateV3
): Promise<ShoppingDocumentStateV3 | null> {
  const supabase = getSupabase()
  const request = supabase.from('shopping_list') as unknown as {
    update: (values: { document: unknown; content_revision: number }) => {
      eq: (column: string, value: string | number) => {
        eq: (column: string, value: string | number) => {
          select: (columns: string) => {
            maybeSingle: () => Promise<{
              data: ShoppingDocumentRow | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }
  const { data, error } = await request
    .update({
      document: next.document,
      content_revision: current.contentRevision + 1,
    })
    .eq('user_id', userId)
    .eq('content_revision', current.contentRevision)
    .select('document,content_revision')
    .maybeSingle()
  if (error) throw error
  return data ? parseShoppingDocumentRow(data) : null
}

export function shoppingDocumentToList(
  userId: string,
  state: ShoppingDocumentStateV3,
  pantryItems: PantryItem[] = []
): ShoppingList {
  const projection = projectShoppingDocument(state.document, pantryItems)
  const mapRow = (row: (typeof projection.rows)[number]): ShoppingItem => ({
    rowId: row.rowRef,
    orderingKey: row.orderingKey,
    item: row.displayName,
    amount: row.quantity?.amount ?? null,
    unit: row.quantity?.unit || '',
    exactQuantityV1: row.quantity?.exactQuantityV1,
    exactPackageV1: row.quantity?.exactPackageV1,
    exactAuthoredUnit: row.quantity?.exactAuthoredUnit,
    categoryKey: row.categoryKey,
    categoryOrder: row.categoryOrder,
    sources: row.manualId
      ? [{ recipeName: 'Manual' }]
      : row.sources.map((source) => ({
          ...source,
        })),
    additionalAmounts: row.additionalQuantities
      ?.filter((quantity) => quantity.amount !== null)
      .map((quantity) => ({
        amount: quantity.amount as number,
        unit: quantity.unit,
      })),
    checked: row.checked,
    excludedBy: row.excludedBy,
  })
  const entries = Object.values(state.document.recipeEntries)
  return {
    user_id: userId,
    items: projection.items.map(mapRow),
    already_have: projection.alreadyHave.map(mapRow),
    excluded: projection.excluded.map(mapRow),
    source_recipes: entries.map((entry) => entry.recipeId).sort(),
    scale: entries.length === 1
      ? Number(entries[0].scaleV1.numerator) / Number(entries[0].scaleV1.denominator)
      : 1,
    total_servings: entries.reduce((total, entry) => total + entry.selectedServings, 0),
    custom_order: Object.keys(
      state.document.preferences.ingredientOrderByCategory
    ).length > 0,
  }
}

export function shoppingDocumentToConfig(
  state: ShoppingDocumentStateV3
): ShoppingConfig {
  const preferences = state.document.preferences
  return {
    category_overrides: { ...preferences.categoryByIngredient },
    custom_categories: [...preferences.customCategories],
    category_order: preferences.categoryOrder.length > 0
      ? [...preferences.categoryOrder]
      : null,
    excluded_keywords: [...preferences.excludedIngredientKeys],
    exclude_salt_variants: preferences.excludeSaltVariants,
    exclude_black_pepper_variants: preferences.excludeBlackPepperVariants,
  }
}

export function useShoppingDocumentState() {
  const { user, loading } = useAuthContext()
  return useQuery({
    queryKey: shoppingKeys.detail(principalId(user?.id)),
    queryFn: fetchShoppingDocumentState,
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled: !loading && Boolean(user),
  })
}

export function useShoppingList() {
  const { user } = useAuthContext()
  const documentQuery = useShoppingDocumentState()
  const pantryQuery = usePantryItems()
  return {
    ...documentQuery,
    data: documentQuery.data
      ? shoppingDocumentToList(
          principalId(user?.id),
          documentQuery.data,
          pantryQuery.data || []
        )
      : undefined,
    isLoading: documentQuery.isLoading || pantryQuery.isLoading,
    isFetching: documentQuery.isFetching || pantryQuery.isFetching,
  }
}

function useShoppingMutation<TVariables, TResult>(
  createPlan: (
    state: ShoppingDocumentStateV3,
    variables: TVariables
  ) => Promise<MutationPlan<TResult>> | MutationPlan<TResult>,
  options: { duplicateFeedbackOwner?: DuplicateFeedbackOwner } = {}
) {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const shoppingKey = shoppingKeys.detail(ownerUserId)
  const undoToast = useUndoToast()

  return useMutation({
    scope: { id: `${SHOPPING_DOCUMENT_WRITE_SCOPE}:${ownerUserId}` },
    mutationFn: async (variables: TVariables) => {
      const initial = queryClient.getQueryData<ShoppingDocumentStateV3>(shoppingKey) ||
        await fetchShoppingDocumentState()
      const plan = await createPlan(initial, variables)
      const state = await persistShoppingMutationWithReplay({
        initial,
        mutation: plan.mutation,
        write: (current, next) => writeShoppingDocumentCas(user!.id, current, next),
        refetch: fetchShoppingDocumentState,
        onRefetched: (fresh) => queryClient.setQueryData(shoppingKey, fresh),
        validateReplay: plan.validateReplay,
      })
      queryClient.setQueryData(shoppingKey, state)
      return plan.value
    },
    onError: (error) => {
      if (isAlreadyInShoppingListError(error) &&
          options.duplicateFeedbackOwner === 'caller') {
        return
      }
      undoToast.show({
        message: isAlreadyInShoppingListError(error)
          ? 'That item is already on the shopping list.'
          : error instanceof ShoppingDocumentConflictError
          ? error.message
          : 'Could not update the shopping list. Try again.',
        duration: 4000,
      })
    },
  })
}

function mutationForRow(
  item: ShoppingItem,
  derived: (aggregateKey: string) => ShoppingDocumentMutation,
  manual: (id: string) => ShoppingDocumentMutation
): ShoppingDocumentMutation {
  const rowRef = requireShoppingRowRef(item)
  return rowRef.startsWith('derived:')
    ? derived(rowRef.slice('derived:'.length))
    : manual(rowRef.slice('manual:'.length))
}

function quantityFromItem(item: ShoppingItem) {
  if (item.amount == null && !item.exactQuantityV1 && !item.exactPackageV1) {
    return null
  }
  return {
    amount: item.amount,
    unit: item.unit || '',
    exactQuantityV1: item.exactQuantityV1,
    exactPackageV1: item.exactPackageV1,
    exactAuthoredUnit: item.exactAuthoredUnit,
  }
}

export function useAddShoppingItem() {
  const pantryQuery = usePantryItems()

  return useShoppingMutation(async (state, input: {
    itemName: string
    amount?: number
    unit?: string
    rowId: string
  }) => {
    const [fallbackCategoryKey] = categorizeIngredient(input.itemName)
    const itemSemantics = resolveShoppingIngredientSemantics({
      item: input.itemName,
      unit: input.unit,
      fallbackCategoryKey,
    })
    const displayName = input.itemName.trim()
    let pantryItems = pantryQuery.data
    if (!pantryItems) {
      pantryItems = (await pantryQuery.refetch({ throwOnError: true })).data
    }
    if (!pantryItems) throw new Error('Could not load Pantry items')

    const resolvedPantryItems = [...pantryItems]
    const manualRowRef = `manual:${input.rowId}`
    const validateDuplicate = (current: ShoppingDocumentStateV3) => {
      const projection = projectShoppingDocument(
        current.document,
        resolvedPantryItems
      )
      if (projection.items.some((row) =>
        row.rowRef !== manualRowRef &&
        row.orderingKey === itemSemantics.purchaseKey)) {
        throw new Error('Item already in shopping list')
      }
    }
    validateDuplicate(state)
    const purchaseKey = itemSemantics.purchaseKey
    const defaultCategory = itemSemantics.defaultCategoryKey
    const item: ShoppingManualItemV1 = {
      id: input.rowId,
      displayName,
      quantity: input.amount == null && !input.unit
        ? null
        : { amount: input.amount ?? null, unit: normalizeUnit(input.unit || '') },
      categoryKey: state.document.preferences.categoryByIngredient[purchaseKey] ||
        defaultCategory,
      bucket: 'items',
      checked: false,
    }
    return {
      mutation: { type: 'addManualItem', item },
      value: item,
      validateReplay: validateDuplicate,
    }
  })
}

export function useUpdateShoppingItem() {
  return useShoppingMutation((state, input: {
    item: ShoppingItem
    updates: { itemName: string; amount?: number | null; unit?: string }
  }) => {
    const rowRef = requireShoppingRowRef(input.item)
    if (!rowRef.startsWith('manual:')) throw new Error('Only manual items can be edited')
    const itemSemantics = resolveShoppingIngredientSemantics({
      item: input.updates.itemName,
      unit: input.updates.unit,
    })
    const displayName = input.updates.itemName.trim()
    const projection = projectShoppingDocument(state.document)
    if (projection.rows.some((row) =>
      row.rowRef !== rowRef &&
      row.orderingKey === itemSemantics.purchaseKey)) {
      throw new Error('Item already in shopping list')
    }
    const quantity = input.updates.amount == null && !input.updates.unit
      ? null
      : {
          amount: input.updates.amount ?? null,
          unit: normalizeUnit(input.updates.unit || ''),
        }
    return {
      mutation: {
        type: 'editManualItem',
        id: rowRef.slice('manual:'.length),
        changes: { displayName, quantity },
      },
      value: { item: input.item, updates: input.updates },
    }
  }, { duplicateFeedbackOwner: 'caller' })
}

export function useRemoveShoppingItem() {
  return useShoppingMutation((_state, item: ShoppingItem) => ({
    mutation: mutationForRow(
      item,
      (aggregateKey) => ({ type: 'setSuppressed', aggregateKey, suppressed: true }),
      (id) => ({ type: 'deleteManualItem', id })
    ),
    value: item,
  }))
}

export function useRestoreShoppingItem() {
  return useShoppingMutation((_state, item: ShoppingItem) => ({
    mutation: mutationForRow(
      item,
      (aggregateKey) => ({ type: 'setSuppressed', aggregateKey, suppressed: false }),
      (id) => ({
        type: 'addManualItem',
        item: {
          id,
          displayName: item.item,
          quantity: quantityFromItem(item),
          categoryKey: item.categoryKey,
          bucket: 'items',
          checked: item.checked || false,
        },
      })
    ),
    value: item,
  }))
}

export function useCheckOffItem() {
  return useShoppingMutation((_state, intent: {
    rowRef: RowRef
    checked: boolean
  }) => ({
    mutation: {
      type: 'setChecked',
      rowRef: intent.rowRef,
      checked: intent.checked,
    },
    value: intent,
  }))
}

export function useBulkCheckOff() {
  return useShoppingMutation((_state, items: ShoppingItem[]) => ({
    mutation: {
      type: 'setCheckedMany',
      rowRefs: items.map((item) => requireShoppingRowRef(item)),
      checked: true,
    },
    value: { count: items.length },
  }))
}

export function useReorderShoppingList() {
  return useShoppingMutation((_state, input: {
    items: ShoppingItem[]
    draggedItem: ShoppingItem
    targetItem: ShoppingItem
    placement: 'before' | 'after'
  }) => {
    if (!input.draggedItem.orderingKey || !input.targetItem.orderingKey) {
      throw new Error('Shopping ordering identity is missing')
    }
    return {
      mutation: {
        type: 'learnOrder',
        draggedRowRef: requireShoppingRowRef(input.draggedItem),
        draggedOrderingKey: input.draggedItem.orderingKey,
        sourceCategoryKey: input.draggedItem.categoryKey,
        targetRowRef: requireShoppingRowRef(input.targetItem),
        targetOrderingKey: input.targetItem.orderingKey,
        targetCategoryKey: input.targetItem.categoryKey,
        placement: input.placement,
      },
      value: input,
    }
  })
}

export function useMoveToShoppingList() {
  return useShoppingMutation((_state, item: ShoppingItem) => ({
    mutation: mutationForRow(
      item,
      (aggregateKey) => ({ type: 'setBucketOverride', aggregateKey, bucket: 'items' }),
      (id) => ({ type: 'editManualItem', id, changes: { bucket: 'items' } })
    ),
    value: item,
  }))
}

export const useMoveExcludedToShoppingList = useMoveToShoppingList

export type RecipeContributionIdentity = {
  recipeId: string
  recipeName: string
}

export function useRemoveRecipeItems() {
  return useShoppingMutation((state, identity: RecipeContributionIdentity) => ({
    mutation: { type: 'removeRecipe', recipeId: identity.recipeId },
    value: {
      identity,
      entry: state.document.recipeEntries[identity.recipeId] || null,
    },
  }))
}

export function useRestoreRecipeItems() {
  return useShoppingMutation((_state, entry: ShoppingRecipeEntryV2) => ({
    mutation: { type: 'upsertRecipe', entry },
    value: entry,
  }))
}

function resolveScale(scale: number, scaleV1?: RationalV1): RationalV1 {
  const resolved = normalizeScaleRatioV1(scaleV1) ||
    normalizeScaleRatioV1(parseRationalLexeme(String(scale)))
  if (!resolved) throw new Error('Scale must be a positive finite value')
  return resolved
}

export function useAddToShoppingList() {
  return useShoppingMutation(async (state, input: {
    recipeIds: string[]
    scale?: number
    scaleV1?: RationalV1
    idempotencyKey?: string
  }) => {
    const recipeIds = [...new Set(input.recipeIds)]
    const scale = input.scale ?? 1
    const exactScale = resolveScale(scale, input.scaleV1)
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('recipes')
      .select('*')
      .in('recipe_uuid', recipeIds)
    if (error) throw error
    const recipes = mapRecipeRows(data as never)
    if (recipes.length !== recipeIds.length) throw new Error('Recipe not found')
    const entries = recipes.map((recipe: Recipe) => createShoppingRecipeEntry(
      recipe,
      recipe.servings * scale,
      exactScale
    ))
    const previousKeys = new Set(Object.values(state.document.recipeEntries)
      .flatMap((entry) => entry.ingredients.map((ingredient) => ingredient.aggregateKey)))
    const otherKeys = new Set(Object.values(state.document.recipeEntries)
      .filter((entry) => !recipeIds.includes(entry.recipeId))
      .flatMap((entry) => entry.ingredients.map((ingredient) => ingredient.aggregateKey)))
    const incomingKeys = new Set(entries.flatMap((entry) =>
      entry.ingredients.map((ingredient) => ingredient.aggregateKey)))
    return {
      mutation: { type: 'upsertRecipes', entries },
      value: {
        added: [...incomingKeys].filter((key) => !previousKeys.has(key)).length,
        merged: [...incomingKeys].filter((key) => otherKeys.has(key)).length,
      },
    }
  })
}

export function useClearShoppingList() {
  return useShoppingMutation((state, _variables: void) => ({
    mutation: { type: 'complete' },
    value: {
      recipeEntries: state.document.recipeEntries,
      manualItems: state.document.manualItems,
      itemOverrides: state.document.itemOverrides,
    },
  }))
}

export function useRestoreShoppingContent() {
  return useShoppingMutation((_state, content: Pick<
    ShoppingDocumentV3,
    'recipeEntries' | 'manualItems' | 'itemOverrides'
  >) => ({
    mutation: { type: 'restoreContent', content },
    value: content,
  }))
}

export function useShoppingConfig() {
  const query = useShoppingDocumentState()
  return {
    ...query,
    data: query.data ? shoppingDocumentToConfig(query.data) : undefined,
  }
}

export function createShoppingConfigUpdateMutation(
  updates: Partial<ShoppingConfig>
): ShoppingDocumentMutation {
  const preferences: Partial<ShoppingDocumentStateV3['document']['preferences']> = {}
  let updatesCategoryPreferences = false
  if ('category_overrides' in updates && updates.category_overrides !== undefined) {
    updatesCategoryPreferences = true
    // Config keys came from persisted V3 preferences and are already stable
    // purchase identities. Raw ingredient text is resolved before this boundary.
    preferences.categoryByIngredient = { ...(updates.category_overrides || {}) }
  }
  if ('custom_categories' in updates && updates.custom_categories !== undefined) {
    updatesCategoryPreferences = true
    preferences.customCategories = updates.custom_categories || []
  }
  if ('category_order' in updates && updates.category_order !== undefined) {
    updatesCategoryPreferences = true
    const categoryOrder = updates.category_order as unknown
    preferences.categoryOrder = Array.isArray(categoryOrder)
      ? categoryOrder.filter((value): value is string => typeof value === 'string')
      : []
  }
  if ('excluded_keywords' in updates && updates.excluded_keywords !== undefined) {
    preferences.excludedIngredientKeys = [...new Set((updates.excluded_keywords || [])
      .map((keyword) => createShoppingPurchaseKey(keyword))
      .filter(Boolean))]
  }
  if ('exclude_salt_variants' in updates && updates.exclude_salt_variants !== undefined) {
    preferences.excludeSaltVariants = updates.exclude_salt_variants
  }
  if ('exclude_black_pepper_variants' in updates &&
      updates.exclude_black_pepper_variants !== undefined) {
    preferences.excludeBlackPepperVariants = updates.exclude_black_pepper_variants
  }
  return updatesCategoryPreferences
    ? { type: 'updateCategoryPreferences', preferences }
    : { type: 'updatePreferences', preferences }
}

export function useUpdateShoppingConfig() {
  return useShoppingMutation((_state, updates: Partial<ShoppingConfig>) => {
    return {
      mutation: createShoppingConfigUpdateMutation(updates),
      value: updates,
    }
  })
}

export function useUpdateExcludedKeywords() {
  const update = useUpdateShoppingConfig()
  return {
    ...update,
    mutate: (keywords: string[], options?: Parameters<typeof update.mutate>[1]) =>
      update.mutate({ excluded_keywords: keywords }, options),
    mutateAsync: (keywords: string[]) =>
      update.mutateAsync({ excluded_keywords: keywords }),
  }
}

export type IngredientExclusionSetting =
  | 'exclude_salt_variants'
  | 'exclude_black_pepper_variants'

export function useUpdateIngredientExclusionSetting() {
  const update = useUpdateShoppingConfig()
  return {
    ...update,
    mutate: (
      input: { setting: IngredientExclusionSetting; enabled: boolean },
      options?: Parameters<typeof update.mutate>[1]
    ) => update.mutate({ [input.setting]: input.enabled }, options),
  }
}

type PantryMoveRow = ShoppingDocumentRow & {
  pantry_item: PantryItem | null
  pantry_was_inserted: boolean
}

async function moveToPantryCas(
  current: ShoppingDocumentStateV3,
  next: ShoppingDocumentStateV3,
  item: ShoppingItem
): Promise<{ state: ShoppingDocumentStateV3; pantryItem: PantryItem | null; wasAdded: boolean } | null> {
  const supabase = getSupabase()
  const rpc = supabase as unknown as {
    rpc: (name: 'move_shopping_document_item_to_pantry', args: {
      p_expected_revision: number
      p_document: unknown
      p_item: string
      p_pantry_qty: number | null
      p_pantry_unit: string
    }) => Promise<{ data: PantryMoveRow[] | null; error: { code?: string; message: string } | null }>
  }
  const { data, error } = await rpc.rpc('move_shopping_document_item_to_pantry', {
    p_expected_revision: current.contentRevision,
    p_document: next.document,
    p_item: normalizePantryItemName(item.item),
    p_pantry_qty: item.amount,
    p_pantry_unit: item.unit || '',
  })
  if (error?.code === '40001') return null
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return {
    state: parseShoppingDocumentRow(row),
    pantryItem: row.pantry_item,
    wasAdded: row.pantry_was_inserted,
  }
}

export function useAddToPantryAndRemove() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const shoppingKey = shoppingKeys.detail(ownerUserId)
  const pantryQuery = usePantryItems()
  const undoToast = useUndoToast()

  return useMutation({
    scope: { id: `${SHOPPING_DOCUMENT_WRITE_SCOPE}:${ownerUserId}` },
    mutationFn: async (item: ShoppingItem) => {
      const initial = queryClient.getQueryData<ShoppingDocumentStateV3>(shoppingKey) ||
        await fetchShoppingDocumentState()
      const rowRef = requireShoppingRowRef(item)
      const mutation: ShoppingDocumentMutation = rowRef.startsWith('derived:')
        ? {
            type: 'setBucketOverride',
            aggregateKey: rowRef.slice('derived:'.length),
            bucket: undefined,
          }
        : {
            type: 'editManualItem',
            id: rowRef.slice('manual:'.length),
            changes: { bucket: 'already_have' },
          }
      let pantryResult: Awaited<ReturnType<typeof moveToPantryCas>> = null
      const state = await persistShoppingMutationWithReplay({
        initial,
        mutation,
        write: async (current, next) => {
          pantryResult = await moveToPantryCas(current, next, item)
          return pantryResult?.state || null
        },
        refetch: fetchShoppingDocumentState,
        onRefetched: (fresh) => queryClient.setQueryData(shoppingKey, fresh),
        forceWrite: true,
      })
      const completedPantryResult = pantryResult as Exclude<
        Awaited<ReturnType<typeof moveToPantryCas>>,
        null
      > | null
      return {
        state,
        item,
        pantryItem: completedPantryResult?.pantryItem || null,
        wasAdded: completedPantryResult?.wasAdded || false,
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(shoppingKey, result.state)
      if (result.pantryItem) {
        const next = [...(pantryQuery.data || []).filter((item) =>
          item.id !== result.pantryItem!.id), result.pantryItem]
          .sort((left, right) => left.item.localeCompare(right.item))
        queryClient.setQueryData(pantryKeys.list(ownerUserId), next)
      }
    },
    onError: (error) => {
      undoToast.show({
        message: error instanceof ShoppingDocumentConflictError
          ? error.message
          : 'Could not move that item to Pantry. Try again.',
        duration: 4000,
      })
    },
  })
}

export { createEmptyShoppingDocument, applyShoppingDocumentMutation }
