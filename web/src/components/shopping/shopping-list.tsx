"use client"

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { Plus, Trash2, Package, Ban, Check, CheckCheck, Copy, GripVertical, X, Settings, Loader2, ChevronUp, Leaf, Sparkles, MoreVertical } from "lucide-react"
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
  useDndMonitor,
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
  useShoppingList,
  useAddShoppingItem,
  useRemoveShoppingItem,
  useRemoveRecipeItems,
  useClearShoppingList,
  useCheckOffItem,
  useBulkCheckOff,
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
  useReorderShoppingList,
  useSaveCategoryOverride,
  useShoppingConfig,
  useUpdateShoppingConfig,
  useAddToPantryAndRemove,
  useShoppingPendingActions,
} from "@/hooks/use-shopping"
import { SHOPPING_CATEGORIES, getCategoryByKey } from "@/lib/shopping-categories"
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { ShoppingItem, Recipe } from "@/types/database"
import { toFraction, cn } from "@/lib/utils"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"
import { reorderByFilteredIndices } from "@/lib/shopping-reorder"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
import { RecipeDialog } from "@/components/recipes/recipe-dialog"
import { useRecipe, useRecipes, useCategories } from "@/hooks/use-recipes"
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
  sortItemsWithinGroups,
} from "./shopping-list.selectors"
import {
  formatShoppingItemAmount,
  getRecipeColor,
  getRecipeColorIndex,
  ShoppingCategorySection,
  ShoppingItemRow,
  ShoppingStateSection,
  SourceTag,
} from "./shopping-list-components"

function RecipeTag({ 
  recipeName, 
  onRemove, 
  onViewRecipe,
  isRemoving,
  colorIndex
}: { 
  recipeName: string
  onRemove: () => void
  onViewRecipe?: () => void
  isRemoving: boolean
  colorIndex?: number
}) {
  const index = colorIndex !== undefined ? colorIndex : getRecipeColorIndex(recipeName)
  const colors = getRecipeColor(index)
  
  // Truncate long recipe names
  const displayName = recipeName.length > 25 ? recipeName.slice(0, 23) + "…" : recipeName
  
  return (
    <span 
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs md:text-sm font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
      title={recipeName}
    >
      <span
        onClick={onViewRecipe}
        className={onViewRecipe ? "cursor-pointer hover:opacity-90 active:opacity-80" : ""}
      >
        {displayName}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        disabled={isRemoving}
        className={`p-1 md:p-0.5 rounded-full transition-colors hover:bg-black/10 active:bg-black/20 disabled:opacity-50 min-w-[28px] min-h-[28px] md:min-w-0 md:min-h-0 flex items-center justify-center`}
        title={`Remove all items from ${recipeName}`}
      >
        <X className="h-3.5 w-3.5 md:h-3 md:w-3" />
      </button>
    </span>
  )
}

// Swipeable item component with swipe-to-delete
function SwipeableItem({
  item,
  isDesktop,
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  dragHandleProps,
  dragStyle,
  isDragging,
  showSwipeHint,
}: {
  item: ShoppingItem
  isDesktop: boolean
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
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
  const itemRef = useRef<HTMLDivElement>(null)
  const SWIPE_THRESHOLD = 100
  const MIN_SWIPE_DISTANCE = 20
  const MAX_VERTICAL_DEVIATION = 30

  const handleTouchStart = () => {
    // Swipe disabled: mobile uses more_vert (shoppinglist_mobile_redesign), desktop uses hover
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

      if (deltaX > 0) {
        const maxSwipe = 120
        setSwipeOffset(Math.min(deltaX, maxSwipe))
        e.preventDefault()
      }
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
      setSwipeOffset(160)
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
      className="relative overflow-hidden"
      style={{ touchAction: 'pan-y pinch-zoom' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="absolute right-0 top-0 bottom-0 hidden"
        style={{
          transform: `translateX(${swipeOffset > 0 ? 0 : 100}%)`,
          width: '160px',
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
          aria-label="Add to pantry"
        >
          <Package className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isRemoving}
          className="h-11 w-11 rounded-full bg-destructive/90 flex items-center justify-center text-white disabled:opacity-50"
          aria-label="Delete item"
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
          onCheckOff={onCheckOff}
          onRemove={onRemove}
          onAddToPantry={onAddToPantry}
          isCheckingOff={isCheckingOff}
          isRemoving={isRemoving}
          isAddingToPantry={isAddingToPantry}
          recipeColorMap={recipeColorMap}
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
  onCheckOff,
  onRemove,
  onAddToPantry,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  showSwipeHint,
}: {
  item: ShoppingItem
  isDesktop: boolean
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
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
        recipeColorMap={recipeColorMap}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragStyle={dragStyle}
        isDragging={isDragging}
        showSwipeHint={showSwipeHint}
      />
    </li>
  )
}, (prevProps, nextProps) => {
  // Custom comparison function for memo
  return (
    prevProps.item.item === nextProps.item.item &&
    prevProps.item.rowId === nextProps.item.rowId &&
    prevProps.item.amount === nextProps.item.amount &&
    prevProps.item.unit === nextProps.item.unit &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.isRemoving === nextProps.isRemoving &&
    prevProps.isAddingToPantry === nextProps.isAddingToPantry &&
    prevProps.isDesktop === nextProps.isDesktop &&
    prevProps.showSwipeHint === nextProps.showSwipeHint &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
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
// Swipe hint disabled: mobile uses more_vert menu per shoppinglist_mobile_redesign (no swipe)
function useSwipeHint() {
  return { showSwipeHint: false }
}

export function ShoppingListView() {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return window.matchMedia("(min-width: 768px)").matches
  })
  const [newItem, setNewItem] = useState("")
  const addItemInputRef = useRef<HTMLInputElement>(null)
  const [activeItem, setActiveItem] = useState<ShoppingItem | null>(null)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [manuallyExpandedCategories, setManuallyExpandedCategories] = useState<Set<string>>(new Set())
  const [manuallyCollapsedCategories, setManuallyCollapsedCategories] = useState<Set<string>>(new Set())
  const [viewingRecipeId, setViewingRecipeId] = useState<string | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [pendingCheckItems, setPendingCheckItems] = useState<Set<string>>(new Set())
  const [pendingPantryItems, setPendingPantryItems] = useState<Set<string>>(new Set())
  // Tracks items currently being added to prevent duplicate concurrent submissions
  const [activeAdditions, setActiveAdditions] = useState<Set<string>>(new Set())
  const { showSwipeHint } = useSwipeHint()

  // Mobile UX improvements - collapsible sections and scroll-to-top FAB
  const [recipeSectionCollapsed, setRecipeSectionCollapsed] = useState(false)
  const [pantryCollapsed, setPantryCollapsed] = useState(true) // Default: collapsed
  const [excludedCollapsed, setExcludedCollapsed] = useState(true) // Default: collapsed
  const [showScrollToTop, setShowScrollToTop] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(min-width: 768px)")
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const { data: shoppingList, isLoading, isFetching } = useShoppingList()
  
  // Fetch recipe for viewing
  const { data: viewingRecipe } = useRecipe(viewingRecipeId)
  
  // Fetch all recipes to find by name if ID is not available
  const { data: allRecipes } = useRecipes()
  const { data: categories } = useCategories()
  const { data: config } = useShoppingConfig()
  const updateConfig = useUpdateShoppingConfig()

  const addItem = useAddShoppingItem()
  const removeItem = useRemoveShoppingItem()
  const removeRecipeItems = useRemoveRecipeItems()
  const clearList = useClearShoppingList()
  const checkOffItem = useCheckOffItem()
  const bulkCheckOff = useBulkCheckOff()
  const moveToList = useMoveToShoppingList()
  const moveExcludedToList = useMoveExcludedToShoppingList()
  const reorderList = useReorderShoppingList()
  const saveCategoryOverride = useSaveCategoryOverride()
  const addToPantryAndRemove = useAddToPantryAndRemove()
  const undoToast = useUndoToast()
  const pendingActions = useShoppingPendingActions({
    removeItemCommit: removeItem,
    removeRecipeCommit: removeRecipeItems,
    clearListCommit: clearList,
  })

  // Handle clicking on a recipe tag
  const handleRecipeTagClick = useCallback((recipeId: string | undefined, recipeName: string) => {
    if (recipeId) {
      // If we have the ID, use it directly
      setViewingRecipeId(recipeId)
    } else if (allRecipes) {
      // Otherwise, find by name
      const recipe = allRecipes.find(r => r.name === recipeName)
      if (recipe) {
        setViewingRecipeId(recipe.id)
      }
    }
  }, [allRecipes])

  // Handle item removal with undo
  const handleRemoveItem = useCallback((item: ShoppingItem) => {
    pendingActions.enqueueRemoveItem(item)
  }, [pendingActions])

  // Handle recipe items removal with undo
  const handleRemoveRecipeItems = useCallback((recipeName: string) => {
    pendingActions.enqueueRemoveRecipe(recipeName)
  }, [pendingActions])

  // Handle clear list with undo
  const handleClearListWithUndo = useCallback(() => {
    pendingActions.enqueueClearList()
  }, [pendingActions])

  // Handle bulk check-off (check all items in a category)
  const handleBulkCheckOff = useCallback((items: ShoppingItem[], categoryName: string) => {
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
        // Different message if item was already in pantry
        const message = data.wasAdded
          ? `"${item.item}" added to pantry`
          : `"${item.item}" already in pantry`
        undoToast.show({ message, duration: 2000 })
      },
      onError: () => {
        undoToast.show({
          message: `Failed to add "${item.item}" to pantry`,
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

  // Handle check-off with per-item pending tracking
  const handleCheckOff = useCallback((item: ShoppingItem) => {
    const itemKey = item.rowId || item.item.toLowerCase().trim()

    // Add to pending set
    setPendingCheckItems(prev => new Set(prev).add(itemKey))

    // Perform mutation
    checkOffItem.mutate(item, {
      onSettled: () => {
        // Remove from pending set when complete (success or error)
        setPendingCheckItems(prev => {
          const next = new Set(prev)
          next.delete(itemKey)
          return next
        })
      },
    })
  }, [checkOffItem])

  // Toggle category collapse (separate setState calls; never call setState inside another's updater)
  const toggleCategory = useCallback((categoryKey: string) => {
    const isCurrentlyCollapsed = collapsedCategories.has(categoryKey)
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryKey)) next.delete(categoryKey)
      else next.add(categoryKey)
      return next
    })
    setManuallyExpandedCategories(prev => {
      const next = new Set(prev)
      if (isCurrentlyCollapsed) next.add(categoryKey)
      else next.delete(categoryKey)
      return next
    })
    setManuallyCollapsedCategories(prev => {
      const next = new Set(prev)
      if (isCurrentlyCollapsed) next.delete(categoryKey)
      else next.add(categoryKey)
      return next
    })
  }, [collapsedCategories])

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

  // Scroll to top handler (mobile only)
  const handleScrollToTop = useCallback(() => {
    // Find scroll container - same logic as useEffect
    let scrollContainer: HTMLElement | null = document.querySelector('[aria-hidden="false"].overflow-y-auto')
    if (!scrollContainer) {
      scrollContainer = document.querySelector('[aria-hidden="false"] .overflow-y-auto')
    }

    if (!scrollContainer) return

    scrollContainer.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }, [])

  // Scroll detection for FAB visibility (mobile only)
  // Using requestAnimationFrame polling since scroll events don't fire reliably
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Use matchMedia instead of window.innerWidth - works with DevTools device emulation
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    if (!isMobile) {
      setShowScrollToTop(false)
      return
    }

    let animationFrameId: number
    let isRunning = true

    const checkScrollPosition = () => {
      if (!isRunning) return

      // Check ALL possible scroll sources
      let scrollTop = 0

      // 1. Check window scroll
      if (window.scrollY > 0) {
        scrollTop = window.scrollY
      }

      // 2. Check document.documentElement
      if (scrollTop === 0 && document.documentElement.scrollTop > 0) {
        scrollTop = document.documentElement.scrollTop
      }

      // 3. Check overflow-y-auto containers
      if (scrollTop === 0) {
        const allScrollContainers = document.querySelectorAll('.overflow-y-auto')
        allScrollContainers.forEach((el) => {
          const htmlEl = el as HTMLElement
          if (htmlEl.scrollTop > scrollTop) {
            scrollTop = htmlEl.scrollTop
          }
        })
      }

      // 4. Check any element with scrollTop > 0 (fallback)
      if (scrollTop === 0) {
        const allElements = document.querySelectorAll('*')
        allElements.forEach((el) => {
          const htmlEl = el as HTMLElement
          if (htmlEl.scrollTop > scrollTop) {
            scrollTop = htmlEl.scrollTop
          }
        })
      }

      const shouldShow = scrollTop > 200

      // Only update state if it changed to avoid unnecessary re-renders
      setShowScrollToTop((prev) => {
        if (prev !== shouldShow) {
          return shouldShow
        }
        return prev
      })

      // Continue polling
      animationFrameId = requestAnimationFrame(checkScrollPosition)
    }

    // Start polling after a small delay to ensure DOM is ready
    const startTimer = setTimeout(() => {
      checkScrollPosition()
    }, 100)

    // Add resize listener to handle orientation changes
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const handleMediaChange = (e: MediaQueryListEvent) => {
      if (!e.matches) {
        setShowScrollToTop(false)
      }
    }

    mediaQuery.addEventListener('change', handleMediaChange)

    return () => {
      clearTimeout(startTimer)
      isRunning = false
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      mediaQuery.removeEventListener('change', handleMediaChange)
    }
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
  const projectedShoppingList = useMemo(() => {
    return createDisplayShoppingList(pendingActions.projectShoppingList(displayShoppingList))
  }, [displayShoppingList, pendingActions])
  
  const mergedAlreadyHave = useMemo(() => {
    return mergeAlreadyHaveItems(projectedShoppingList.already_have || [])
  }, [projectedShoppingList.already_have])
  
  // Only show loading on initial load with no cached data
  const showLoading = isLoading && !shoppingList

  // Filter items for pending deletions
  const filteredItems = useMemo(() => {
    return deriveVisibleShoppingItems(projectedShoppingList.items || [])
  }, [projectedShoppingList.items])

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

  // Check if all items are checked
  const allItemsChecked = useMemo(() => {
    return deriveCheckedPartition(filteredItems).allChecked
  }, [filteredItems])

  // Auto-collapse categories when all items are checked (only if not manually expanded)
  useEffect(() => {
    if (allItemsChecked) {
      const allCategoryKeys = new Set(filteredItems.map(item => item.categoryKey || "misc"))
      setCollapsedCategories(prev => {
        const next = new Set(prev)
        allCategoryKeys.forEach(key => {
          // Only auto-collapse if not manually expanded
          if (!manuallyExpandedCategories.has(key)) {
            next.add(key)
          }
        })
        return next
      })
    }
  }, [allItemsChecked, filteredItems, manuallyExpandedCategories])

  // Auto-collapse when all items in a category are checked (unless manually expanded); auto-expand when items become unchecked only if it was auto-collapsed (not manually collapsed)
  useEffect(() => {
    const newCollapsed = new Set(collapsedCategories)
    let hasChanges = false
    
    orderedCategories.forEach(categoryData => {
      const items = groupedItems[categoryData.key]
      if (items && items.length > 0) {
        const allChecked = items.every(item => item.checked === true)
        if (allChecked && !manuallyExpandedCategories.has(categoryData.key)) {
          if (!newCollapsed.has(categoryData.key)) {
            newCollapsed.add(categoryData.key)
            hasChanges = true
          }
        } else if (!allChecked && newCollapsed.has(categoryData.key) && !manuallyCollapsedCategories.has(categoryData.key)) {
          // Auto-expand only when it was auto-collapsed (user manual collapse is respected)
          newCollapsed.delete(categoryData.key)
          hasChanges = true
        }
      }
    })
    
    if (hasChanges) {
      setCollapsedCategories(newCollapsed)
    }
  }, [filteredItems, groupedItems, orderedCategories, manuallyExpandedCategories, manuallyCollapsedCategories, collapsedCategories])

  const allItemIds = useMemo(() => {
    return deriveSortableItemIds(filteredItems)
  }, [filteredItems])

  // Get unique recipe names from active items only (excluding "Manual" and pending deletions)
  // Only show recipe tags when there are active unchecked items
  const uniqueRecipes = useMemo(() => {
    return deriveUniqueRecipeNames(projectedShoppingList.items || [])
  }, [projectedShoppingList.items])

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
      undoToast.show({ message: 'Item already being added', duration: 2000 })
      return
    }

    try {
      // Add each item
      const addedItems: string[] = []
      for (const item of itemsToAdd) {
        const normalized = item.toLowerCase().trim()
        setActiveAdditions(prev => new Set(prev).add(normalized))
        try {
          await addItem.mutateAsync({ itemName: item })
          addedItems.push(item)
        } catch (error) {
          // Skip duplicates or errors for individual items
          console.warn(`Skipped item "${item}":`, error)
        } finally {
          setActiveAdditions(prev => {
            const next = new Set(prev)
            next.delete(normalized)
            return next
          })
        }
      }
      setNewItem("")
      addItemInputRef.current?.focus()

      // Show confirmation toast
      if (addedItems.length > 0) {
        const message = addedItems.length === 1
          ? `Added: ${addedItems[0]}`
          : `Added ${addedItems.length} items`
        undoToast.show({
          message,
          duration: 2000,
        })
      }
    } catch (error) {
      console.error("Failed to add items:", error)
    }
  }


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
          const amount = item.amount ? toFraction(item.amount) : ""
          const unit = item.unit || ""
          const prefix = amount ? `${amount}${unit ? " " + unit : ""} ` : ""
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

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const activeId = String(active.id)
    setActiveItem(filteredItems.find((item) => item.rowId === activeId) || null)
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over || !filteredItems) {
      setDragOverCategory(null)
      return
    }
    const overItem = filteredItems.find((item) => item.rowId === String(over.id))
    setDragOverCategory(overItem?.categoryKey || null)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveItem(null)
    setDragOverCategory(null)

    if (!over || active.id === over.id || !shoppingList?.items) return

    const items = shoppingList.items
    const reorderResult = reorderByFilteredIndices(items, String(active.id), String(over.id))
    if (!reorderResult) return
    const { newItems, draggedItem, overItem, actualOverIndex } = reorderResult

    // Check if the item is being moved to a different category
    const oldCategory = draggedItem.categoryKey
    const newCategory = overItem.categoryKey

    if (oldCategory !== newCategory) {
      // Get category info (supports custom categories)
      const categoryInfo = getCategoryByKey(newCategory, config?.custom_categories || null)

      // Update the dragged item's category to match the drop target's category
      const updatedItem = {
        ...draggedItem,
        categoryKey: newCategory,
        categoryOrder: categoryInfo?.order || 8,
      }
      newItems[actualOverIndex] = updatedItem

      // Save category override for future shopping lists
      try {
        await saveCategoryOverride.mutateAsync({
          itemName: draggedItem.item,
          categoryKey: newCategory,
        })
      } catch (error) {
        console.error("Failed to save category override:", error)
      }
    }

    // Save the new order
    try {
      await reorderList.mutateAsync(newItems)
    } catch (error) {
      console.error("Failed to reorder:", error)
    }
  }

  return (
    <>
    <div className="flex-1 min-h-0 flex flex-col overflow-x-hidden">
      {/* Mobile sticky add item - always accessible at top */}
      <div className={cn("sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b border-stone-100 pb-3 mb-4", isDesktop && "hidden")}>
        <form onSubmit={handleAddItem} className="relative">
          <Input
            ref={addItemInputRef}
            placeholder="Add item..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            className="w-full h-11 pl-4 pr-14 py-2.5 text-base bg-white border-2 border-stone-100 rounded-xl shadow-sm focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0 focus-visible:border-primary"
          />
          <Button
            type="submit"
            disabled={addItem.isPending}
            aria-label="Add item"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 min-w-[44px] min-h-[44px] bg-primary text-primary-foreground rounded-full font-medium hover:opacity-90 flex items-center justify-center"
          >
            <span className="text-lg leading-none font-semibold">+</span>
          </Button>
        </form>
      </div>

      {/* Mobile header - compact title and icon buttons only */}
      <div className={cn("flex items-center justify-between mb-4", isDesktop && "hidden")}>
        <h1 className="font-display text-2xl font-bold text-foreground">Shopping List</h1>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-3 text-slate-500 hover:text-primary transition-colors rounded-lg"
            aria-label="Organize"
          >
            <Sparkles className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleClearListWithUndo}
            className="p-3 text-red-600 hover:text-red-700 transition-colors rounded-lg"
            aria-label="Clear list"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Desktop header - full layout with add item */}
      <header className={cn("mb-6 md:mb-2", !isDesktop && "hidden")}>
        {/* Desktop: title, subtitle, Organize + Copy + Clear */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-foreground mb-2">Shopping List</h1>
            <p className="text-muted-foreground">Plan your farm-to-table meals for the week.</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Button
              variant="outline"
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 border-stone-200 bg-white hover:bg-stone-50 hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Sparkles className="h-4 w-4" />
              Organize
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyList}
              className="flex items-center gap-2 border-stone-200 bg-white hover:bg-stone-50 hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={handleClearListWithUndo}
              className="flex items-center gap-2 border-red-100 text-red-600 bg-red-50 hover:bg-red-100 hover:text-red-700 rounded-lg px-4 py-2 text-sm font-medium"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>

        {/* Desktop add item form - stays in header */}
        <form onSubmit={handleAddItem} className="relative mb-6">
          <Input
            ref={addItemInputRef}
            placeholder="Add tomatoes, milk..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            className="w-full h-12 pl-6 pr-32 py-3 text-lg bg-white border-2 border-stone-100 rounded-xl shadow-sm focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0 focus-visible:border-primary"
          />
          <Button
            type="submit"
            disabled={addItem.isPending}
            aria-label="Add item"
            className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-auto px-6 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 flex items-center justify-center gap-2"
          >
            <Plus className="h-4 w-4" />
            <span>Add Item</span>
          </Button>
        </form>
      </header>

      {/* Shopping List — full width (sidebar removed) */}
      <div className="flex-1 min-h-0 flex flex-col overflow-x-hidden">
      {/* Shopping List */}
      {showLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : filteredItems.length === 0 && mergedAlreadyHave.length === 0 && projectedShoppingList.excluded.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={ShoppingCart}
            title="No shopping list yet"
            description="Add items manually above, or generate a meal plan and add it to your shopping list."
          />
        </div>
      ) : (
        <div className="relative">
          {/* Subtle loading indicator for background refetch */}
          {isFetching && !isLoading && (
            <div className="absolute top-0 right-0 z-10 p-2">
              <div className="bg-background/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div
            className="space-y-4"
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehavior: 'contain',
            }}
          >
            {/* Recipes in list — Collapsible on mobile, always expanded on desktop */}
            {uniqueRecipes.length > 0 && (
              <ShoppingStateSection
                title="Recipes in list"
                count={uniqueRecipes.length}
                isDesktop={isDesktop}
                isCollapsed={recipeSectionCollapsed}
                onToggle={toggleRecipeSection}
                expandLabel="Expand recipes list"
                collapseLabel="Collapse recipes list"
                mobileCountClassName="bg-accent-green/20 text-primary"
                mobileContent={
                  <div className="flex flex-wrap gap-2">
                    {uniqueRecipes.map((recipeName) => (
                      <RecipeTag
                        key={recipeName}
                        recipeName={recipeName}
                        onRemove={() => handleRemoveRecipeItems(recipeName)}
                        onViewRecipe={() => handleRecipeTagClick(undefined, recipeName)}
                        isRemoving={false}
                        colorIndex={recipeColorMap.get(recipeName)}
                      />
                    ))}
                  </div>
                }
                desktopContent={
                  <div className="flex flex-wrap gap-2">
                    {uniqueRecipes.map((recipeName) => (
                      <RecipeTag
                        key={recipeName}
                        recipeName={recipeName}
                        onRemove={() => handleRemoveRecipeItems(recipeName)}
                        onViewRecipe={() => handleRecipeTagClick(undefined, recipeName)}
                        isRemoving={false}
                        colorIndex={recipeColorMap.get(recipeName)}
                      />
                    ))}
                  </div>
                }
              />
            )}

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
              {/* Main shopping items grouped by category */}
              {(() => {
                let isFirstItem = true
                let globalIndexCounter = 0
                const itemToGlobalIndex = new Map<ShoppingItem, number>()
                filteredItems.forEach((item, idx) => {
                  if (!itemToGlobalIndex.has(item)) {
                    itemToGlobalIndex.set(item, idx)
                  }
                })
                return categoryViewModels.map((categoryData) => {
                  const items = categoryData.items

                  const isDragTarget =
                    activeItem &&
                    dragOverCategory === categoryData.key &&
                    activeItem.categoryKey !== categoryData.key

                  const isCollapsed = collapsedCategories.has(categoryData.key)
                  return (
                    <ShoppingCategorySection
                      key={categoryData.key}
                      categoryData={categoryData}
                      itemCount={items.length}
                      isCollapsed={isCollapsed}
                      isDragTarget={!!isDragTarget}
                      isBulkCheckOffPending={bulkCheckOff.isPending}
                      onToggleCategory={() => toggleCategory(categoryData.key)}
                      onBulkCheckOff={() => handleBulkCheckOff(items, categoryData.name)}
                    >
                      <ul className="divide-y divide-stone-100" style={{ contain: 'layout style paint' }}>
                        {items.map((item) => {
                          const showHintForThisItem = isFirstItem && showSwipeHint
                          if (isFirstItem) isFirstItem = false
                          let globalIndex = itemToGlobalIndex.get(item)
                          if (globalIndex === undefined) {
                            globalIndex = globalIndexCounter++
                            itemToGlobalIndex.set(item, globalIndex)
                          }
                          const reactKey = item.rowId || `${categoryData.key}-${item.item}-${item.unit || ''}-${globalIndex}`
                          return (
                            <SortableShoppingItem
                              key={reactKey}
                              item={item}
                              isDesktop={isDesktop}
                              onCheckOff={() => handleCheckOff(item)}
                              onRemove={() => handleRemoveItem(item)}
                              onAddToPantry={() => handleAddToPantry(item)}
                              isCheckingOff={pendingCheckItems.has(item.rowId || item.item.toLowerCase().trim())}
                              isRemoving={false}
                              isAddingToPantry={pendingPantryItems.has(item.rowId || item.item.toLowerCase().trim())}
                              recipeColorMap={recipeColorMap}
                              showSwipeHint={showHintForThisItem}
                            />
                          )
                        })}
                      </ul>
                    </ShoppingCategorySection>
                  )
                })
              })()}
            </SortableContext>

            <DragOverlay>
              {activeItem ? <DragOverlayItem item={activeItem} recipeColorMap={recipeColorMap} /> : null}
            </DragOverlay>
          </DndContext>

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
                  <p className="text-xs text-muted-foreground mb-3">Click to add back to list</p>
                  <div className="flex flex-wrap gap-2">
                    {mergedAlreadyHave.map((item, index) => (
                      <button
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        type="button"
                        onClick={() => moveToList.mutate(item)}
                        disabled={moveToList.isPending}
                        className="px-3 py-2 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 hover:bg-emerald-100 active:bg-emerald-100 transition-colors cursor-pointer min-h-[44px]"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        {item.item}
                      </button>
                    ))}
                  </div>
                </>
              }
              desktopContent={
                <>
                  <p className="text-xs text-muted-foreground mb-4">Click to add back to list</p>
                  <div className="flex flex-wrap gap-2">
                    {mergedAlreadyHave.map((item, index) => (
                      <button
                        key={item.rowId || `already-have-${item.item}-${item.unit || ''}-${index}`}
                        type="button"
                        onClick={() => moveToList.mutate(item)}
                        disabled={moveToList.isPending}
                        className="px-4 py-1.5 text-sm font-semibold bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100 hover:bg-emerald-100 active:bg-emerald-100 transition-colors cursor-pointer"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        {item.item}
                      </button>
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
                  <p className="text-xs text-muted-foreground mb-3">Items excluded by keywords. Click to add back to list.</p>
                  <div className="flex flex-wrap gap-2">
                    {projectedShoppingList.excluded.map((item, index) => (
                      <button
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        type="button"
                        onClick={() => moveExcludedToList.mutate(item)}
                        disabled={moveExcludedToList.isPending}
                        className="px-3 py-2 text-xs font-semibold bg-rose-50 text-rose-700 rounded-full border border-rose-100 hover:bg-rose-100 active:bg-rose-100 transition-colors cursor-pointer min-h-[44px] flex items-center gap-1.5"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        <span>{item.item}</span>
                        {item.excludedBy && (
                          <span className="text-[9px] opacity-60 font-normal"> ({item.excludedBy})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              }
              desktopContent={
                <>
                  <p className="text-xs text-muted-foreground mb-4">Items excluded by keywords. Click to add back to list.</p>
                  <div className="flex flex-wrap gap-2">
                    {projectedShoppingList.excluded.map((item, index) => (
                      <button
                        key={item.rowId || `excluded-${item.item}-${item.unit || ''}-${index}`}
                        type="button"
                        onClick={() => moveExcludedToList.mutate(item)}
                        disabled={moveExcludedToList.isPending}
                        className="px-4 py-1.5 text-sm font-semibold bg-rose-50 text-rose-700 rounded-full border border-rose-100 hover:bg-rose-100 active:bg-rose-100 transition-colors cursor-pointer flex items-center gap-1.5"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        <span>{item.item}</span>
                        {item.excludedBy && (
                          <span className="text-[9px] opacity-60 font-normal"> ({item.excludedBy})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              }
            />
          )}

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

      {/* Recipe Detail Dialog */}
      {viewingRecipeId && (
        <RecipeDetailDialog
          open={!!viewingRecipe}
          onOpenChange={(open) => {
            if (!open) {
              setViewingRecipeId(null)
            }
          }}
          recipe={viewingRecipe || null}
          onEdit={(r) => {
            setViewingRecipeId(null)
            setEditingRecipe(r)
          }}
        />
      )}

      {/* Edit Recipe Dialog */}
      <RecipeDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        recipe={editingRecipe || undefined}
        categories={categories || []}
      />
    </div>

    {/* Scroll to top FAB - mobile only (outside overflow container) */}
    {showScrollToTop && (
      <button
        onClick={handleScrollToTop}
        className={cn("fixed bottom-28 right-4 z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center", isDesktop && "hidden")}
        aria-label="Scroll to top"
      >
        <ChevronUp className="h-5 w-5" />
      </button>
    )}
    </>
  )
}
