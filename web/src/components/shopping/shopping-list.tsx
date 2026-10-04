"use client"

import { shoppingSourceControls, shoppingSourceLabel, isManualShoppingItem } from '@/lib/shopping-sources'
import type { ShoppingDocumentStateV3 } from '@/lib/shopping-document'
import { ShoppingDocumentReadError } from '@/hooks/shopping/use-shopping-document'
import { useOrganizeShopping, useShoppingDocumentState, useShoppingFoundationCommand } from '@/hooks/shopping/use-shopping-document'
import { ShoppingAddItem, ShoppingDormantRecovery, SelectionYield, ShoppingInitializationNotice } from './shopping-foundation-view'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, memo, type ReactNode } from "react"
import Image from "next/image"
import { useIsDesktop } from '@/hooks/use-is-desktop'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import './shopping-workspace.css'
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  SHOPPING_CLEAR_UNDO_UNAVAILABLE,
  useBulkCheckOff,
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
  useReorderShoppingList,
  useShoppingConfig,
  useUpdateShoppingConfig,
  useAddToPantryAndRemove,
} from "@/hooks/use-shopping"
import { ShoppingOrganizationDialog } from "./shopping-organization-dialog"
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { Recipe, ShoppingItem } from "@/types/database"
import { cn } from "@/lib/utils"
import { useShoppingCheckIntents } from "@/hooks/use-shopping-check-intents"
import { addShoppingDraft } from "@/lib/shopping-quick-add"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"
import { resolveShoppingDropIntent } from "@/lib/shopping-reorder"
import { isAlreadyInShoppingListError } from "@/lib/shopping-feedback"
import {
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
  deriveVisibleShoppingItems,
  groupItemsByCategory,
  mergeAlreadyHaveItems,
  prioritizeUncheckedItems,
  sortItemsWithinGroups,
} from "./shopping-list.selectors"
import {
  formatShoppingItemAmount,
  getRecipeColorIndex,
  ManualShoppingItemEditor,
  ShoppingCategorySection,
  ShoppingItemRow,
  ShoppingRestoreChip,
  ShoppingStateSection,
  SourceTag,
} from "./shopping-list-components"
import { formatShoppingPurchaseAmount, shoppingPurchaseDisplayName } from '@/lib/shopping-quantity-display'
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
  selectedServings,
  onRemove, 
  onViewRecipe,
  isRemoving,
}: { 
  recipeName: string
  recipe?: Recipe
  selectedServings?: number
  onRemove: () => void
  onViewRecipe?: () => void
  isRemoving: boolean
}) {
  const recipeImageUrl = getRecipeImageUrl(recipe?.image_url || null)
  const metadata = [
    recipe?.category,
    selectedServings ? `${selectedServings} selected servings` : recipe?.servings ? `${recipe.servings} servings` : null,
  ].filter(Boolean).join(" · ")
  
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50/60 p-2.5 transition-colors hover:bg-stone-50 md:w-full"
      title={recipeName}
    >
      <button
        type="button"
        onClick={onViewRecipe}
        aria-label={`View ${recipeName}`}
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
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-foreground active:bg-stone-300 disabled:opacity-50"
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
  foundationState,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  readOnly,
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
  foundationState?: ShoppingDocumentStateV3
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  readOnly?: boolean
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
    if (window.innerWidth >= 768 || (e.target as HTMLElement).closest('button, input, select, summary, [data-shopping-sources]')) return

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
          disabled={readOnly || isAddingToPantry}
          className="h-11 w-11 rounded-full bg-sage-500/90 flex items-center justify-center text-white disabled:opacity-50"
          aria-label={`Add ${item.item} to pantry`}
        >
          <Package className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={readOnly || isRemoving}
          className="h-11 w-11 rounded-full bg-destructive/90 flex items-center justify-center text-white disabled:opacity-50"
          aria-label={`Remove ${item.item} from list`}
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
        foundationState={foundationState}
          onCheckOff={onCheckOff}
          onRemove={onRemove}
          onAddToPantry={onAddToPantry}
          isCheckingOff={isCheckingOff}
          readOnly={readOnly}
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
  foundationState,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  readOnly,
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
  foundationState?: ShoppingDocumentStateV3
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  readOnly?: boolean
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
  } = useSortable({ id: item.rowId || item.item, disabled: readOnly })

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
          readOnly={readOnly}
        isRemoving={isRemoving}
        isAddingToPantry={isAddingToPantry}
        showDragHandle={showDragHandle}
        sourceDisplay={sourceDisplay}
        foundationState={foundationState}
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
    formatShoppingItemAmount(prevProps.item) === formatShoppingItemAmount(nextProps.item) &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    prevProps.item.inspectedRevision === nextProps.item.inspectedRevision &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
  )

  return (
    sameItem &&
    prevProps.foundationState === nextProps.foundationState &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.readOnly === nextProps.readOnly &&
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
  foundationState,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  readOnly,
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
  foundationState?: ShoppingDocumentStateV3
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  readOnly?: boolean
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
        foundationState={foundationState}
        onCheckOff={onCheckOff}
        onRemove={onRemove}
        onAddToPantry={onAddToPantry}
        isCheckingOff={isCheckingOff}
          readOnly={readOnly}
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
    formatShoppingItemAmount(prevProps.item) === formatShoppingItemAmount(nextProps.item) &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    prevProps.item.inspectedRevision === nextProps.item.inspectedRevision &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
  )

  return (
    sameItem &&
    prevProps.foundationState === nextProps.foundationState &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.readOnly === nextProps.readOnly &&
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
  const uniqueSources = shoppingSourceControls(item)

  return (
    <div className="flex items-center gap-2 bg-white shadow-lg rounded-md px-3 py-2 border border-sage-200">
      <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-foreground">
          {formatShoppingPurchaseAmount(item) && (
            <span className="text-muted-foreground mr-1.5 font-medium">
              {formatShoppingPurchaseAmount(item)}
            </span>
          )}
            {shoppingPurchaseDisplayName(item)}
        </span>
        {uniqueSources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {uniqueSources.map((source, idx) => (
              <SourceTag 
                key={source.recipeId ?? source.manualId ?? `unknown-source-${idx}`}
                recipeName={shoppingSourceLabel(source)}
                isManual={!!source.manualId || isManualShoppingItem(item)}
                colorIndex={recipeColorMap.get(source.recipeId ?? "")}
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
  return <><ShoppingInitializationNotice /><ShoppingListContent /></>
}

function ShoppingListContent() {
  const organizationQuery = useShoppingDocumentState()
  const foundationState = !organizationQuery.error && organizationQuery.data?.document.schemaVersion === 4 ? organizationQuery.data : undefined
  const organizePurchase = useOrganizeShopping()
  const restoreChecks = useShoppingFoundationCommand()
  const dragSnapshot = useRef<ShoppingItem[]>([])
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const [newItem, setNewItem] = useState("")
  const addItemInputRef = useRef<HTMLInputElement>(null)
  const [activeItem, setActiveItem] = useState<ShoppingItem | null>(null)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showClearConfirmation, setShowClearConfirmation] = useState(false)
  const clearConfirmation = useRef<{ revision: number; undoRequired: boolean } | undefined>(undefined)
  const [shoppingMode, setShoppingMode] = useState<ShoppingMode>("shop")
  const [categoryIntents, setCategoryIntents] = useState<CategoryIntentByKey>(new Map())
  const [editingItemRowId, setEditingItemRowId] = useState<string | null>(null)
  const [manualEditDraft, setManualEditDraft] = useState<ManualEditDraft>({
    itemName: "",
    amount: "",
    unit: "",
  })
  const [manualEditError, setManualEditError] = useState<string | null>(null)
  const [hideCompletedItems] = useState(true)
  const { pendingCheckIntents, handleCheckOff } = useShoppingCheckIntents()
  const [pendingPantryItems, setPendingPantryItems] = useState<Set<string>>(new Set())
  const quickAddLock = useRef(false)
  const [addFeedback, setAddFeedback] = useState<AddFeedback | null>(null)
  const { showSwipeHint } = useSwipeHint()
  const isManageMode = shoppingMode === "manage"
  const categorySectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previousCategoryContentRef = useRef(deriveCategoryContent([]))

  // Mobile UX improvements - collapsible sections and scroll-to-top FAB
  const [recipeSectionCollapsed, setRecipeSectionCollapsed] = useState(false)
  const [recipesOpen, setRecipesOpen] = useState(false)
  const [selectedSection, setSelectedSection] = useState("")
  const stickyRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const completedRef = useRef<HTMLDetailsElement>(null)
  const checkAnchor = useRef<{ rowId: string; nextId: string; top: number; restoring: boolean } | null>(null)
  const [pantryCollapsed, setPantryCollapsed] = useState(true) // Default: collapsed
  const [excludedCollapsed, setExcludedCollapsed] = useState(true) // Default: collapsed


  const shoppingQuery = useShoppingList()
  const { data: shoppingList, isLoading, isFetching } = shoppingQuery
  const selections = useMemo(() => shoppingQuery.selections ?? [], [shoppingQuery.selections])
  const documentUnavailable = !!shoppingQuery.documentError || shoppingQuery.hasDocument === false
  const pantryUnavailable = !!shoppingQuery.pantryError || shoppingQuery.hasPantry === false
  
  // Library metadata is optional; selection identity comes from Shopping.
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
  const bulkCheckOff = useBulkCheckOff()
  const moveToList = useMoveToShoppingList()
  const moveExcludedToList = useMoveExcludedToShoppingList()
  const reorderList = useReorderShoppingList()
  const addToPantryAndRemove = useAddToPantryAndRemove()
  const undoToast = useUndoToast()

  // Handle clicking on a recipe tag
  const handleRecipeTagClick = useCallback((recipeId: string | undefined, _recipeName: string) => {
    if (recipeId) {
      openRecipeDetail(router, recipeId, "shopping")
    } else {
      undoToast.show({ message: 'This recipe is unavailable. You can still remove its shopping selection.' })
    }
  }, [router, undoToast])

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

  const handleRemoveRecipeItems = useCallback((recipeId: string | undefined, recipeName: string, selectionVersion?: number) => {
    if (!recipeId) return
    removeRecipeItems.mutate({ recipeId, recipeName, selectionVersion }, {
      onSuccess: ({ entry }) => {
        undoToast.show({
          message: `Items from "${recipeName || 'recipe'}" removed`,
          onUndo: entry ? () => restoreRecipeItems.mutate(entry) : undefined,
        })
      },
    })
  }, [removeRecipeItems, restoreRecipeItems, undoToast])

  const handleClearListWithUndo = useCallback(() => {
    clearList.mutate(clearConfirmation.current, {
      onSuccess: (result) => {
        if (!result) {
          undoToast.show({ message: 'Shopping list is already clear' })
          return
        }
        undoToast.show({
          duration: 10 * 60 * 1000,
          message: result.synchronizationFailed
            ? 'Clear confirmed. Could not refresh the list; reload to see current state. Undo is unavailable.'
            : result.historical
            ? 'The earlier Clear was confirmed. Showing the current list.'
            : result.undoAvailable !== true
            ? 'Shopping list cleared. Undo is unavailable for this Clear.'
            : 'Shopping list cleared',
          onUndo: result.undoAvailable !== true ? undefined : () => restoreShoppingContent.mutate(result),
        })
      },
    })
  }, [clearList, restoreShoppingContent, undoToast])

  const handleRequestClear = useCallback(() => {
    clearConfirmation.current = shoppingQuery.clearConfirmation
    // Selections remain authoritative even without Pantry projection.
    if (shoppingQuery.clearConfirmation?.undoRequired === false ||
        selections.length > 0 || shoppingList?.source_recipes?.length) {
      setShowClearConfirmation(true)
    } else {
      handleClearListWithUndo()
    }
  }, [shoppingQuery.clearConfirmation, selections.length, shoppingList?.source_recipes, handleClearListWithUndo])

  // Handle bulk check-off (check all items in a category)
  const handleBulkCheckOff = useCallback((items: ShoppingItem[]) => {
    if (items.length === 0) return

    // Perform the bulk check-off immediately (with optimistic update)
    bulkCheckOff.mutate(items, { onSuccess: result => {
      if (!result.undo) return;
      const undo = result.undo;
      undoToast.show({ message: `Checked ${result.count} items`, onUndo: () => {
        // mutate routes rejection through the hook's existing error toast.
        restoreChecks.mutate({ observedRevision: undo.revision,
          inspectedCoverage: Object.assign({}, ...undo.rows.map(item => item.inspectedCoverage)),
          mutation: { type: 'setCheckedMany', rowRefs: undo.rows.map(item => requireShoppingRowRef(item)), checked: false },
        });
      } });
    } })

    // Show confirmation toast
    const message = items.length === 1
      ? `Checked "${items[0].item}"`
      : `Checked ${items.length} items`
    undoToast.show({
      message,
      duration: 3000,
    })
  }, [bulkCheckOff, undoToast, restoreChecks])

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
    if (!targetItem || !isManualShoppingItem(targetItem)) {
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
        setManualEditError(`"${trimmedName}" is already on the shopping list. Choose a different ingredient name or cancel this edit.`)
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

  const categoryContent = useMemo(() => {
    const known = new Set(orderedCategories.map((category) => category.key))
    return deriveCategoryContent(filteredItems, (item) => {
      const key = item.categoryKey || "misc"
      return known.has(key) ? key : "__unknown_category__"
    })
  }, [filteredItems, orderedCategories])
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

  useLayoutEffect(() => {
    const sticky = stickyRef.current;
    if (!sticky || typeof ResizeObserver === 'undefined') return;
    const resize = new ResizeObserver(() => workspaceRef.current?.style.setProperty('--shopping-add-height', `${sticky.getBoundingClientRect().height}px`));
    resize.observe(sticky);
    return () => resize.disconnect();
  }, [foundationState]);
  useEffect(() => {
    if (!activeCategoryJumpTargets.some(category => category.key === selectedSection)) setSelectedSection(activeCategoryJumpTargets[0]?.key ?? '');
  }, [activeCategoryJumpTargets, selectedSection]);

  const allItemIds = useMemo(() => {
    return deriveSortableItemIds(filteredItems)
  }, [filteredItems])

  const handlePresentedCheck = (item: ShoppingItem) => {
    const rows = Array.from(workspaceRef.current?.querySelectorAll<HTMLElement>('[data-shopping-row-id]') ?? []);
    const index = rows.findIndex(row => row.dataset.shoppingRowId === item.rowId);
    const neighbor = item.checked ? rows[index] : rows[index + 1] ?? rows[index - 1];
    if (item.rowId && neighbor?.dataset.shoppingRowId) checkAnchor.current = {
      rowId: item.rowId, nextId: neighbor.dataset.shoppingRowId,
      top: neighbor.getBoundingClientRect().top, restoring: !!item.checked,
    };
    handleCheckOff(item);
  };
  useLayoutEffect(() => {
    const anchor = checkAnchor.current;
    if (!anchor || pendingCheckIntents.has(anchor.rowId)) return;
    const rows = Array.from(workspaceRef.current?.querySelectorAll<HTMLElement>('[data-shopping-row-id]') ?? []);
    const target = rows.find(row => row.dataset.shoppingRowId === (anchor.restoring ? anchor.rowId : anchor.nextId));
    checkAnchor.current = null;
    if (target) {
      target.querySelector<HTMLButtonElement>('[data-checkbox]')?.focus({ preventScroll: true });
      if (anchor.restoring) target.scrollIntoView({ block: 'nearest' });
      else window.scrollBy(0, target.getBoundingClientRect().top - anchor.top);
    }
  }, [filteredItems, pendingCheckIntents]);

  const recipesById = useMemo(() => new Map((allRecipes ?? []).map((recipe) => [recipe.id, recipe])), [allRecipes])
  const recipeColorMap = useMemo(() => new Map(selections.map((entry) =>
    [entry.recipeId, getRecipeColorIndex(entry.recipeId)])), [selections])

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (quickAddLock.current || documentUnavailable || pantryUnavailable) return
    if (!newItem.trim()) {
      setAddFeedback({ tone: "warning", message: "Enter an item or paste a comma-separated list." })
      addItemInputRef.current?.focus()
      return
    }
    quickAddLock.current = true
    try {
      const result = await addShoppingDraft(newItem, (item) => addItem.mutateAsync(item))
      setNewItem(result.draft)
      setAddFeedback({ tone: result.tone, message: result.message })
    } finally {
      quickAddLock.current = false
      addItemInputRef.current?.focus()
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

    categoryViewModels.forEach((categoryData) => {
        const items = categoryData.items
        if (items.length === 0) return

        lines.push(`${categoryData.name}:`)
        items.forEach((item) => {
          const amount = formatShoppingPurchaseAmount(item)
          const prefix = amount ? amount + ' ' : ''
          lines.push(`  - ${prefix}${shoppingPurchaseDisplayName(item)}`)
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
    setSelectedSection(categoryKey)
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
    dragSnapshot.current = structuredClone(shoppingList?.items ?? [])
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

    if (documentUnavailable || !over || active.id === over.id || !shoppingList?.items) return

    const items = dragSnapshot.current
    const intent = resolveShoppingDropIntent(
      items,
      String(active.id),
      String(over.id)
    )
    if (!intent) return

    try {
      const result = await reorderList.mutateAsync({ items, ...intent })
      if (result?.undo) {
        const inverse = result.undo
        undoToast.show({ message: 'Purchase moved', onUndo: async () => { await organizePurchase.mutateAsync(inverse) } })
      }
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
          disabled={documentUnavailable}
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
              isBulkCheckOffPending={documentUnavailable || bulkCheckOff.isPending || items.every(item => item.coveragePending)}
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
                    isManualShoppingItem(item)
                  const editorContent = isEditingManualItem ? (
                    <ManualShoppingItemEditor
                      itemName={manualEditDraft.itemName}
                      amount={manualEditDraft.amount}
                      unit={manualEditDraft.unit}
                      isSaving={documentUnavailable || updateItem.isPending}
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
                    onCheckOff: () => handlePresentedCheck(item),
                    onRemove: () => handleRemoveItem(item),
                    onAddToPantry: () => handleAddToPantry(item),
                    foundationState,
                    onEdit: !foundationState && isManualShoppingItem(item) ? () => handleStartEditingManualItem(item) : undefined,
                    readOnly: documentUnavailable,
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

  const documentMessage = shoppingQuery.documentError instanceof ShoppingDocumentReadError
    ? 'This shopping list could not be opened. Your saved list has not been changed.'
    : shoppingQuery.hasDocument
      ? "Couldn’t refresh your shopping list. Showing the last loaded list."
      : "Couldn’t load your shopping list. Try again."
  const recoveryNotice = shoppingQuery.documentError ? (
    <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p>{documentMessage}</p>
      <Button variant="outline" onClick={() => void shoppingQuery.retryDocument()} disabled={isFetching}>Try again</Button>
    </div>
  ) : null
  if (!shoppingList && documentUnavailable) return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 font-display text-3xl">Shopping List</h1>
      {recoveryNotice ?? <p role="status">Loading your shopping list...</p>}
    </div>
  )

  return (
    <>
    <div ref={workspaceRef} className="shopping-workspace mx-auto flex min-h-0 w-full flex-1 flex-col">
      {foundationState && <ShoppingDormantRecovery state={foundationState} items={[...(shoppingList?.items ?? []), ...(shoppingList?.already_have ?? []), ...(shoppingList?.excluded ?? [])]} />}
      {recoveryNotice}
      {shoppingQuery.pantryError ? (
        <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p>{shoppingQuery.hasPantry
            ? "Couldn’t refresh pantry items. Showing the last loaded availability."
            : "Couldn’t load pantry items. Try again."}</p>
          <Button variant="outline" onClick={() => void shoppingQuery.retryPantry()} disabled={isFetching}>Try again</Button>
        </div>
      ) : null}
      <header className="shopping-heading">
        <div><p className="shopping-eyebrow">Shopping</p><h1 className="font-display font-bold">Shopping List</h1>
          <p className="shopping-subtitle" data-testid="shopping-progress-summary">{shoppingProgress.uncheckedCount} items to buy · {shoppingProgress.checkedCount} completed</p>
        </div>
        <div className="shopping-top-actions">
          <Button variant="ghost" onClick={() => setRecipesOpen(true)}>{selections.length} recipes ↗</Button>
          <span className="hidden md:inline-flex">{renderOrganizeMenu("flex min-h-11 items-center gap-2 px-3")}</span>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" aria-label="List actions">•••</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleCopyList}>Copy list</DropdownMenuItem>
              <DropdownMenuItem onClick={handleEnterManageMode} disabled={documentUnavailable}>Organize items</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSettings(true)} disabled={documentUnavailable}>Shopping settings</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setPantryCollapsed(false); document.getElementById('shopping-pantry')?.scrollIntoView(); }}>In Pantry</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setExcludedCollapsed(false); document.getElementById('shopping-excluded')?.scrollIntoView(); }}>Excluded</DropdownMenuItem>
              <DropdownMenuItem onClick={handleRequestClear} disabled={documentUnavailable}>Clear list</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div ref={stickyRef} className="shopping-sticky-add">
        {foundationState ? <ShoppingAddItem state={foundationState} inputRef={addItemInputRef} /> : <form onSubmit={handleAddItem} className="relative">
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
            disabled={addItem.isPending || documentUnavailable || pantryUnavailable}
            aria-label="Add item"
            className="absolute right-1.5 top-1/2 flex h-9 min-h-[44px] w-9 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground shadow-sm hover:opacity-90"
          >
            <span className="text-lg leading-none font-semibold">+</span>
          </Button>
        </form>}
      </div>
      {!isManageMode && <div className="shopping-mobile-sections">
        <label htmlFor="shopping-section-select">Jump to</label>
        <select id="shopping-section-select" value={selectedSection} onChange={event => handleJumpToCategory(event.target.value)}>
          {activeCategoryJumpTargets.map(category => <option key={category.key} value={category.key}>{category.name} · {category.remainingCount}</option>)}
        </select>
        <Button variant="ghost" onClick={() => { if (completedRef.current) { completedRef.current.open = true; completedRef.current.scrollIntoView(); } }}>Done {shoppingProgress.checkedCount}</Button>
      </div>}

      {/* Shopping List */}
      <div className="flex-1 min-h-0 flex flex-col">
      {/* Shopping List */}
      {showLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading your shopping list...</p>
      ) : shoppingList && selections.length === 0 && filteredItems.length === 0 && mergedAlreadyHave.length === 0 && projectedShoppingList.excluded.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={ShoppingCart}
            title="Your shopping list is clear"
            description="No recipes selected. Add a few items above, or build the list from recipes and meal plans."
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
          {shoppingList && filteredItems.length === 0 && selections.length > 0 ? (
            <p className="mb-4 text-muted-foreground">Nothing left to buy. Your selected recipes are still in the list.</p>
          ) : null}
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
              "shopping-workspace-grid",
              isManageMode && "shopping-manage"
            )}
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {!isManageMode && <aside className="shopping-section-rail">
              <p className="shopping-eyebrow">Sections</p>
              <nav aria-label="Shopping sections">{activeCategoryJumpTargets.map(category =>
                <button type="button" key={category.key} aria-current={selectedSection === category.key ? 'location' : undefined} onClick={() => handleJumpToCategory(category.key)}><span>{category.name}</span><span>{category.remainingCount}</span></button>)}</nav>
              <div className="shopping-rail-secondary">
                <button onClick={() => { if (completedRef.current) { completedRef.current.open = true; completedRef.current.scrollIntoView(); } }}>Completed <span>{shoppingProgress.checkedCount}</span></button>
                <button onClick={() => { setPantryCollapsed(false); document.getElementById('shopping-pantry')?.scrollIntoView(); }}>In Pantry <span>{mergedAlreadyHave.length}</span></button>
                <button onClick={() => { setExcludedCollapsed(false); document.getElementById('shopping-excluded')?.scrollIntoView(); }}>Excluded <span>{projectedShoppingList.excluded.length}</span></button>
              </div>
            </aside>}
            <div className={cn(
              "shopping-list-column min-w-0"
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
              <div className="shopping-active-sections">
                {shoppingListContent}
              </div>
            )}
            </div>

            {!isManageMode && <details ref={completedRef} className="shopping-completed">
              <summary>Completed · {shoppingProgress.checkedCount}</summary>
              <ul>{filteredItems.filter(item => item.checked && (!item.rowId || !pendingCheckIntents.has(item.rowId))).map(item => <StaticShoppingItem
                key={item.rowId} item={item} isDesktop={isDesktop} foundationState={foundationState}
                readOnly={documentUnavailable} isCheckingOff={false} isRemoving={false} isAddingToPantry={pendingPantryItems.has(item.rowId || '')}
                recipeColorMap={recipeColorMap} onViewRecipe={handleRecipeTagClick}
                onCheckOff={() => handlePresentedCheck(item)} onRemove={() => handleRemoveItem(item)} onAddToPantry={() => handleAddToPantry(item)}
              />)}</ul>
            </details>}

          <div className={cn(
            "shopping-secondary-sections space-y-3"
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
                    onClick={handleRequestClear}
                    disabled={documentUnavailable}
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
              id="shopping-pantry" title="In Pantry"
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
                        foundationState={foundationState}
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel="In pantry"
                        onRestore={() => handleRestorePantryItem(item)}
                        disabled={documentUnavailable || moveToList.isPending}
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
                        foundationState={foundationState}
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel="In pantry"
                        onRestore={() => handleRestorePantryItem(item)}
                        disabled={documentUnavailable || moveToList.isPending}
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
              id="shopping-excluded" title="Excluded"
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
                        foundationState={foundationState}
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel={item.excludedBy ? `Excluded: ${item.excludedBy}` : "Excluded"}
                        onRestore={() => handleRestoreExcludedItem(item)}
                        disabled={documentUnavailable || moveExcludedToList.isPending}
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
                        foundationState={foundationState}
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        item={item}
                        reasonLabel={item.excludedBy ? `Excluded: ${item.excludedBy}` : "Excluded"}
                        onRestore={() => handleRestoreExcludedItem(item)}
                        disabled={documentUnavailable || moveExcludedToList.isPending}
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

            {recipesOpen && (
              <Dialog open={recipesOpen} onOpenChange={setRecipesOpen}><DialogContent><DialogTitle>Recipes in list</DialogTitle><DialogDescription>Captured recipe selections and total yield.</DialogDescription><Button variant="outline" onClick={() => router.push("/recipes")}>Choose recipes</Button><Card
                className="border-0 shadow-none"
                data-testid="shopping-recipe-context"
              >
                <CardContent className="p-0">
                  <div className="flex items-center justify-between gap-3 px-4 py-4 md:px-5">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-600">
                        Recipes in list
                      </p>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-500">
                        {selections.length}
                      </span>
                    </div>
                    {!isDesktop ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={toggleRecipeSection}
                        className="h-11 shrink-0 gap-1 rounded-full px-3 text-xs font-medium text-primary hover:bg-sage-50 hover:text-primary"
                        aria-expanded={!recipeSectionCollapsed}
                        aria-label={recipeSectionCollapsed ? "Show recipes in list" : "Hide recipes in list"}
                      >
                        {recipeSectionCollapsed ? "Show" : "Hide"}
                        <ChevronDown className={cn("h-4 w-4 transition-transform", !recipeSectionCollapsed && "rotate-180")} />
                      </Button>
                    ) : null}
                  </div>
                  {(isDesktop || !recipeSectionCollapsed) ? (
                    <div className="flex flex-col gap-2 border-t border-stone-100 px-3 pb-3 pt-3 md:px-3.5 md:pb-3.5">
                      {selections.map(({ recipeId, label, selectedServings, selectionVersion }) => {
                        return (
                          <div key={recipeId}>
                          <RecipeTag
                            recipeName={label}
                            selectedServings={selectedServings}
                            recipe={recipesById.get(recipeId)}
                            onRemove={() => handleRemoveRecipeItems(recipeId, label, selectionVersion)}
                            onViewRecipe={() => handleRecipeTagClick(recipeId, label)}
                            isRemoving={documentUnavailable}
                          />
                          {foundationState && recipesById.has(recipeId) && <details className="px-2 text-sm">
                            <summary className="min-h-11 cursor-pointer content-center text-muted-foreground" aria-label={`Change yield for ${label}`}>Change yield</summary>
                            <SelectionYield recipe={recipesById.get(recipeId)!} state={foundationState} />
                          </details>}
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </CardContent>
              </Card></DialogContent></Dialog>
            )}

      {/* Shopping Settings Modal */}
      <AlertDialog open={showClearConfirmation && !documentUnavailable} onOpenChange={setShowClearConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear shopping list?</AlertDialogTitle>
            <AlertDialogDescription>
              {shoppingQuery.clearConfirmation?.undoRequired !== false
                ? SHOPPING_CLEAR_UNDO_UNAVAILABLE
                : 'Undo is unavailable for this Clear.'} This clears the whole list,
              including manual items. Your saved recipes and organization stay saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearListWithUndo}>Clear list</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showSettings && !documentUnavailable && organizationQuery.data?.document.schemaVersion === 4 ?
        <ShoppingOrganizationDialog document={organizationQuery.data.document} onClose={() => setShowSettings(false)} /> :
      <ShoppingSettingsModal
        open={showSettings && !documentUnavailable}
        onOpenChange={setShowSettings}
        config={config || null}
        onUpdateConfig={async (updates) => {
          await updateConfig.mutateAsync(updates)
        }}
        isUpdating={updateConfig.isPending}
      />}

    </div>
    </>
  )
}
