'use client'

import { executeShoppingCommand } from '@/lib/shopping-command-client'
import { shoppingRecipeSelections } from '@/lib/shopping-sources'
import { readShoppingCompatibility } from '@/lib/shopping-compatibility'

import { shoppingDocumentToList, shoppingDocumentToConfig } from '@/lib/shopping-view'
export { shoppingDocumentToList, shoppingDocumentToConfig } from '@/lib/shopping-view'
import { manualShoppingQuantity, validateManualPurchaseIntent } from '@/lib/shopping-manual-rules'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  settingValue, validateSettingIntent, validateSettingsReplacement,
  ShoppingSettingsConflictError,
  type ShoppingSettingIntent,
} from '@/lib/shopping-settings'
import { useAuthContext } from '@/lib/auth-context'
import { getActivePrincipalId } from '@/lib/principal-session'
import { useUndoToast } from '@/hooks/use-undo-toast'
import { usePantryItems } from '@/hooks/use-pantry'
import { mapRecipeRows } from '@/lib/recipe-identity'
import { pantryKeys, principalId, shoppingKeys } from '@/lib/query-keys'
import {
  applyShoppingDocumentMutation,
  createEmptyShoppingDocument,
  createShoppingRecipeEntry,
  projectShoppingDocument,
  type RowRef,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV3,
  type ShoppingDocumentV3,
  type ShoppingManualItemV1,
  type ShoppingRecipeEntryV2,
} from '@/lib/shopping-document'
import {
  ShoppingDocumentConflictError,
  type ShoppingDocumentReplayValidator,
} from '@/lib/shopping-document-persistence'
import { createShoppingPurchaseKey } from '@/lib/shopping-list-normalization'
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics'
import { categorizeIngredient } from '@/lib/shopping-categories'
import {
  normalizeScaleRatioV1,
  parseRationalLexeme,
} from '@/lib/recipe-quantity'
import { isAlreadyInShoppingListError } from '@/lib/shopping-feedback'
import { getSupabase } from '@/lib/supabase/client'
import { requireShoppingRowRef } from '@/lib/shopping-row-reference'
import type {
  PantryItem,
  RationalV1,
  Recipe,
  ShoppingConfig,
  ShoppingItem,
} from '@/types/database'

const SHOPPING_DOCUMENT_WRITE_SCOPE = 'shopping-document-write'

type ShoppingDocumentRow = {
  document: unknown
  content_revision: number
}

type MutationPlan<TResult> = {
  mutation: ShoppingDocumentMutation
  value: TResult
  committedValue?: (
    before: ShoppingDocumentStateV3,
    committed: ShoppingDocumentStateV3,
    receipt?: { undoAvailable?: boolean | null; historical?: boolean }
  ) => TResult
  validateReplay?: ShoppingDocumentReplayValidator
  forceWrite?: boolean
  resolvedValue?: (before: ShoppingDocumentStateV3, after: ShoppingDocumentStateV3, outcome?: string) => TResult
}

export const SHOPPING_CLEAR_UNDO_UNAVAILABLE =
  'Undo is currently unavailable for lists containing recipe items.'

export class ShoppingClearUndoConflictError extends ShoppingDocumentConflictError {
  constructor(message = 'Shopping changed after Clear; Undo was not applied.') {
    super()
    this.message = message
    this.name = 'ShoppingClearUndoConflictError'
  }
}

export interface ShoppingClearResult {
  readonly ownerUserId: string
  readonly postClearRevision: number
  readonly undoAvailable?: boolean
  readonly historical?: boolean
  readonly content: Pick<ShoppingDocumentV3,
    'recipeEntries' | 'manualItems' | 'itemOverrides'>
}

type DuplicateFeedbackOwner = 'mutation' | 'caller'

export class ShoppingDocumentReadError extends Error {
  constructor() {
    super('This shopping list could not be opened. Your saved list has not been changed.')
    this.name = 'ShoppingDocumentReadError'
  }
}

function assertShoppingReadable(queryClient: ReturnType<typeof useQueryClient>, key: readonly string[]) {
  if (queryClient.getQueryState(key)?.status === 'error') {
    throw new Error('Could not load the shopping list. Try again.')
  }
}

function parseShoppingDocumentRow(row: ShoppingDocumentRow): ShoppingDocumentStateV3 {
  const result = readShoppingCompatibility(row.document, Number(row.content_revision))
  if (result.status !== 'Supported') throw new ShoppingDocumentReadError()
  return result.state
}

async function fetchShoppingDocumentState(ownerUserId?: string): Promise<ShoppingDocumentStateV3> {
  const supabase = getSupabase()
  const request = supabase.from('shopping_list') as unknown as {
    select: (columns: string) => {
      eq: (column: string, value: string) => ReturnType<typeof request.select>
      maybeSingle: () => Promise<{
        data: ShoppingDocumentRow | null
        error: { message: string } | null
      }>
    }
  }
  const selection = request.select('document,content_revision')
  const { data, error } = await (ownerUserId
    ? selection.eq('user_id', ownerUserId)
    : selection).maybeSingle()
  if (error) throw error
  if (!data) return { document: createEmptyShoppingDocument(), contentRevision: 0 }
  return parseShoppingDocumentRow(data)
}

export function useShoppingDocumentState() {
  const { user, loading } = useAuthContext()
  return useQuery({
    queryKey: shoppingKeys.detail(principalId(user?.id)),
    queryFn: () => fetchShoppingDocumentState(),
    retry: (count, error) => !(error instanceof ShoppingDocumentReadError) && count < 2,
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
    data: documentQuery.data && pantryQuery.data !== undefined
      ? shoppingDocumentToList(
          principalId(user?.id),
          documentQuery.data,
          pantryQuery.data
        )
      : undefined,
    selections: documentQuery.data ? shoppingRecipeSelections(documentQuery.data.document.recipeEntries) : [],
    documentError: documentQuery.error,
    pantryError: pantryQuery.error,
    hasDocument: documentQuery.data !== undefined,
    hasPantry: pantryQuery.data !== undefined,
    canAddItem: documentQuery.isSuccess && pantryQuery.isSuccess,
    retryDocument: () => documentQuery.refetch(),
    retryPantry: () => pantryQuery.refetch(),
    isLoading: documentQuery.isLoading || pantryQuery.isLoading,
    isFetching: documentQuery.isFetching || pantryQuery.isFetching,
  }
}

function useShoppingMutation<TVariables, TResult>(
  createPlan: (
    state: ShoppingDocumentStateV3,
    variables: TVariables
  ) => Promise<MutationPlan<TResult>> | MutationPlan<TResult>,
  options: {
    duplicateFeedbackOwner?: DuplicateFeedbackOwner
    fenceOwner?: boolean
    settings?: boolean
  } = {}
) {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const shoppingKey = shoppingKeys.detail(ownerUserId)
  const undoToast = useUndoToast()

  return useMutation({
    // A queued Clear must not acquire the next owner's mutation function.
    mutationKey: options.fenceOwner ? [options.settings ? 'shopping-settings' : 'shopping-clear-undo', ownerUserId] : undefined,
    scope: { id: `${SHOPPING_DOCUMENT_WRITE_SCOPE}:${ownerUserId}` },
    mutationFn: async (variables: TVariables) => {
      const assertOwner = () => {
        if (!user || getActivePrincipalId() !== ownerUserId) {
          throw new ShoppingClearUndoConflictError(
            options.settings
              ? 'Your account changed. The settings change was not completed.'
              : 'Shopping account changed; Clear/Undo was not completed for this account.'
          )
        }
      }
      const refetch = async () => {
        assertOwner()
        const fresh = await fetchShoppingDocumentState(options.fenceOwner ? ownerUserId : undefined)
        assertOwner()
        return fresh
      }
      const cacheState = (next: ShoppingDocumentStateV3) => {
        assertOwner()
        queryClient.setQueryData<ShoppingDocumentStateV3>(shoppingKey, (cached) =>
          cached && cached.contentRevision > next.contentRevision ? cached : next)
      }
      assertOwner()
      assertShoppingReadable(queryClient, shoppingKey)
      const initial = options.settings ? await refetch() :
        queryClient.getQueryData<ShoppingDocumentStateV3>(shoppingKey) || await refetch()
      if (options.settings) cacheState(initial)
      const plan = await createPlan(initial, variables)
      assertOwner()
      let value = plan.value
      const command = {
        protocol: 1 as const,
        observedRevision: initial.contentRevision,
        mutation: plan.mutation,
        ...(plan.mutation.type === 'editManualItem' ? {
          observedManual: initial.document.manualItems.find((item) =>
            plan.mutation.type === 'editManualItem' && item.id === plan.mutation.id),
        } : {}),
        ...((plan.mutation.type === 'setExclusion' || plan.mutation.type === 'setFamilySetting')
          ? { observedSetting: settingValue(initial, plan.mutation) } : {}),
      }
      let result
      try {
        result = await executeShoppingCommand(ownerUserId, command)
      } catch (error) {
        cacheState(await refetch())
        if (plan.mutation.type === 'restoreContent' && error instanceof ShoppingDocumentConflictError) {
          throw new ShoppingClearUndoConflictError()
        }
        throw error
      }
      let state: ShoppingDocumentStateV3
      try { state = await refetch() } catch {
        assertOwner()
        // Execution is known committed. A subsequent read failure must not
        // turn it into a failed input submission that invites another write.
        undoToast.show({ message: 'Shopping change confirmed. Could not refresh the list; try loading it again.' })
        void queryClient.invalidateQueries({ queryKey: shoppingKey })
        if (plan.committedValue && result.receipt?.outcome === 'Applied') {
          return plan.committedValue(result.before || initial,
            { ...initial, contentRevision: result.receipt.revision },
            { undoAvailable: false, historical: result.status === 'AlreadyApplied' })
        }
        return plan.value
      }
      if (plan.mutation.type === 'complete' && result.receipt && state.contentRevision > result.receipt.revision) {
        cacheState(state)
        throw new ShoppingClearUndoConflictError('Shopping changed before the response arrived. Review the latest list; Clear Undo is unavailable.')
      }
      if (result.before && result.receipt?.outcome === 'Applied') {
        const committed = { document: state.document, contentRevision: result.receipt.revision }
        if (plan.committedValue) value = plan.committedValue(result.before, committed, result.receipt)
        if (plan.resolvedValue) value = plan.resolvedValue(result.before, committed, result.receipt.outcome)
      } else if (plan.committedValue && result.receipt?.outcome === 'Applied') {
        value = plan.committedValue({ document: createEmptyShoppingDocument(), contentRevision: 0 },
          { ...state, contentRevision: result.receipt.revision }, { undoAvailable: false, historical: true })
      } else if (plan.resolvedValue) {
        value = plan.resolvedValue(state, state, result.receipt?.outcome)
      }
      assertOwner()
      const cached = queryClient.getQueryData<ShoppingDocumentStateV3>(shoppingKey)
      if (options.fenceOwner && cached && cached.contentRevision > state.contentRevision) {
        throw new ShoppingClearUndoConflictError(
          options.settings
            ? 'Shopping changed before the response arrived. Review the latest settings.'
            : 'Shopping changed before the response arrived. Review the latest list; Clear Undo is unavailable.'
        )
      }
      cacheState(state)
      return value
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
    if (!pantryItems || pantryQuery.isError) {
      pantryItems = (await pantryQuery.refetch({ throwOnError: true })).data
    }
    if (!pantryItems) throw new Error('Could not load Pantry items')

    const resolvedPantryItems = [...pantryItems]
    const manualRowRef = `manual:${input.rowId}`
    const validateDuplicate = (current: ShoppingDocumentStateV3) => {
      const outcome = validateManualPurchaseIntent(current.document, {
        type: 'add', rowRef: manualRowRef, purchaseKey: itemSemantics.purchaseKey,
        pantryItems: resolvedPantryItems,
      })
      if (outcome === 'Conflict') throw new Error('Item already in shopping list')
    }
    validateDuplicate(state)
    const purchaseKey = itemSemantics.purchaseKey
    const defaultCategory = itemSemantics.defaultCategoryKey
    const item: ShoppingManualItemV1 = {
      id: input.rowId,
      displayName,
      quantity: manualShoppingQuantity(input.amount, input.unit),
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
    const validateIdentityChange = (current: ShoppingDocumentStateV3) => {
      const outcome = validateManualPurchaseIntent(current.document, {
        type: 'edit', rowRef, purchaseKey: itemSemantics.purchaseKey,
      })
      if (outcome === 'TargetGone') throw new Error('Manual item no longer exists')
      if (outcome === 'Conflict') throw new Error('Item already in shopping list')
    }
    validateIdentityChange(state)
    const quantity = manualShoppingQuantity(input.updates.amount, input.updates.unit)
    return {
      mutation: {
        type: 'editManualItem',
        id: rowRef.slice('manual:'.length),
        changes: { displayName, quantity },
      },
      value: { item: input.item, updates: input.updates },
      validateReplay: validateIdentityChange,
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
  const { user } = useAuthContext()
  return useShoppingMutation<void, ShoppingClearResult | null>(() => ({
    mutation: { type: 'complete' },
    value: null,
    committedValue: (before, committed, receipt) => ({
      ownerUserId: user!.id,
      postClearRevision: committed.contentRevision,
      undoAvailable: receipt?.undoAvailable !== false,
      historical: receipt?.historical === true,
      content: {
        recipeEntries: before.document.recipeEntries,
        manualItems: before.document.manualItems,
        itemOverrides: before.document.itemOverrides,
      },
    }),
  }), { fenceOwner: true })
}

export function useRestoreShoppingContent() {
  const { user } = useAuthContext()
  return useShoppingMutation((state, result: ShoppingClearResult) => {
    const validate = (current: ShoppingDocumentStateV3) => {
      if (!result || result.ownerUserId !== user?.id ||
          current.contentRevision !== result.postClearRevision) {
        throw new ShoppingClearUndoConflictError()
      }
      if (Object.keys(result.content.recipeEntries).length > 0) {
        throw new ShoppingClearUndoConflictError(SHOPPING_CLEAR_UNDO_UNAVAILABLE)
      }
      if (result.content.manualItems.length === 0 &&
          Object.keys(result.content.itemOverrides).length === 0) {
        throw new ShoppingClearUndoConflictError()
      }
    }
    validate(state)
    return {
      mutation: { type: 'restoreContent', content: result.content },
      value: undefined,
      validateReplay: validate,
      // Even cache equality must be acknowledged by the fixed-revision CAS.
      forceWrite: true,
    }
  }, { fenceOwner: true })
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
  const { user } = useAuthContext()
  const owner = user?.id
  const query = useShoppingDocumentState()
  const update = useShoppingMutation((state, input: {
    updates: Partial<ShoppingConfig>; observed: ShoppingDocumentStateV3 | undefined; owner: string | undefined
  }) => {
    if (!input.owner || input.owner !== getActivePrincipalId()) throw new ShoppingSettingsConflictError()
    const { updates, observed } = input
    const affectsSettings = updates.excluded_keywords !== undefined ||
      updates.exclude_salt_variants !== undefined ||
      updates.exclude_black_pepper_variants !== undefined
    const validateReplay = affectsSettings
      ? (fresh: ShoppingDocumentStateV3) => validateSettingsReplacement(observed, fresh)
      : undefined
    validateReplay?.(state)
    return {
      mutation: createShoppingConfigUpdateMutation(updates),
      value: shoppingDocumentToConfig(state),
      resolvedValue: (_before: ShoppingDocumentStateV3, after: ShoppingDocumentStateV3) =>
        shoppingDocumentToConfig(after),
      validateReplay,
    }
  }, { fenceOwner: true, settings: true })
  return {
    ...update,
    mutate: (updates: Partial<ShoppingConfig>, options?: Parameters<typeof update.mutate>[1]) =>
      update.mutate({ updates, observed: query.data, owner }, options),
    mutateAsync: (updates: Partial<ShoppingConfig>) =>
      update.mutateAsync({ updates, observed: query.data, owner }),
  }
}

function useShoppingSettingMutation() {
  const { user } = useAuthContext()
  const owner = user?.id
  const query = useShoppingDocumentState()
  const update = useShoppingMutation((state, input: {
    intent: ShoppingSettingIntent; observed: ShoppingDocumentStateV3 | undefined; owner: string | undefined
  }) => {
    if (!input.owner || input.owner !== getActivePrincipalId()) throw new ShoppingSettingsConflictError()
    const validateReplay = (fresh: ShoppingDocumentStateV3) =>
      validateSettingIntent(input.observed, fresh, input.intent)
    validateReplay(state)
    const result = (before: ShoppingDocumentStateV3) =>
      settingValue(before, input.intent) === input.intent.enabled ? 'unchanged' as const : 'applied' as const
    return {
      mutation: input.intent, value: result(state), validateReplay,
      resolvedValue: (before: ShoppingDocumentStateV3, _after: ShoppingDocumentStateV3, outcome?: string) =>
        outcome === 'Applied' ? 'applied' as const : outcome === 'Unchanged' ? 'unchanged' as const : result(before),
    }
  }, { fenceOwner: true, settings: true })
  return {
    ...update,
    mutate: (intent: ShoppingSettingIntent, options?: Parameters<typeof update.mutate>[1]) =>
      update.mutate({ intent, observed: query.data, owner }, options),
    mutateAsync: (intent: ShoppingSettingIntent) =>
      update.mutateAsync({ intent, observed: query.data, owner }),
  }
}

export function useSetShoppingExclusion() {
  const update = useShoppingSettingMutation()
  return {
    ...update,
    mutateAsync: (input: { keyword: string; enabled: boolean }) => {
      const key = createShoppingPurchaseKey(input.keyword)
      if (!key) return Promise.reject(new Error('Enter an ingredient to exclude.'))
      return update.mutateAsync({ type: 'setExclusion', key, enabled: input.enabled })
    },
  }
}

export type IngredientExclusionSetting =
  | 'exclude_salt_variants'
  | 'exclude_black_pepper_variants'

export function useUpdateIngredientExclusionSetting() {
  const update = useShoppingSettingMutation()
  return {
    ...update,
    mutate: (
      input: { setting: IngredientExclusionSetting; enabled: boolean },
      options?: Parameters<typeof update.mutate>[1]
    ) => update.mutate({
      type: 'setFamilySetting',
      setting: input.setting === 'exclude_salt_variants' ? 'excludeSaltVariants' : 'excludeBlackPepperVariants',
      enabled: input.enabled,
    }, options),
  }
}

export function useAddToPantryAndRemove() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)
  const shoppingKey = shoppingKeys.detail(ownerUserId)
  const undoToast = useUndoToast()

  return useMutation({
    scope: { id: `${SHOPPING_DOCUMENT_WRITE_SCOPE}:${ownerUserId}` },
    mutationFn: async (item: ShoppingItem) => {
      assertShoppingReadable(queryClient, shoppingKey)
      const initial = queryClient.getQueryData<ShoppingDocumentStateV3>(shoppingKey) ||
        await fetchShoppingDocumentState()
      const rowRef = requireShoppingRowRef(item)
      const result = await executeShoppingCommand(ownerUserId, {
        protocol: 1, observedRevision: initial.contentRevision,
        mutation: { type: 'pantry', rowRef },
      })
      let state: ShoppingDocumentStateV3 | null = null
      try { state = await fetchShoppingDocumentState(ownerUserId) } catch {
        if (getActivePrincipalId() !== ownerUserId) throw new ShoppingDocumentConflictError()
        undoToast.show({ message: 'Pantry move confirmed. Could not refresh Shopping; try loading it again.' })
        void queryClient.invalidateQueries({ queryKey: shoppingKey })
      }
      if (getActivePrincipalId() !== ownerUserId) throw new ShoppingDocumentConflictError()
      return {
        state, item,
        pantryItem: result.receipt?.pantryId ? {
          id: result.receipt.pantryId, user_id: ownerUserId,
          item: item.item, created_at: '',
        } as PantryItem : null,
        wasAdded: result.receipt?.pantryWasAdded || false,
      }
    },
    onSuccess: (result) => {
      const state = result.state
      if (state) queryClient.setQueryData<ShoppingDocumentStateV3>(shoppingKey, (cached) =>
        cached && cached.contentRevision > state.contentRevision ? cached : state)
      // A bridge result is one row, never an authoritative Pantry snapshot.
      void queryClient.invalidateQueries({ queryKey: pantryKeys.list(ownerUserId) })
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
