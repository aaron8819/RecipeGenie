"use client"

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Package, Ban, CheckCheck, Copy, GripVertical, X, Loader2, Sparkles, UtensilsCrossed, ChevronDown } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useShoppingList,
  useAddShoppingItem,
  useUpdateShoppingItem,
  useRemoveShoppingItem,
  useRestoreShoppingItem,
  useRemoveRecipeItems,
  useRestoreRecipeItems,
  useClearShoppingList,
  useRestoreShoppingContent,
  useCheckOffItem,
  useBulkCheckOff,
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
  useReorderShoppingList,
  useShoppingConfig,
  useUpdateShoppingConfig,
  useAddToPantryAndRemove,
} from "@/hooks/use-shopping"
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { Recipe, ShoppingItem } from "@/types/database"
import { cn, toFraction } from "@/lib/utils"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"
import { resolveShoppingDropIntent } from "@/lib/shopping-reorder"
import { isAlreadyInShoppingListError } from "@/lib/shopping-feedback"
import {
  createShoppingManualItemId,
  requireShoppingRowRef,
} from "@/lib/shopping-row-reference"
import { openRecipeDetail } from "@/lib/recipe-detail-navigation"
import { useRecipes } from "@/hooks/use-recipes"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import {
  buildCategoryViewModel,
  createDisplayShoppingList,
  deriveCheckedPartition,
  deriveOrderedCategories,
  deriveSortableItemIds,
  deriveUniqueRecipeNames,
  deriveVisibleShoppingItems,
  groupItemsByCategory,
  mergeAlreadyHaveItems,
  prioritizeUncheckedItems,
  sortItemsWithinGroups,
} from "./shopping-list.selectors"
import {
  formatEncodedRangeAmount,
  formatShoppingItemAmount,
  getRecipeColorIndex,
  ManualShoppingItemEditor,
  ShoppingCategorySection,
  ShoppingItemRow,
  ShoppingProgressSummary,
  ShoppingRestoreChip,
  ShoppingStateSection,
  SourceTag,
} from "./shopping-list-components"
import {
  categoryIntentMapsEqual,
  deriveCategoryContent,
  isCategoryExpanded,
  reconcileCategoryIntents,
  type CategoryIntentByKey,
} from "./shopping-category-intent"

type ShoppingMode = "shop" | "manage"
type AddFeedbackTone = "neutral" | "success" | "warning" | "error"

type AddFeedback = {
  tone: AddFeedbackTone
  message: string
}

type ManualEditDraft = {
  itemName: string
  amount: string
  unit: string
}

type PendingCheckIntent = {
  checked: boolean
  version: number
}

function isManualOnlyItem(item: ShoppingItem) {
  const sources = item.sources || []
  return sources.length > 0 && sources.every((source) => source.recipeName === "Manual")
}

function parseEditableAmount(value: string): number | null | "invalid" {
  const trimmed = value.trim()
  if (!trimmed) return null

  const mixedFractionMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixedFractionMatch) {
    const whole = Number(mixedFractionMatch[1])
    const numerator = Number(mixedFractionMatch[2])
    const denominator = Number(mixedFractionMatch[3])
    if (Number.isFinite(whole) && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return whole + numerator / denominator
    }
    return "invalid"
  }

  const fractionMatch = trimmed.match(/^(\d+)\/(\d+)$/)
  if (fractionMatch) {
    const numerator = Number(fractionMatch[1])
    const denominator = Number(fractionMatch[2])
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return numerator / denominator
    }
    return "invalid"
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return "invalid"
  return parsed
}

function RecipeTag({ 
  recipeName, 
  recipe,
  onRemove, 
  onViewRecipe,
  isRemoving,
}: { 
  recipeName: string
  recipe?: Recipe
  onRemove: () => void
  onViewRecipe?: () => void
  isRemoving: boolean
}) {
  const recipeImageUrl = getRecipeImageUrl(recipe?.image_url || null)
  const metadata = [
    recipe?.category,
    recipe?.servings ? `${recipe.servings} servings` : null,
  ].filter(Boolean).join(" · ")
  
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/60 p-2.5 transition-colors hover:bg-stone-50 md:w-full"
      title={recipeName}
    >
      <button
        type="button"
        onClick={onViewRecipe}
        disabled={!onViewRecipe}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default",
          onViewRecipe && "cursor-pointer hover:opacity-90 active:opacity-80"
        )}
      >
        <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sage-100 text-primary shadow-inner">
          {recipeImageUrl ? (
            <Image
              src={recipeImageUrl}
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-cover"
              unoptimized={!recipeImageUrl.includes("supabase.co")}
            />
          ) : (
            <UtensilsCrossed className="h-5 w-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block line-clamp-2 text-sm font-semibold leading-5 text-foreground">
            {recipeName}
          </span>
          <span className="mt-0.5 block truncate text-xs capitalize text-stone-500">
            {metadata || "Recipe"}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        disabled={isRemoving}
        className="flex min-h-9 min-w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-foreground active:bg-stone-300 disabled:opacity-50"
        title={`Remove all items from ${recipeName}`}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// Swipeable item component with mobile quick correction actions
function SwipeableItem({
  item,
  isDesktop,
  showDragHandle,
  sourceDisplay,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  onViewRecipe,
  onEdit,
  dragHandleProps,
  dragStyle,
  isDragging,
  showSwipeHint,
}: {
  item: ShoppingItem
  isDesktop: boolean
  showDragHandle?: boolean
  sourceDisplay?: "tags" | "summary" | "none"
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
  onViewRecipe?: (recipeId: string | undefined, recipeName: string) => void
  onEdit?: () => void
  dragHandleProps?: any
  dragStyle?: React.CSSProperties
  isDragging?: boolean
  showSwipeHint?: boolean
}) {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchStartTime = useRef<number | null>(null)
  const touchStartOffset = useRef(0)
  const itemRef = useRef<HTMLDivElement>(null)
  const ACTION_REVEAL_WIDTH = 116
  const SWIPE_THRESHOLD = 72
  const MIN_SWIPE_DISTANCE = 20
  const MAX_VERTICAL_DEVIATION = 30

  const handleTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth >= 768) return

    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
    touchStartOffset.current = swipeOffset
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || window.innerWidth >= 768) return

    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = touchStartX.current - currentX
    const deltaY = Math.abs(touchStartY.current - currentY)
    const absDeltaX = Math.abs(deltaX)

    if (deltaY > absDeltaX * 1.5 && deltaY > 10) {
      touchStartX.current = null
      touchStartY.current = null
      touchStartTime.current = null
      setIsSwiping(false)
      setSwipeOffset(0)
      return
    }

    if (absDeltaX > MIN_SWIPE_DISTANCE && absDeltaX > deltaY && deltaY < MAX_VERTICAL_DEVIATION) {
      if (!isSwiping) {
        setIsSwiping(true)
      }

      const nextOffset = Math.min(
        Math.max(touchStartOffset.current + deltaX, 0),
        ACTION_REVEAL_WIDTH
      )
      setSwipeOffset(nextOffset)
      e.preventDefault()
    } else if (isSwiping && deltaY > absDeltaX) {
      setIsSwiping(false)
      setSwipeOffset(0)
      touchStartX.current = null
      touchStartY.current = null
      touchStartTime.current = null
    }
  }

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchStartTime.current === null || window.innerWidth >= 768) {
      setIsSwiping(false)
      touchStartX.current = null
      touchStartY.current = null
      return
    }

    if (!isSwiping || swipeOffset < MIN_SWIPE_DISTANCE) {
      setSwipeOffset(0)
      setIsSwiping(false)
      touchStartX.current = null
      touchStartY.current = null
      touchStartTime.current = null
      return
    }

    if (swipeOffset >= SWIPE_THRESHOLD) {
      setSwipeOffset(ACTION_REVEAL_WIDTH)
    } else {
      setSwipeOffset(0)
    }

    setIsSwiping(false)
    touchStartX.current = null
    touchStartY.current = null
    touchStartTime.current = null
  }

  useEffect(() => {
    setSwipeOffset(0)
  }, [item.rowId])

  useEffect(() => {
    if (swipeOffset > 0) {
      const handleClickOutside = (e: MouseEvent) => {
        if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
          setSwipeOffset(0)
        }
      }
      document.addEventListener("click", handleClickOutside)
      return () => document.removeEventListener("click", handleClickOutside)
    }
  }, [swipeOffset])

  const handleDeleteClick = () => {
    onRemove()
    setSwipeOffset(0)
  }

  return (
    <div
      ref={itemRef}
      data-testid={`shopping-row-${item.rowId || item.item}`}
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y pinch-zoom' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className={cn(
          "absolute right-0 top-0 bottom-0 items-center gap-2 pr-4 md:hidden",
          swipeOffset > 0 ? "flex" : "hidden"
        )}
        style={{
          width: `${ACTION_REVEAL_WIDTH}px`,
          willChange: isSwiping ? 'transform' : 'auto',
        }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onAddToPantry()
            setSwipeOffset(0)
          }}
          disabled={isAddingToPantry}
          className="h-11 w-11 rounded-full bg-sage-500/90 flex items-center justify-center text-white disabled:opacity-50"
          aria-label="Quick add to pantry"
        >
          <Package className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isRemoving}
          className="h-11 w-11 rounded-full bg-destructive/90 flex items-center justify-center text-white disabled:opacity-50"
          aria-label="Quick remove item"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <div
        style={{
          transform: showSwipeHint ? undefined : `translateX(-${swipeOffset}px)`,
          willChange: isSwiping || isDragging ? 'transform' : 'auto',
        }}
      >
        <ShoppingItemRow
          item={item}
          isDesktop={isDesktop}
          showDragHandle={showDragHandle}
          sourceDisplay={sourceDisplay}
          onCheckOff={onCheckOff}
          onRemove={onRemove}
          onAddToPantry={onAddToPantry}
          isCheckingOff={isCheckingOff}
          isRemoving={isRemoving}
          isAddingToPantry={isAddingToPantry}
          recipeColorMap={recipeColorMap}
          onViewRecipe={onViewRecipe}
          onEdit={onEdit}
          dragHandleProps={dragHandleProps}
          dragStyle={dragStyle}
          isDragging={isDragging}
          showSwipeHint={showSwipeHint}
        />
      </div>
    </div>
  )
}
// Sortable item component - memoized for better scroll performance
const SortableShoppingItem = memo(function SortableShoppingItem({
  item,
  isDesktop,
  showDragHandle,
  sourceDisplay,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  onViewRecipe,
  onEdit,
  editorContent,
  showSwipeHint,
}: {
  item: ShoppingItem
  isDesktop: boolean
  showDragHandle: boolean
  sourceDisplay?: "tags" | "summary" | "none"
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
  onViewRecipe?: (recipeId: string | undefined, recipeName: string) => void
  onEdit?: () => void
  editorContent?: ReactNode
  showSwipeHint?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.rowId || item.item })

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li ref={setNodeRef}>
      <SwipeableItem
        item={item}
        isDesktop={isDesktop}
        onCheckOff={onCheckOff}
        onRemove={onRemove}
        onAddToPantry={onAddToPantry}
        isCheckingOff={isCheckingOff}
        isRemoving={isRemoving}
        isAddingToPantry={isAddingToPantry}
        showDragHandle={showDragHandle}
        sourceDisplay={sourceDisplay}
        recipeColorMap={recipeColorMap}
        onViewRecipe={onViewRecipe}
        onEdit={onEdit}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragStyle={dragStyle}
        isDragging={isDragging}
        showSwipeHint={showSwipeHint}
      />
      {editorContent}
    </li>
  )
}, (prevProps, nextProps) => {
  const sameItem = prevProps.item === nextProps.item || (
    prevProps.item.item === nextProps.item.item &&
    prevProps.item.rowId === nextProps.item.rowId &&
    prevProps.item.amount === nextProps.item.amount &&
    prevProps.item.unit === nextProps.item.unit &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
  )

  return (
    sameItem &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.isRemoving === nextProps.isRemoving &&
    prevProps.isAddingToPantry === nextProps.isAddingToPantry &&
    prevProps.isDesktop === nextProps.isDesktop &&
    prevProps.showDragHandle === nextProps.showDragHandle &&
    prevProps.showSwipeHint === nextProps.showSwipeHint &&
    prevProps.editorContent === nextProps.editorContent
  )
})

const StaticShoppingItem = memo(function StaticShoppingItem({
  item,
  isDesktop,
  sourceDisplay,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  onViewRecipe,
  onEdit,
  editorContent,
  showSwipeHint,
}: {
  item: ShoppingItem
  isDesktop: boolean
  sourceDisplay?: "tags" | "summary" | "none"
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
  onViewRecipe?: (recipeId: string | undefined, recipeName: string) => void
  onEdit?: () => void
  editorContent?: ReactNode
  showSwipeHint?: boolean
}) {
  return (
    <li>
      <SwipeableItem
        item={item}
        isDesktop={isDesktop}
        sourceDisplay={sourceDisplay}
        onCheckOff={onCheckOff}
        onRemove={onRemove}
        onAddToPantry={onAddToPantry}
        isCheckingOff={isCheckingOff}
        isRemoving={isRemoving}
        isAddingToPantry={isAddingToPantry}
        recipeColorMap={recipeColorMap}
        onViewRecipe={onViewRecipe}
        onEdit={onEdit}
        showSwipeHint={showSwipeHint}
      />
      {editorContent}
    </li>
  )
}, (prevProps, nextProps) => {
  const sameItem = prevProps.item === nextProps.item || (
    prevProps.item.item === nextProps.item.item &&
    prevProps.item.rowId === nextProps.item.rowId &&
    prevProps.item.amount === nextProps.item.amount &&
    prevProps.item.unit === nextProps.item.unit &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
  )

  return (
    sameItem &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.isRemoving === nextProps.isRemoving &&
    prevProps.isAddingToPantry === nextProps.isAddingToPantry &&
    prevProps.isDesktop === nextProps.isDesktop &&
    prevProps.showSwipeHint === nextProps.showSwipeHint &&
    prevProps.editorContent === nextProps.editorContent
  )
})

// Drag overlay item (shown while dragging)
function DragOverlayItem({ 
  item, 
  recipeColorMap
}: { 
  item: ShoppingItem
  recipeColorMap: Map<string, number>
}) {
  const uniqueSources = useMemo(() => {
    if (!item.sources) return []
    const seen = new Set<string>()
    return item.sources.filter((source) => {
      if (seen.has(source.recipeName)) return false
      seen.add(source.recipeName)
      return true
    })
  }, [item.sources])

  return (
    <div className="flex items-center gap-2 bg-white shadow-lg rounded-md px-3 py-2 border border-sage-200">
      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-foreground">
          {formatShoppingItemAmount(item) && (
            <span className="text-muted-foreground mr-1.5 font-medium">
              {formatShoppingItemAmount(item)}
            </span>
          )}
          {item.item}
        </span>
        {uniqueSources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {uniqueSources.map((source, idx) => (
              <SourceTag 
                key={`${source.recipeName}-${idx}`} 
                recipeName={source.recipeName}
                colorIndex={recipeColorMap.get(source.recipeName)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
// Swipe hint stays off by default to preserve a clean row layout at rest.
function useSwipeHint() {
  return { showSwipeHint: false }
}

export function ShoppingListView() {
  const router = useRouter()
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return window.matchMedia("(min-width: 768px)").matches
  })
  const [newItem, setNewItem] = useState("")
  const addItemInputRef = useRef<HTMLInputElement>(null)
  const [activeItem, setActiveItem] = useState<ShoppingItem | null>(null)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [shoppingMode, setShoppingMode] = useState<ShoppingMode>("shop")
  const [categoryIntents, setCategoryIntents] = useState<CategoryIntentByKey>(new Map())
  const [editingItemRowId, setEditingItemRowId] = useState<string | null>(null)
  const [manualEditDraft, setManualEditDraft] = useState<ManualEditDraft>({
    itemName: "",
    amount: "",
    unit: "",
  })
  const [manualEditError, setManualEditError] = useState<string | null>(null)
  const [hideCompletedItems, setHideCompletedItems] = useState(false)
  const [pendingCheckIntents, setPendingCheckIntents] = useState<
    Map<string, PendingCheckIntent>
  >(new Map())
  const pendingCheckIntentsRef = useRef(pendingCheckIntents)
  const nextCheckIntentVersionRef = useRef(0)
  const [pendingPantryItems, setPendingPantryItems] = useState<Set<string>>(new Set())
  // Tracks items currently being added to prevent duplicate concurrent submissions
  const [activeAdditions, setActiveAdditions] = useState<Set<string>>(new Set())
  const [addFeedback, setAddFeedback] = useState<AddFeedback | null>(null)
  const { showSwipeHint } = useSwipeHint()
  const isManageMode = shoppingMode === "manage"
  const categorySectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previousCategoryContentRef = useRef(deriveCategoryContent([]))

  // Mobile UX improvements - collapsible sections and scroll-to-top FAB
  const [recipeSectionCollapsed, setRecipeSectionCollapsed] = useState(true)
  const [pantryCollapsed, setPantryCollapsed] = useState(true) // Default: collapsed
  const [excludedCollapsed, setExcludedCollapsed] = useState(true) // Default: collapsed
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(min-width: 768px)")
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const { data: shoppingList, isLoading, isFetching } = useShoppingList()
  
  // Fetch all recipes to find by name if ID is not available
  const { data: allRecipes } = useRecipes()
  const { data: config } = useShoppingConfig()
  const updateConfig = useUpdateShoppingConfig()

  const addItem = useAddShoppingItem()
  const updateItem = useUpdateShoppingItem()
  const removeItem = useRemoveShoppingItem()
  const restoreItem = useRestoreShoppingItem()
  const removeRecipeItems = useRemoveRecipeItems()
  const restoreRecipeItems = useRestoreRecipeItems()
  const clearList = useClearShoppingList()
  const restoreShoppingContent = useRestoreShoppingContent()
  const checkOffItem = useCheckOffItem()
  const bulkCheckOff = useBulkCheckOff()
  const moveToList = useMoveToShoppingList()
  const moveExcludedToList = useMoveExcludedToShoppingList()
  const reorderList = useReorderShoppingList()
  const addToPantryAndRemove = useAddToPantryAndRemove()
  const undoToast = useUndoToast()

  // Handle clicking on a recipe tag
  const handleRecipeTagClick = useCallback((recipeId: string | undefined, recipeName: string) => {
    if (recipeId) {
      openRecipeDetail(router, recipeId, "shopping")
    } else if (allRecipes) {
      const recipe = allRecipes.find(r => r.name === recipeName)
      if (recipe) {
        openRecipeDetail(router, recipe.id, "shopping")
      }
    }
  }, [allRecipes, router])

  const handleStartEditingManualItem = useCallback((item: ShoppingItem) => {
    const rowId = item.rowId || null
    if (!rowId) return

    setEditingItemRowId(rowId)
    setManualEditDraft({
      itemName: item.item,
      amount: item.amount != null ? String(item.amount) : "",
      unit: item.unit || "",
    })
    setManualEditError(null)
  }, [])

  const handleCancelEditingManualItem = useCallback(() => {
    setEditingItemRowId(null)
    setManualEditError(null)
  }, [])

  const handleRemoveItem = useCallback((item: ShoppingItem) => {
    removeItem.mutate(item, {
      onSuccess: (removed) => {
        undoToast.show({
          message: `"${removed.item}" removed from list`,
          onUndo: () => restoreItem.mutate(removed),
        })
      },
    })
  }, [removeItem, restoreItem, undoToast])

  const handleRemoveRecipeItems = useCallback((recipeId: string | undefined, recipeName: string) => {
    if (!recipeId) return
    removeRecipeItems.mutate({ recipeId, recipeName }, {
      onSuccess: ({ entry }) => {
        undoToast.show({
          message: `Items from "${recipeName || 'recipe'}" removed`,
          onUndo: entry ? () => restoreRecipeItems.mutate(entry) : undefined,
        })
      },
    })
  }, [removeRecipeItems, restoreRecipeItems, undoToast])

  const handleClearListWithUndo = useCallback(() => {
    clearList.mutate(undefined, {
      onSuccess: (content) => {
        undoToast.show({
          message: 'Shopping list cleared',
          onUndo: () => restoreShoppingContent.mutate(content),
        })
      },
    })
  }, [clearList, restoreShoppingContent, undoToast])

  // Handle bulk check-off (check all items in a category)
  const handleBulkCheckOff = useCallback((items: ShoppingItem[]) => {
    if (items.length === 0) return

    // Perform the bulk check-off immediately (with optimistic update)
    bulkCheckOff.mutate(items)

    // Show confirmation toast
    const message = items.length === 1
      ? `Checked "${items[0].item}"`
      : `Checked ${items.length} items`
    undoToast.show({
      message,
      duration: 3000,
    })
  }, [bulkCheckOff, undoToast])

  // Handle adding item to pantry with per-item pending tracking
  const handleAddToPantry = useCallback((item: ShoppingItem) => {
    const itemKey = item.rowId || item.item.toLowerCase().trim()

    // Add to pending set
    setPendingPantryItems(prev => new Set(prev).add(itemKey))

    // Perform mutation
    addToPantryAndRemove.mutate(item, {
      onSuccess: (data) => {
        const message = data.wasAdded
          ? `Moved "${item.item}" to pantry`
          : `"${item.item}" removed from shopping; already in pantry`
        undoToast.show({ message, duration: 2000 })
      },
      onError: () => {
        undoToast.show({
          message: `Failed to move "${item.item}" to pantry`,
          duration: 3000,
        })
      },
      onSettled: () => {
        // Remove from pending set when complete (success or error)
        setPendingPantryItems(prev => {
          const next = new Set(prev)
          next.delete(itemKey)
          return next
        })
      },
    })
  }, [addToPantryAndRemove, undoToast])

  const settleCheckIntent = useCallback((rowRef: string, version: number) => {
    const current = pendingCheckIntentsRef.current
    if (current.get(rowRef)?.version !== version) return

    const next = new Map(current)
    next.delete(rowRef)
    pendingCheckIntentsRef.current = next
    setPendingCheckIntents(next)
  }, [])

  // Keep the latest per-row intent visible while durable document writes run.
  const handleCheckOff = useCallback((item: ShoppingItem) => {
    const rowRef = requireShoppingRowRef(item, "check-off")

    const current = pendingCheckIntentsRef.current
    const checked = !(current.get(rowRef)?.checked ?? item.checked ?? false)
    const version = nextCheckIntentVersionRef.current + 1
    nextCheckIntentVersionRef.current = version

    const next = new Map(current)
    next.set(rowRef, { checked, version })
    pendingCheckIntentsRef.current = next
    setPendingCheckIntents(next)

    void checkOffItem.mutateAsync({ rowRef, checked }).then(
      () => settleCheckIntent(rowRef, version),
      () => settleCheckIntent(rowRef, version)
    )
  }, [checkOffItem, settleCheckIntent])

  // Toggle recipes section collapse (mobile only)
  const toggleRecipeSection = useCallback(() => {
    setRecipeSectionCollapsed(prev => !prev)
  }, [])

  const togglePantrySection = useCallback(() => {
    setPantryCollapsed(prev => !prev)
  }, [])

  const toggleExcludedSection = useCallback(() => {
    setExcludedCollapsed(prev => !prev)
  }, [])

  // Sensors: TouchSensor (long-press) for mobile to avoid scroll conflicts;
  // MouseSensor for desktop; KeyboardSensor for accessibility.
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 }, // Optimized: reduced delay for responsiveness, increased tolerance for stability
    }),
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Show cached data immediately even while fetching (stale-while-revalidate)
  const displayShoppingList = createDisplayShoppingList(shoppingList)
  const projectedShoppingList = displayShoppingList
  
  const mergedAlreadyHave = useMemo(() => {
    return mergeAlreadyHaveItems(projectedShoppingList.already_have || [])
  }, [projectedShoppingList.already_have])
  
  // Only show loading on initial load with no cached data
  const showLoading = isLoading && !shoppingList

  const optimisticItems = useMemo(() => {
    return (projectedShoppingList.items || []).map((item) => {
      const intent = item.rowId ? pendingCheckIntents.get(item.rowId) : undefined
      return intent ? { ...item, checked: intent.checked } : item
    })
  }, [pendingCheckIntents, projectedShoppingList.items])

  // Filter items for pending deletions
  const filteredItems = useMemo(() => {
    return deriveVisibleShoppingItems(optimisticItems)
  }, [optimisticItems])

  useEffect(() => {
    if (!editingItemRowId) return

    const stillExists = filteredItems.some((item) => item.rowId === editingItemRowId)
    if (!stillExists || isManageMode) {
      setEditingItemRowId(null)
      setManualEditError(null)
    }
  }, [editingItemRowId, filteredItems, isManageMode])

  const handleSaveManualItemEdit = useCallback(async () => {
    if (!editingItemRowId) return

    const targetItem = filteredItems.find((candidate) => candidate.rowId === editingItemRowId)
    if (!targetItem || !isManualOnlyItem(targetItem)) {
      setEditingItemRowId(null)
      setManualEditError(null)
      return
    }

    const trimmedName = manualEditDraft.itemName.trim()
    if (!trimmedName) {
      setManualEditError("Enter an item name.")
      return
    }

    const parsedAmount = parseEditableAmount(manualEditDraft.amount)
    if (parsedAmount === "invalid") {
      setManualEditError("Enter a valid amount like 2, 0.5, or 1/2.")
      return
    }

    try {
      await updateItem.mutateAsync({
        item: targetItem,
        updates: {
          itemName: trimmedName,
          amount: parsedAmount,
          unit: manualEditDraft.unit,
        },
      })

      setEditingItemRowId(null)
      setManualEditError(null)
      undoToast.show({
        message: `Updated "${trimmedName}"`,
        duration: 2000,
      })
    } catch (error) {
      if (isAlreadyInShoppingListError(error)) {
        setManualEditError(`"${trimmedName}" is already on the shopping list.`)
        return
      }

      setManualEditError("Could not save that change right now.")
    }
  }, [editingItemRowId, filteredItems, manualEditDraft, undoToast, updateItem])

  // Group items by category
  const groupedItems = useMemo(() => {
    return sortItemsWithinGroups(groupItemsByCategory(filteredItems))
  }, [filteredItems])

  // Get ordered categories (with custom categories and custom ordering)
  const orderedCategories = useMemo(() => {
    return deriveOrderedCategories({
      customCategories: config?.custom_categories,
      categoryOrder: config?.category_order,
    })
  }, [config?.custom_categories, config?.category_order])

  const categoryViewModels = useMemo(() => {
    return buildCategoryViewModel(groupedItems, orderedCategories)
  }, [groupedItems, orderedCategories])

  const categoryContent = useMemo(() => deriveCategoryContent(filteredItems), [filteredItems])
  const effectiveCategoryIntents = useMemo(
    () => reconcileCategoryIntents(
      categoryIntents,
      previousCategoryContentRef.current,
      categoryContent
    ),
    [categoryContent, categoryIntents]
  )

  useLayoutEffect(() => {
    previousCategoryContentRef.current = categoryContent
    setCategoryIntents((current) =>
      categoryIntentMapsEqual(current, effectiveCategoryIntents)
        ? current
        : effectiveCategoryIntents
    )
  }, [categoryContent, effectiveCategoryIntents])

  const setCategoryExpanded = useCallback((categoryKey: string, expanded: boolean) => {
    setCategoryIntents((current) => {
      const next = new Map(current)
      next.set(categoryKey, expanded ? "expanded" : "collapsed")
      return next
    })
  }, [])

  const toggleCategory = useCallback((categoryKey: string, uncheckedCount: number) => {
    const expanded = isCategoryExpanded(effectiveCategoryIntents.get(categoryKey), uncheckedCount)
    setCategoryExpanded(categoryKey, !expanded)
  }, [effectiveCategoryIntents, setCategoryExpanded])

  const shoppingProgress = useMemo(() => {
    return deriveCheckedPartition(filteredItems)
  }, [filteredItems])
  const allItemsChecked = shoppingProgress.allChecked

  const activeCategoryJumpTargets = useMemo(() => {
    return categoryViewModels
      .filter((category) => category.uncheckedCount > 0)
      .map((category) => ({
        key: category.key,
        name: category.name,
        remainingCount: category.uncheckedCount,
      }))
  }, [categoryViewModels])

  const displayedCategoryViewModels = useMemo(() => {
    if (isManageMode) return categoryViewModels

    const isInteractiveCategory = (category: (typeof categoryViewModels)[number]) =>
      category.uncheckedCount > 0 || category.items.some((item) =>
        item.checked && !!item.rowId && pendingCheckIntents.has(item.rowId)
      )
    const activeCategories = categoryViewModels.filter(isInteractiveCategory)
    const completedCategories = categoryViewModels.filter((category) =>
      !isInteractiveCategory(category)
    )
    return hideCompletedItems ? activeCategories : [...activeCategories, ...completedCategories]
  }, [categoryViewModels, hideCompletedItems, isManageMode, pendingCheckIntents])

  const allItemIds = useMemo(() => {
    return deriveSortableItemIds(filteredItems)
  }, [filteredItems])

  // Get unique recipe names from active items only (excluding "Manual" and pending deletions)
  // Only show recipe tags when there are active unchecked items
  const uniqueRecipes = useMemo(() => {
    return deriveUniqueRecipeNames(projectedShoppingList.items || [])
  }, [projectedShoppingList.items])

  const recipeIdsByName = useMemo(() => {
    const ids = new Map<string, string>()
    for (const item of projectedShoppingList.items || []) {
      for (const source of item.sources || []) {
        if (source.recipeId && source.recipeName !== "Manual") {
          ids.set(source.recipeName, source.recipeId)
        }
      }
    }
    for (const recipe of allRecipes || []) {
      if (!ids.has(recipe.name)) ids.set(recipe.name, recipe.id)
    }
    return ids
  }, [allRecipes, projectedShoppingList.items])

  const recipesByName = useMemo(() => {
    return new Map((allRecipes || []).map((recipe) => [recipe.name, recipe]))
  }, [allRecipes])

  // Create a color mapping that assigns a unique color per recipe when possible.
  // Prefer hash-based index for stability; on collision use next available index.
  // If there are more recipes than colors, later recipes may reuse colors.
  const recipeColorMap = useMemo(() => {
    const map = new Map<string, number>()
    const usedIndices = new Set<number>()
    for (const recipeName of uniqueRecipes) {
      let idx = getRecipeColorIndex(recipeName)
      if (usedIndices.size < 10) {
        while (usedIndices.has(idx)) {
          idx = (idx + 1) % 10
        }
        usedIndices.add(idx)
      }
      map.set(recipeName, idx)
    }
    return map
  }, [uniqueRecipes])

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) {
      setAddFeedback({
        tone: "warning",
        message: "Enter an item or paste a comma-separated list.",
      })
      addItemInputRef.current?.focus()
      return
    }

    // Split by comma and filter empty strings
    const items = newItem
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    if (items.length === 0) return

    // Skip items that are already being added (prevents race condition duplicates)
    const itemsToAdd = items.filter(item => !activeAdditions.has(item.toLowerCase().trim()))

    if (itemsToAdd.length === 0) {
      setAddFeedback({
        tone: "warning",
        message: items.length === 1 ? `"${items[0]}" is already being added` : "Those items are already being added",
      })
      return
    }

    try {
      const addedItems: string[] = []
      const duplicateItems: string[] = []
      const failedItems: string[] = []

      for (const item of itemsToAdd) {
        const normalized = item.toLowerCase().trim()
        setActiveAdditions(prev => new Set(prev).add(normalized))
        try {
          await addItem.mutateAsync({
            itemName: item,
            rowId: createShoppingManualItemId(),
          })
          addedItems.push(item)
        } catch (error) {
          if (isAlreadyInShoppingListError(error)) {
            duplicateItems.push(item)
          } else {
            failedItems.push(item)
            console.warn(`Failed to add item "${item}":`, error)
          }
        } finally {
          setActiveAdditions(prev => {
            const next = new Set(prev)
            next.delete(normalized)
            return next
          })
        }
      }

      setNewItem(failedItems.join(", "))
      const nextFeedbackTone: AddFeedbackTone =
        failedItems.length > 0 ? "error" : duplicateItems.length > 0 ? "warning" : "success"
      addItemInputRef.current?.focus()

      if (addedItems.length > 0 || duplicateItems.length > 0 || failedItems.length > 0) {
        const messageParts: string[] = []

        if (addedItems.length > 0) {
          messageParts.push(
            addedItems.length === 1
              ? `Added "${addedItems[0]}" to shopping list`
              : `Added ${addedItems.length} items to shopping list`
          )
        }

        if (duplicateItems.length > 0) {
          messageParts.push(
            duplicateItems.length === 1
              ? `"${duplicateItems[0]}" was already on the shopping list`
              : `${duplicateItems.length} items were already on the shopping list`
          )
        }

        if (failedItems.length > 0) {
          messageParts.push(
            failedItems.length === 1
              ? `Could not add "${failedItems[0]}"`
              : `Could not add ${failedItems.length} items`
          )
        }

        setAddFeedback({
          tone: nextFeedbackTone,
          message: messageParts.join("; "),
        })
      }
    } catch (error) {
      console.error("Failed to add items:", error)
      setAddFeedback({
        tone: "error",
        message: "Could not add those items right now. Try again.",
      })
    }
  }

  const handleRestorePantryItem = useCallback((item: ShoppingItem) => {
    moveToList.mutate(item, {
      onSuccess: () => {
        undoToast.show({
          message: `Restored "${item.item}" to shopping list`,
          duration: 2000,
        })
      },
      onError: () => {
        undoToast.show({
          message: `Failed to restore "${item.item}" to shopping list`,
          duration: 3000,
        })
      },
    })
  }, [moveToList, undoToast])

  const handleRestoreExcludedItem = useCallback((item: ShoppingItem) => {
    moveExcludedToList.mutate(item, {
      onSuccess: () => {
        undoToast.show({
          message: `Restored "${item.item}" to shopping list`,
          duration: 2000,
        })
      },
      onError: () => {
        undoToast.show({
          message: `Failed to restore "${item.item}" to shopping list`,
          duration: 3000,
        })
      },
    })
  }, [moveExcludedToList, undoToast])


  const handleCopyList = async () => {
    if (!shoppingList?.items?.length) return

    // Format the list as plain text grouped by category
    const lines: string[] = []

    orderedCategories.forEach((categoryData) => {
        const items = (shoppingList.items || []).filter(
          (item) => (item.categoryKey || "misc") === categoryData.key
        )
        if (items.length === 0) return

        lines.push(`${categoryData.name}:`)
        items.forEach((item) => {
          const rangeAmount = formatEncodedRangeAmount(item.amount, item.unit || "")
          const amount = item.amount ? toFraction(item.amount) : ""
          const unit = item.unit || ""
          const prefix = rangeAmount
            ? `${rangeAmount} `
            : amount
              ? `${amount}${unit ? " " + unit : ""} `
              : ""
          lines.push(`  - ${prefix}${item.item}`)
        })
        lines.push("")
      })

    const text = lines.join("\n").trim()

    try {
      await navigator.clipboard.writeText(text)
      undoToast.show({
        message: "Copied to clipboard!",
        duration: 2000,
      })
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  const handleEnterManageMode = useCallback(() => {
    setShoppingMode("manage")
  }, [])

  const handleExitManageMode = useCallback(() => {
    setShoppingMode("shop")
    setActiveItem(null)
    setDragOverCategory(null)
  }, [])

  const handleJumpToCategory = useCallback((categoryKey: string) => {
    setCategoryExpanded(categoryKey, true)

    window.requestAnimationFrame(() => {
      const categorySection = categorySectionRefs.current[categoryKey]
      if (!categorySection) return

      categorySection.scrollIntoView({
        behavior: isDesktop ? "smooth" : "auto",
        block: "start",
      })
    })
  }, [isDesktop, setCategoryExpanded])

  const handleDragStart = (event: DragStartEvent) => {
    if (!isManageMode) return
    const { active } = event
    const activeId = String(active.id)
    setActiveItem(filteredItems.find((item) => item.rowId === activeId) || null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    if (!isManageMode) return
    const { over } = event
    if (!over || !filteredItems) {
      setDragOverCategory(null)
      return
    }
    const overItem = filteredItems.find((item) => item.rowId === String(over.id))
    setDragOverCategory(overItem?.categoryKey || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!isManageMode) return
    const { active, over } = event
    setActiveItem(null)
    setDragOverCategory(null)

    if (!over || active.id === over.id || !shoppingList?.items) return

    const items = shoppingList.items
    const intent = resolveShoppingDropIntent(
      items,
      String(active.id),
      String(over.id)
    )
    if (!intent) return

    try {
      await reorderList.mutateAsync({ items, ...intent })
    } catch (error) {
      console.error("Failed to reorder:", error)
    }
  }

  const renderOrganizeMenu = (triggerClassName?: string, labelClassName?: string) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          aria-label="Organize"
          aria-pressed={isManageMode}
        >
          <Sparkles className="h-5 w-5" />
          <span className={cn(triggerClassName?.includes("gap-2") ? "" : "sr-only", labelClassName)}>
            Organize
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={isManageMode ? handleExitManageMode : handleEnterManageMode}>
          <GripVertical className="mr-2 h-4 w-4" />
          {isManageMode ? "Exit Manage Mode" : "Enter Manage Mode"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowSettings(true)}>
          <Sparkles className="mr-2 h-4 w-4" />
          Shopping settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const addHelperTone: AddFeedbackTone = addFeedback?.tone || "neutral"
  const addHelperClassName = cn(
    "mt-2 text-sm",
    addHelperTone === "success" && "text-primary",
    addHelperTone === "warning" && "text-amber-700",
    addHelperTone === "error" && "text-destructive",
    addHelperTone === "neutral" && "text-muted-foreground"
  )

  const shoppingListContent = (
    <>
      {displayedCategoryViewModels.map((categoryData, categoryIndex) => {
        const pendingCheckedCount = categoryData.items.filter((item) =>
          item.checked && !!item.rowId && pendingCheckIntents.has(item.rowId)
        ).length
        const interactiveUncheckedCount =
          categoryData.uncheckedCount + pendingCheckedCount
        const items = isManageMode
          ? categoryData.items
          : prioritizeUncheckedItems(
              hideCompletedItems
                ? categoryData.items.filter((item) =>
                    !item.checked || (!!item.rowId && pendingCheckIntents.has(item.rowId))
                  )
                : categoryData.items
            )
        const isDragTarget =
          isManageMode &&
          activeItem &&
          dragOverCategory === categoryData.key &&
          activeItem.categoryKey !== categoryData.key

        const isCollapsed = !isCategoryExpanded(
          effectiveCategoryIntents.get(categoryData.key),
          interactiveUncheckedCount
        )

        return (
          <div
            key={categoryData.key}
            ref={(node) => {
              categorySectionRefs.current[categoryData.key] = node
            }}
            data-testid={`shopping-category-${categoryData.key}`}
            className={cn(
              "scroll-mt-24 md:scroll-mt-0",
              !isManageMode && "md:border-b md:border-stone-100/80 md:last:border-b-0"
            )}
          >
            <ShoppingCategorySection
              categoryData={categoryData}
              itemCount={items.length}
              isCollapsed={isCollapsed}
              isDragTarget={!!isDragTarget}
              isBulkCheckOffPending={bulkCheckOff.isPending}
              onToggleCategory={() => toggleCategory(categoryData.key, interactiveUncheckedCount)}
              onBulkCheckOff={() => handleBulkCheckOff(items)}
              compact={!isManageMode}
            >
              <ul className="divide-y divide-stone-100" style={{ contain: "layout style paint" }}>
                {items.map((item, index) => {
                  const pendingCheckIntent = item.rowId
                    ? pendingCheckIntents.get(item.rowId)
                    : undefined
                  const showHintForThisItem = categoryIndex === 0 && index === 0 && showSwipeHint
                  const reactKey =
                    item.rowId ||
                    `${categoryData.key}-${item.item}-${item.unit || ""}-${index}`
                  const sourceDisplay: "tags" | "summary" = isManageMode ? "tags" : "summary"
                  const isEditingManualItem =
                    !isManageMode &&
                    !!item.rowId &&
                    editingItemRowId === item.rowId &&
                    isManualOnlyItem(item)
                  const editorContent = isEditingManualItem ? (
                    <ManualShoppingItemEditor
                      itemName={manualEditDraft.itemName}
                      amount={manualEditDraft.amount}
                      unit={manualEditDraft.unit}
                      isSaving={updateItem.isPending}
                      errorMessage={manualEditError}
                      onItemNameChange={(value) => {
                        setManualEditDraft((prev) => ({ ...prev, itemName: value }))
                        if (manualEditError) setManualEditError(null)
                      }}
                      onAmountChange={(value) => {
                        setManualEditDraft((prev) => ({ ...prev, amount: value }))
                        if (manualEditError) setManualEditError(null)
                      }}
                      onUnitChange={(value) => {
                        setManualEditDraft((prev) => ({ ...prev, unit: value }))
                        if (manualEditError) setManualEditError(null)
                      }}
                      onSave={() => void handleSaveManualItemEdit()}
                      onCancel={handleCancelEditingManualItem}
                    />
                  ) : null

                  const sharedProps = {
                    item,
                    isDesktop,
                    onCheckOff: () => handleCheckOff(item),
                    onRemove: () => handleRemoveItem(item),
                    onAddToPantry: () => handleAddToPantry(item),
                    onEdit: isManualOnlyItem(item) ? () => handleStartEditingManualItem(item) : undefined,
                    isCheckingOff: Boolean(pendingCheckIntent),
                    isRemoving: false,
                    isAddingToPantry: pendingPantryItems.has(item.rowId || item.item.toLowerCase().trim()),
                    recipeColorMap,
                    onViewRecipe: handleRecipeTagClick,
                    sourceDisplay,
                    editorContent,
                    showSwipeHint: showHintForThisItem,
                  }

                  if (isManageMode) {
                    return <SortableShoppingItem key={reactKey} {...sharedProps} showDragHandle={true} />
                  }

                  return <StaticShoppingItem key={reactKey} {...sharedProps} />
                })}
              </ul>
            </ShoppingCategorySection>
          </div>
        )
      })}
    </>
  )

  return (
    <>
    <div className="mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col">
      {/* Mobile sticky add item - always accessible at top */}
      <div className={cn("sticky top-0 z-30 -mx-1 mb-3 bg-background/95 px-1 pb-2 backdrop-blur-md", isDesktop && "hidden")}>
        <form onSubmit={handleAddItem} className="relative">
          <Input
            ref={addItemInputRef}
            placeholder="Add milk, apples, basil..."
            value={newItem}
            onChange={(e) => {
              setNewItem(e.target.value)
              if (addFeedback) setAddFeedback(null)
            }}
            className="h-12 w-full rounded-2xl border border-stone-200 bg-white py-2.5 pl-4 pr-14 text-base shadow-[0_8px_24px_rgba(63,52,43,0.07)] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
          />
          <Button
            type="submit"
            disabled={addItem.isPending}
            aria-label="Add item"
            className="absolute right-1.5 top-1/2 flex h-9 min-h-[44px] w-9 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            <span className="text-lg leading-none font-semibold">+</span>
          </Button>
        </form>
      </div>

      {/* Mobile header - compact title and actions */}
      <div className={cn("mb-3 flex items-center justify-between", isDesktop && "hidden")}>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">Shopping List</h1>
        <div className="flex gap-1">
          {renderOrganizeMenu(
            "flex h-11 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-medium text-stone-600 shadow-sm transition-colors hover:border-sage-300 hover:text-primary",
            "hidden min-[375px]:inline"
          )}
          <button
            type="button"
            onClick={handleClearListWithUndo}
            className="flex h-11 w-11 items-center justify-center rounded-full text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
            aria-label="Clear list"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Desktop header - full layout with add item */}
      <header className={cn("mb-5", !isDesktop && "hidden")}>
        {/* Desktop: title, subtitle, Organize + Copy + Clear */}
        <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="mb-1 font-display text-4xl font-bold tracking-tight text-foreground">Shopping List</h1>
            <p className="text-sm text-muted-foreground">Everything you need, organized for a faster trip.</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {renderOrganizeMenu("flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-foreground")}
            <Button
              variant="outline"
              onClick={handleCopyList}
              className="flex h-10 items-center gap-2 rounded-xl border-stone-200 bg-white px-4 text-sm font-medium hover:bg-stone-50 hover:text-foreground"
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={handleClearListWithUndo}
              className="flex h-10 items-center gap-2 rounded-xl border-red-100 bg-red-50 px-4 text-sm font-medium text-red-600 hover:bg-red-100 hover:text-red-700"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>

        {/* Desktop add item form - stays in header */}
        <form onSubmit={handleAddItem} className="relative">
          <Input
            ref={addItemInputRef}
            placeholder="Add tomatoes, milk..."
            value={newItem}
            onChange={(e) => {
              setNewItem(e.target.value)
              if (addFeedback) setAddFeedback(null)
            }}
            className="h-[52px] w-full rounded-2xl border border-stone-200 bg-white py-3 pl-5 pr-36 text-base shadow-[0_8px_24px_rgba(63,52,43,0.07)] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-0"
          />
          <Button
            type="submit"
            disabled={addItem.isPending}
            aria-label="Add item"
            className="absolute right-1.5 top-1/2 flex h-10 w-auto -translate-y-1/2 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            <span>Add Item</span>
          </Button>
        </form>
      </header>

      {/* Shopping List */}
      <div className="flex-1 min-h-0 flex flex-col">
      {/* Shopping List */}
      {showLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading your shopping list...</p>
      ) : filteredItems.length === 0 && mergedAlreadyHave.length === 0 && projectedShoppingList.excluded.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={ShoppingCart}
            title="Your shopping list is clear"
            description="Add a few items above, or build the list from recipes and meal plans."
            action={{
              label: "Add item",
              onClick: () => addItemInputRef.current?.focus(),
            }}
            secondaryAction={{
              label: "Browse Recipes",
              onClick: () => router.push("/recipes"),
            }}
          />
        </div>
      ) : (
        <div className="relative">
          {isManageMode ? (
            <Card className="mb-4 border-amber-200 bg-amber-50/80 shadow-sm">
              <CardContent className="flex items-start justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Manage Mode</p>
                  <p className="text-xs text-amber-800">
                    Drag items to reorder them or move them between categories. Tap Done to return to shopping.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExitManageMode}
                  className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                >
                  Done
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {/* Subtle loading indicator for background refetch */}
          {isFetching && !isLoading && (
            <div className="absolute top-0 right-0 z-10 p-2">
              <div className="bg-background/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div
            className={cn(
              "grid grid-cols-1 gap-3 pb-[calc(72px+env(safe-area-inset-bottom))] md:items-start md:gap-4 md:pb-0",
              isManageMode ? "md:grid-cols-1" : "md:grid-cols-[minmax(0,1fr)_17rem]"
            )}
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {!isManageMode && filteredItems.length > 0 ? (
              <div className="min-w-0 md:col-span-2 md:row-start-1">
                <ShoppingProgressSummary
                  isDesktop={isDesktop}
                  remainingCount={shoppingProgress.uncheckedCount}
                  completedCount={shoppingProgress.checkedCount}
                  totalCount={shoppingProgress.totalCount}
                  activeCategoryCount={activeCategoryJumpTargets.length}
                  hideCompletedItems={hideCompletedItems}
                  onToggleCompleted={() => setHideCompletedItems((prev) => !prev)}
                  activeCategories={activeCategoryJumpTargets}
                  onJumpToCategory={handleJumpToCategory}
                />
              </div>
            ) : null}
            <div className={cn(
              "min-w-0 md:col-start-1",
              isManageMode ? "md:row-start-1" : "md:row-start-2"
            )}>
            {isManageMode ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={allItemIds}
                  strategy={verticalListSortingStrategy}
                >
                  {shoppingListContent}
                </SortableContext>

                <DragOverlay>
                  {activeItem ? <DragOverlayItem item={activeItem} recipeColorMap={recipeColorMap} /> : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div className="space-y-3 md:space-y-0 md:overflow-hidden md:rounded-2xl md:border md:border-stone-200/80 md:bg-white md:shadow-[0_12px_32px_rgba(63,52,43,0.06)]">
                {shoppingListContent}
              </div>
            )}
            </div>

            {!isManageMode && uniqueRecipes.length > 0 && (
              <Card
                className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-[0_10px_28px_rgba(63,52,43,0.055)] md:sticky md:top-24 md:col-start-2 md:row-start-2 md:row-end-[span_6]"
                data-testid="shopping-recipe-context"
              >
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-3 px-4 py-4 md:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
                        Recipes in list
                      </p>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
                        {uniqueRecipes.length}
                      </span>
                    </div>
                    {!isDesktop ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={toggleRecipeSection}
                        className="h-9 shrink-0 gap-1 rounded-full px-3 text-xs font-medium text-primary hover:bg-sage-50 hover:text-primary"
                        aria-label={recipeSectionCollapsed ? "Show recipes in list" : "Hide recipes in list"}
                      >
                        {recipeSectionCollapsed ? "Show" : "Hide"}
                        <ChevronDown className={cn("h-4 w-4 transition-transform", !recipeSectionCollapsed && "rotate-180")} />
                      </Button>
                    ) : null}
                  </div>
                  {(isDesktop || !recipeSectionCollapsed) ? (
                    <div className="flex flex-col gap-2 border-t border-stone-100 px-3 pb-3 pt-3 md:px-3.5 md:pb-3.5">
                      {uniqueRecipes.map((recipeName) => {
                        const recipeId = recipeIdsByName.get(recipeName)
                        return (
                          <RecipeTag
                            key={recipeName}
                            recipeName={recipeName}
                            recipe={recipesByName.get(recipeName)}
                            onRemove={() => handleRemoveRecipeItems(recipeId, recipeName)}
                            onViewRecipe={() => handleRecipeTagClick(recipeId, recipeName)}
                            isRemoving={false}
                          />
                        )
                      })}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}

          <div className={cn(
            "space-y-3 md:col-start-1",
            isManageMode ? "md:row-start-2" : "md:row-start-3"
          )}>

          {/* Complete Shopping Button - appears when all items are checked */}
          {allItemsChecked && filteredItems.length > 0 && (
            <Card className="animate-fade-in border-primary/20 bg-primary/5">
              <CardContent className="pt-6 pb-4 px-4">
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex items-center gap-2 text-primary">
                    <CheckCheck className="h-5 w-5" />
                    <p className="text-sm font-semibold">All items checked!</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Ready to complete your shopping trip?
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleClearListWithUndo}
                    className="mt-1"
                  >
                    Complete Shopping
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* In Pantry — Collapsible on mobile, always expanded on desktop */}
          {mergedAlreadyHave && mergedAlreadyHave.length > 0 && (
            <ShoppingStateSection
              title="In Pantry"
              count={mergedAlreadyHave.length}
              icon={<Package className="h-5 w-5 text-primary" />}
              isDesktop={isDesktop}
              isCollapsed={pantryCollapsed}
              onToggle={togglePantrySection}
              expandLabel="Expand pantry items"
              collapseLabel="Collapse pantry items"
              mobileCountClassName="bg-accent-green/20 text-primary"
              mobileContent={
                <>
                  <p className="text-xs text-muted-foreground mb-3">Restore pantry items with their amount and source shown inline.</p>
                  <div className="grid gap-2">
                    {mergedAlreadyHave.map((item, index) => (
                      <ShoppingRestoreChip
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel="In pantry"
                        onRestore={() => handleRestorePantryItem(item)}
                        disabled={moveToList.isPending}
                        recipeColorMap={recipeColorMap}
                        tone="pantry"
                        compact={true}
                      />
                    ))}
                  </div>
                </>
              }
              desktopContent={
                <>
                  <p className="text-xs text-muted-foreground mb-4">Restore pantry items with the original amount and recipe context visible.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {mergedAlreadyHave.map((item, index) => (
                      <ShoppingRestoreChip
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel="In pantry"
                        onRestore={() => handleRestorePantryItem(item)}
                        disabled={moveToList.isPending}
                        recipeColorMap={recipeColorMap}
                        tone="pantry"
                      />
                    ))}
                  </div>
                </>
              }
            />
          )}

          {/* Excluded — Collapsible on mobile, always expanded on desktop */}
          {projectedShoppingList.excluded && projectedShoppingList.excluded.length > 0 && (
            <ShoppingStateSection
              title="Excluded"
              count={projectedShoppingList.excluded.length}
              icon={<Ban className="h-5 w-5 text-red-500" />}
              isDesktop={isDesktop}
              isCollapsed={excludedCollapsed}
              onToggle={toggleExcludedSection}
              expandLabel="Expand excluded items"
              collapseLabel="Collapse excluded items"
              mobileCountClassName="bg-rose-100 text-rose-700"
              mobileContent={
                <>
                  <p className="text-xs text-muted-foreground mb-3">Restore excluded items with the keyword reason and recipe source visible.</p>
                  <div className="grid gap-2">
                    {projectedShoppingList.excluded.map((item, index) => (
                      <ShoppingRestoreChip
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel={item.excludedBy ? `Excluded: ${item.excludedBy}` : "Excluded"}
                        onRestore={() => handleRestoreExcludedItem(item)}
                        disabled={moveExcludedToList.isPending}
                        recipeColorMap={recipeColorMap}
                        tone="excluded"
                        compact={true}
                      />
                    ))}
                  </div>
                </>
              }
              desktopContent={
                <>
                  <p className="text-xs text-muted-foreground mb-4">Restore excluded items with the exclusion reason and original recipe context visible.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {projectedShoppingList.excluded.map((item, index) => (
                      <ShoppingRestoreChip
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel={item.excludedBy ? `Excluded: ${item.excludedBy}` : "Excluded"}
                        onRestore={() => handleRestoreExcludedItem(item)}
                        disabled={moveExcludedToList.isPending}
                        recipeColorMap={recipeColorMap}
                        tone="excluded"
                      />
                    ))}
                  </div>
                </>
              }
            />
          )}

          </div>

          </div>
        </div>
      )}
        </div>

      {/* Shopping Settings Modal */}
      <ShoppingSettingsModal
        open={showSettings}
        onOpenChange={setShowSettings}
        config={config || null}
        onUpdateConfig={async (updates) => {
          await updateConfig.mutateAsync(updates)
        }}
        isUpdating={updateConfig.isPending}
      />

    </div>
    </>
  )
}
