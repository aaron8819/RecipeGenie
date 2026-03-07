"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useUndoToast } from "@/components/ui/undo-toast"
import { requireShoppingRowId } from "@/lib/shopping-row-identity"
import { removeRecipeByNameFromItems } from "@/lib/shopping-list-merging"
import type { ShoppingItem, ShoppingList } from "@/types/database"
import { SHOPPING_KEY } from "./shared"

const DEFAULT_UNDO_DURATION_MS = 5000

type PendingAction =
  | {
      id: string
      kind: "remove-item"
      rowId: string
      itemName: string
      message: string
      createdAt: number
      commit: () => Promise<unknown>
    }
  | {
      id: string
      kind: "remove-recipe"
      recipeName: string
      message: string
      createdAt: number
      commit: () => Promise<unknown>
    }
  | {
      id: string
      kind: "clear-list"
      message: string
      createdAt: number
      commit: () => Promise<unknown>
    }

function cloneShoppingList(list: ShoppingList): ShoppingList {
  return {
    ...list,
    items: [...list.items],
    already_have: [...list.already_have],
    excluded: [...list.excluded],
    source_recipes: [...(list.source_recipes || [])],
  }
}

export function applyPendingShoppingActions(
  shoppingList: ShoppingList | null | undefined,
  actions: PendingAction[]
): ShoppingList | null | undefined {
  if (!shoppingList || actions.length === 0) {
    return shoppingList
  }

  let projected = cloneShoppingList(shoppingList)

  for (const action of actions) {
    if (action.kind === "remove-item") {
      projected = {
        ...projected,
        items: projected.items.filter((item) => item.rowId !== action.rowId),
      }
      continue
    }

    if (action.kind === "remove-recipe") {
      projected = {
        ...projected,
        items: removeRecipeByNameFromItems(projected.items, action.recipeName),
        already_have: removeRecipeByNameFromItems(projected.already_have, action.recipeName),
        excluded: removeRecipeByNameFromItems(projected.excluded, action.recipeName),
      }
      continue
    }

    projected = {
      ...projected,
      items: [],
      already_have: [],
      excluded: [],
      source_recipes: [],
      scale: 1.0,
      total_servings: 0,
      custom_order: false,
    }
  }

  return projected
}

export function useShoppingPendingActions(params: {
  removeItemCommit: { mutateAsync: (rowId: string) => Promise<unknown> }
  removeRecipeCommit: { mutateAsync: (recipeName: string) => Promise<unknown> }
  clearListCommit: { mutateAsync: () => Promise<unknown> }
}) {
  const queryClient = useQueryClient()
  const { show: showUndoToast, dismiss: dismissUndoToast } = useUndoToast()
  const [queue, setQueue] = useState<PendingAction[]>([])
  const queueRef = useRef<PendingAction[]>([])
  const activeToastIdRef = useRef<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const idCounterRef = useRef(0)
  const resolvingIdsRef = useRef<Set<string>>(new Set())

  const syncQueue = useCallback((updater: (current: PendingAction[]) => PendingAction[]) => {
    setQueue((current) => {
      const next = updater(current)
      queueRef.current = next
      return next
    })
  }, [])

  const projectShoppingList = useCallback((shoppingList: ShoppingList | null | undefined) => {
    return applyPendingShoppingActions(shoppingList, queue)
  }, [queue])

  const resolveAction = useCallback(async (actionId: string, resolution: "undo" | "commit") => {
    const action = queueRef.current.find((candidate) => candidate.id === actionId)
    if (!action) return
    if (resolvingIdsRef.current.has(actionId)) return
    resolvingIdsRef.current.add(actionId)

    try {
      if (queueRef.current[0]?.id === actionId && timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      if (resolution === "commit") {
        try {
          await action.commit()
          await queryClient.invalidateQueries({ queryKey: [...SHOPPING_KEY] })
        } catch {
          showUndoToast({
            message: "Failed to update shopping list",
            duration: 4000,
          })
        }
      }

      activeToastIdRef.current = null
      syncQueue((current) => current.filter((candidate) => candidate.id !== actionId))
    } finally {
      resolvingIdsRef.current.delete(actionId)
    }
  }, [queryClient, showUndoToast, syncQueue])

  const commitAllPending = useCallback(() => {
    const pendingIds = queueRef.current.map((action) => action.id)
    pendingIds.forEach((actionId) => {
      void resolveAction(actionId, "commit")
    })
  }, [resolveAction])

  useEffect(() => {
    const activeAction = queue[0]

    if (!activeAction) {
      activeToastIdRef.current = null
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (activeToastIdRef.current === activeAction.id) {
      return
    }

    activeToastIdRef.current = activeAction.id

    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    const remainingDuration = Math.max(
      0,
      DEFAULT_UNDO_DURATION_MS - (Date.now() - activeAction.createdAt)
    )

    if (remainingDuration === 0) {
      void resolveAction(activeAction.id, "commit")
      return
    }

    timerRef.current = setTimeout(() => {
      void resolveAction(activeAction.id, "commit")
    }, remainingDuration)

    showUndoToast({
      message: activeAction.message,
      duration: remainingDuration,
      queueBehavior: "enqueue",
      onUndo: () => {
        void resolveAction(activeAction.id, "undo")
      },
      onDismiss: () => {
        void resolveAction(activeAction.id, "commit")
      },
      onExpire: () => {
        void resolveAction(activeAction.id, "commit")
      },
    })
  }, [queue, resolveAction, showUndoToast])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      if (queueRef.current.length > 0) {
        commitAllPending()
        if (activeToastIdRef.current) {
          dismissUndoToast()
        }
      }
    }
  }, [commitAllPending, dismissUndoToast])

  const enqueueRemoveItem = useCallback((item: ShoppingItem) => {
    const rowId = requireShoppingRowId(item, "pending remove shopping item")
    const actionId = `shopping-remove-item-${idCounterRef.current++}`
    const createdAt = Date.now()
    syncQueue((current) => [
      ...current,
      {
        id: actionId,
        kind: "remove-item",
        rowId,
        itemName: item.item,
        message: `"${item.item}" removed from list`,
        createdAt,
        commit: () => params.removeItemCommit.mutateAsync(rowId),
      },
    ])
  }, [params.removeItemCommit, syncQueue])

  const enqueueRemoveRecipe = useCallback((recipeName: string) => {
    const actionId = `shopping-remove-recipe-${idCounterRef.current++}`
    const createdAt = Date.now()
    syncQueue((current) => [
      ...current,
      {
        id: actionId,
        kind: "remove-recipe",
        recipeName,
        message: `Items from "${recipeName}" removed`,
        createdAt,
        commit: () => params.removeRecipeCommit.mutateAsync(recipeName),
      },
    ])
  }, [params.removeRecipeCommit, syncQueue])

  const enqueueClearList = useCallback(() => {
    const actionId = `shopping-clear-list-${idCounterRef.current++}`
    const createdAt = Date.now()
    syncQueue((current) => [
      ...current,
      {
        id: actionId,
        kind: "clear-list",
        message: "Shopping list cleared",
        createdAt,
        commit: () => params.clearListCommit.mutateAsync(),
      },
    ])
  }, [params.clearListCommit, syncQueue])

  return useMemo(() => ({
    enqueueRemoveItem,
    enqueueRemoveRecipe,
    enqueueClearList,
    pendingActions: queue,
    pendingActionCount: queue.length,
    projectShoppingList,
  }), [enqueueClearList, enqueueRemoveItem, enqueueRemoveRecipe, projectShoppingList, queue])
}
