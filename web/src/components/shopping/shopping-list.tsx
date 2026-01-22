"use client"

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { Plus, Trash2, Package, Ban, Check, CheckCheck, Copy, GripVertical, X, Settings, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
  useUpdateItemCategory,
  useShoppingConfig,
  useUpdateShoppingConfig,
  useAddToPantryAndRemove,
} from "@/hooks/use-shopping"
import { SHOPPING_CATEGORIES, getAllShoppingCategories, getCategoryByKey } from "@/lib/shopping-categories"
import { getDefaultShoppingList } from "@/lib/guest-storage"
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { ShoppingItem, ShoppingList, Recipe } from "@/types/database"
import { toFraction } from "@/lib/utils"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
import { RecipeDialog } from "@/components/recipes/recipe-dialog"
import { useRecipe, useRecipes, useCategories } from "@/hooks/use-recipes"

// Color palette for recipe source tags (excluding grey which is reserved for Manual)
const RECIPE_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  { bg: "bg-emerald-100", text: "text-emerald-700", border: "border-emerald-200" },
  { bg: "bg-amber-100", text: "text-amber-700", border: "border-amber-200" },
  { bg: "bg-violet-100", text: "text-violet-700", border: "border-violet-200" },
  { bg: "bg-rose-100", text: "text-rose-700", border: "border-rose-200" },
  { bg: "bg-cyan-100", text: "text-cyan-700", border: "border-cyan-200" },
  { bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-200" },
  { bg: "bg-indigo-100", text: "text-indigo-700", border: "border-indigo-200" },
  { bg: "bg-pink-100", text: "text-pink-700", border: "border-pink-200" },
  { bg: "bg-teal-100", text: "text-teal-700", border: "border-teal-200" },
]

// Generate a consistent color index from a string
function getColorIndex(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % RECIPE_COLORS.length
}

// Source tag component (for item rows) - with tap-to-expand for truncated names
function SourceTag({
  recipeName,
  recipeId,
  colorIndex,
  onClick
}: {
  recipeName: string
  recipeId?: string
  colorIndex?: number
  onClick?: () => void
}) {
  const isManual = recipeName === "Manual"

  if (isManual) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
        Manual
      </span>
    )
  }

  const index = colorIndex !== undefined ? colorIndex : getColorIndex(recipeName)
  const colors = RECIPE_COLORS[index % RECIPE_COLORS.length]

  // Truncate long recipe names
  const isTruncated = recipeName.length > 20
  const displayName = isTruncated ? recipeName.slice(0, 18) + "…" : recipeName

  const baseClasses = `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`
  const clickableClasses = onClick ? "cursor-pointer hover:opacity-80 active:opacity-70 transition-opacity" : "cursor-default"

  const tagContent = (
    <span
      className={`${baseClasses} ${clickableClasses}`}
      onClick={onClick}
      title={onClick ? `Click to view ${recipeName}` : recipeName}
    >
      {displayName}
    </span>
  )

  // If not truncated, just show the tag
  if (!isTruncated) {
    return tagContent
  }

  // If truncated, wrap in popover for tap-to-expand on mobile
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span
          className={`${baseClasses} cursor-pointer`}
          title={recipeName}
        >
          {displayName}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="text-sm p-2 w-auto max-w-[200px]">
        <div className="flex items-center gap-2">
          <span>{recipeName}</span>
          {onClick && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClick()
              }}
              className="text-xs text-primary hover:underline"
            >
              View recipe
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Recipe tag with remove button (for header section)
function RecipeTag({ 
  recipeName, 
  onRemove, 
  isRemoving,
  colorIndex
}: { 
  recipeName: string
  onRemove: () => void
  isRemoving: boolean
  colorIndex?: number
}) {
  const index = colorIndex !== undefined ? colorIndex : getColorIndex(recipeName)
  const colors = RECIPE_COLORS[index % RECIPE_COLORS.length]
  
  // Truncate long recipe names
  const displayName = recipeName.length > 25 ? recipeName.slice(0, 23) + "…" : recipeName
  
  return (
    <span 
      className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
      title={recipeName}
    >
      {displayName}
      <button
        type="button"
        onClick={onRemove}
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
  onCheckOff,
  onRemove,
  onAddToPantry,
  onRecipeTagClick,
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
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  onRecipeTagClick: (recipeId: string | undefined, recipeName: string) => void
  isCheckingOff: boolean
  isRemoving: boolean
  isAddingToPantry: boolean
  recipeColorMap: Map<string, number>
  dragHandleProps?: any
  dragStyle?: React.CSSProperties
  isDragging?: boolean
  showSwipeHint?: boolean
}) {
  const isChecked = item.checked || false
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchStartTime = useRef<number | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
      const SWIPE_THRESHOLD = 100 // Minimum swipe distance to reveal buttons
      const DELETE_THRESHOLD = 150 // Distance to trigger delete (not used with two buttons)
  const SWIPE_VELOCITY_THRESHOLD = 0.5 // Minimum velocity for quick swipe
  const MIN_SWIPE_DISTANCE = 20 // Minimum distance before tracking
  const MAX_VERTICAL_DEVIATION = 30 // Max vertical movement allowed

  const formatAmount = (item: ShoppingItem) => {
    const parts: string[] = []
    
    // Primary amount
    if (item.amount) {
      const amt = toFraction(item.amount)
      parts.push(`${amt}${item.unit ? " " + item.unit : ""}`)
    }
    
    // Additional amounts (when units couldn't be merged)
    if (item.additionalAmounts && item.additionalAmounts.length > 0) {
      for (const additional of item.additionalAmounts) {
        if (additional.amount) {
          const amt = toFraction(additional.amount)
          parts.push(`${amt}${additional.unit ? " " + additional.unit : ""}`)
        }
      }
    }
    
    return parts.join(" + ")
  }

  // Deduplicate sources (same recipe might appear multiple times)
  const uniqueSources = useMemo(() => {
    if (!item.sources) return []
    const seen = new Set<string>()
    return item.sources.filter((source) => {
      if (seen.has(source.recipeName)) return false
      seen.add(source.recipeName)
      return true
    })
  }, [item.sources])

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only handle swipe on mobile (touch devices)
    if (window.innerWidth >= 768) return
    
    // Don't start swipe if touch started on drag handle, checkbox, or delete button
    const target = e.target as HTMLElement
    const button = target.closest('button')
    
    // If touching a button, check if it's the drag handle or checkbox
    if (button) {
      // Don't start swipe for drag handle or checkbox buttons (using data attributes)
      if (button.hasAttribute('data-drag-handle') || button.hasAttribute('data-checkbox')) {
        return
      }
      
      // Don't start swipe for the delete button (revealed on swipe)
      if (button.closest('.bg-destructive')) {
        return
      }
    }
    
    // The touch-action CSS property will handle preventing scroll interference
    // No need to check for scrollable parents as it blocks all swipes
    
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    touchStartTime.current = Date.now()
    setIsSwiping(false) // Don't set to true until we confirm it's a horizontal swipe
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || window.innerWidth >= 768) return
    
    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const deltaX = touchStartX.current - currentX
    const deltaY = Math.abs(touchStartY.current - currentY)
    const absDeltaX = Math.abs(deltaX)
    
    // If vertical movement is significantly greater than horizontal, allow scrolling
    if (deltaY > absDeltaX * 1.5 && deltaY > 10) {
      // This is a scroll gesture, not a swipe - reset and allow native scrolling
      touchStartX.current = null
      touchStartY.current = null
      touchStartTime.current = null
      setIsSwiping(false)
      setSwipeOffset(0)
      return
    }
    
    // Only proceed if horizontal movement is dominant and we've moved enough
    if (absDeltaX > MIN_SWIPE_DISTANCE && absDeltaX > deltaY && deltaY < MAX_VERTICAL_DEVIATION) {
      if (!isSwiping) {
        setIsSwiping(true)
      }
      
      // Only allow left swipe (positive deltaX)
      if (deltaX > 0) {
        const maxSwipe = 120 // Maximum swipe distance
        setSwipeOffset(Math.min(deltaX, maxSwipe))
        // Only prevent default once we're actually swiping horizontally
        e.preventDefault()
      }
    } else if (isSwiping && deltaY > absDeltaX) {
      // If we were swiping but now it's more vertical, cancel the swipe
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

    // Only process if we were actually swiping
    if (!isSwiping || swipeOffset < MIN_SWIPE_DISTANCE) {
      setSwipeOffset(0)
      setIsSwiping(false)
      touchStartX.current = null
      touchStartY.current = null
      touchStartTime.current = null
      return
    }

    const timeElapsed = Date.now() - touchStartTime.current
    const velocity = timeElapsed > 0 ? swipeOffset / timeElapsed : 0

    // Reveal buttons if swiped far enough
    if (swipeOffset >= SWIPE_THRESHOLD) {
      // Reveal action buttons (pantry + delete)
      setSwipeOffset(160) // Reveal both buttons
    } else {
      // Snap back
      setSwipeOffset(0)
    }
    
    setIsSwiping(false)
    touchStartX.current = null
    touchStartY.current = null
    touchStartTime.current = null
  }

  // Reset swipe when item changes
  useEffect(() => {
    setSwipeOffset(0)
  }, [item.item])

  // Close swipe when clicking outside
  useEffect(() => {
    if (swipeOffset > 0) {
      const handleClickOutside = (e: MouseEvent) => {
        if (itemRef.current && !itemRef.current.contains(e.target as Node)) {
          setSwipeOffset(0)
        }
      }
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
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
      {/* Action buttons (revealed on swipe) - mobile only */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center gap-2 px-2 transition-transform duration-200 ease-out md:hidden"
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

      {/* Main item content */}
      <div
        className={`flex items-center justify-between px-4 py-3.5 md:py-3 group transition-transform duration-200 ease-out swipeable-content hover:bg-sage-50/50 ${showSwipeHint ? 'animate-swipe-hint' : ''}`}
        style={{
          transform: showSwipeHint ? undefined : `translateX(-${swipeOffset}px)`,
          ...dragStyle,
          opacity: isDragging ? 0.5 : 1,
          willChange: isSwiping || isDragging ? 'transform' : 'auto',
        }}
      >
        {/* Swipe hint tooltip */}
        {showSwipeHint && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs px-2 py-1 rounded whitespace-nowrap z-10 md:hidden">
            Swipe left to delete
          </div>
        )}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Drag handle - visible on all screen sizes */}
          <button
            type="button"
            data-drag-handle="true"
            className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1 flex-shrink-0"
            style={{ touchAction: 'none' }}
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          
          {/* Checkbox - larger on mobile for better touch target */}
          <button
            type="button"
            data-checkbox="true"
            onClick={onCheckOff}
            disabled={isCheckingOff}
            className={`w-6 h-6 md:w-5 md:h-5 rounded border-2 flex items-center justify-center transition-all active:scale-95 flex-shrink-0 ${
              isChecked
                ? "border-sage-500 bg-sage-500 text-white"
                : "border-sage-300 hover:border-sage-500 hover:bg-sage-100 active:bg-sage-200"
            }`}
            aria-label={isChecked ? "Uncheck item" : "Check off item"}
          >
            {isChecked && <Check className="h-4 w-4 md:h-3 md:w-3" />}
          </button>
          
          <div className={`flex items-center gap-2 min-w-0 flex-1 flex-wrap ${isChecked ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {formatAmount(item) && (
                <span className={`text-sm font-medium ${isChecked ? "text-gray-500 line-through" : "text-gray-700"}`}>
                  {formatAmount(item)}
                </span>
              )}
              <span className={`text-sm ${isChecked ? "text-gray-500 line-through" : "text-gray-600"}`}>
                {item.item}
              </span>
              {uniqueSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {uniqueSources.map((source, idx) => (
                    <SourceTag 
                      key={`${source.recipeName}-${idx}`} 
                      recipeName={source.recipeName}
                      recipeId={source.recipeId}
                      colorIndex={recipeColorMap.get(source.recipeName)}
                      onClick={() => onRecipeTagClick(source.recipeId, source.recipeName)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Desktop action buttons */}
        <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-sage-600 flex-shrink-0"
            onClick={onAddToPantry}
            disabled={isAddingToPantry}
            title="Add to pantry"
          >
            <Package className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
            onClick={onRemove}
            disabled={isRemoving}
            title="Remove from list"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Sortable item component - memoized for better scroll performance
const SortableShoppingItem = memo(function SortableShoppingItem({
  item,
  itemIdx,
  onCheckOff,
  onRemove,
  onAddToPantry,
  onRecipeTagClick,
  isCheckingOff,
  isRemoving,
  isAddingToPantry,
  recipeColorMap,
  showSwipeHint,
}: {
  item: ShoppingItem
  itemIdx: number
  onCheckOff: () => void
  onRemove: () => void
  onAddToPantry: () => void
  onRecipeTagClick: (recipeId: string | undefined, recipeName: string) => void
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
  } = useSortable({ id: `idx-${itemIdx}` })

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li ref={setNodeRef}>
      <SwipeableItem
        item={item}
        onCheckOff={onCheckOff}
        onRemove={onRemove}
        onAddToPantry={onAddToPantry}
        onRecipeTagClick={onRecipeTagClick}
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
    prevProps.item.amount === nextProps.item.amount &&
    prevProps.item.unit === nextProps.item.unit &&
    prevProps.item.categoryKey === nextProps.item.categoryKey &&
    prevProps.item.checked === nextProps.item.checked &&
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.isRemoving === nextProps.isRemoving &&
    prevProps.isAddingToPantry === nextProps.isAddingToPantry &&
    prevProps.showSwipeHint === nextProps.showSwipeHint &&
    prevProps.onRecipeTagClick === nextProps.onRecipeTagClick &&
    JSON.stringify(prevProps.item.sources) === JSON.stringify(nextProps.item.sources)
  )
})

// Drag overlay item (shown while dragging)
function DragOverlayItem({ 
  item, 
  recipeColorMap,
  onRecipeTagClick
}: { 
  item: ShoppingItem
  recipeColorMap: Map<string, number>
  onRecipeTagClick: (recipeId: string | undefined, recipeName: string) => void
}) {
  const formatAmount = (item: ShoppingItem) => {
    const parts: string[] = []
    
    if (item.amount) {
      const amt = toFraction(item.amount)
      parts.push(`${amt}${item.unit ? " " + item.unit : ""}`)
    }
    
    if (item.additionalAmounts && item.additionalAmounts.length > 0) {
      for (const additional of item.additionalAmounts) {
        if (additional.amount) {
          const amt = toFraction(additional.amount)
          parts.push(`${amt}${additional.unit ? " " + additional.unit : ""}`)
        }
      }
    }
    
    return parts.join(" + ")
  }

  // Deduplicate sources
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
          {formatAmount(item) && (
            <span className="text-muted-foreground mr-1.5 font-medium">
              {formatAmount(item)}
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
                recipeId={source.recipeId}
                colorIndex={recipeColorMap.get(source.recipeName)}
                onClick={() => onRecipeTagClick(source.recipeId, source.recipeName)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Custom hook for swipe hint on first visit
function useSwipeHint() {
  const [showSwipeHint, setShowSwipeHint] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)

  useEffect(() => {
    // Only show on mobile devices
    if (typeof window === 'undefined' || window.innerWidth >= 768) return

    // Check if hint has been shown before
    const hintShown = localStorage.getItem('shopping-swipe-hint-shown')
    if (!hintShown) {
      // Delay the hint to allow list to render
      const timer = setTimeout(() => {
        setShowSwipeHint(true)
        // Mark as shown
        localStorage.setItem('shopping-swipe-hint-shown', 'true')
        // Auto-dismiss hint after animation completes
        setTimeout(() => {
          setHintDismissed(true)
        }, 2000)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [])

  return { showSwipeHint: showSwipeHint && !hintDismissed }
}

export function ShoppingListView() {
  const [newItem, setNewItem] = useState("")
  const [activeItem, setActiveItem] = useState<ShoppingItem | null>(null)
  const [pendingItemDeletion, setPendingItemDeletion] = useState<string | null>(null)
  const [pendingRecipeDeletion, setPendingRecipeDeletion] = useState<string | null>(null)
  const [pendingClearList, setPendingClearList] = useState(false)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())
  const [manuallyExpandedCategories, setManuallyExpandedCategories] = useState<Set<string>>(new Set())
  const [viewingRecipeId, setViewingRecipeId] = useState<string | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const { showSwipeHint } = useSwipeHint()

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
  const updateItemCategory = useUpdateItemCategory()
  const addToPantryAndRemove = useAddToPantryAndRemove()
  const undoToast = useUndoToast()

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
  const handleRemoveItem = useCallback((itemName: string) => {
    setPendingItemDeletion(itemName)
    undoToast.show({
      message: `"${itemName}" removed from list`,
      onUndo: () => {
        setPendingItemDeletion(null)
      },
      onExpire: () => {
        removeItem.mutate(itemName)
        setPendingItemDeletion(null)
      },
    })
  }, [undoToast, removeItem])

  // Handle recipe items removal with undo
  const handleRemoveRecipeItems = useCallback((recipeName: string) => {
    setPendingRecipeDeletion(recipeName)
    undoToast.show({
      message: `Items from "${recipeName}" removed`,
      onUndo: () => {
        setPendingRecipeDeletion(null)
      },
      onExpire: () => {
        removeRecipeItems.mutate(recipeName)
        setPendingRecipeDeletion(null)
      },
    })
  }, [undoToast, removeRecipeItems])

  // Handle clear list with undo
  const handleClearListWithUndo = useCallback(() => {
    setPendingClearList(true)
    undoToast.show({
      message: "Shopping list cleared",
      onUndo: () => {
        setPendingClearList(false)
      },
      onExpire: () => {
        clearList.mutate()
        setPendingClearList(false)
      },
    })
  }, [undoToast, clearList])

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

  // Handle adding item to pantry
  const handleAddToPantry = useCallback((item: ShoppingItem) => {
    addToPantryAndRemove.mutate(item)
    undoToast.show({
      message: `"${item.item}" added to pantry`,
      duration: 2000,
    })
  }, [addToPantryAndRemove, undoToast])

  // Toggle category collapse
  const toggleCategory = useCallback((categoryKey: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(categoryKey)) {
        // Expanding - mark as manually expanded
        next.delete(categoryKey)
        setManuallyExpandedCategories(prevExpanded => {
          const nextExpanded = new Set(prevExpanded)
          nextExpanded.add(categoryKey)
          return nextExpanded
        })
      } else {
        // Collapsing - remove from manually expanded
        next.add(categoryKey)
        setManuallyExpandedCategories(prevExpanded => {
          const nextExpanded = new Set(prevExpanded)
          nextExpanded.delete(categoryKey)
          return nextExpanded
        })
      }
      return next
    })
  }, [])

  // Set up drag sensors with higher activation distance on mobile to avoid interfering with scrolling
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: typeof window !== 'undefined' && window.innerWidth < 768 ? 15 : 8, // Higher threshold on mobile
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Show cached data immediately even while fetching (stale-while-revalidate)
  const displayShoppingList = shoppingList || getDefaultShoppingList() as ShoppingList
  
  // Merge duplicate items in already_have by name (e.g., multiple "garlic" entries)
  const mergedAlreadyHave = useMemo(() => {
    const alreadyHave = displayShoppingList.already_have || []
    if (alreadyHave.length === 0) return []
    
    const itemMap = new Map<string, ShoppingItem>()
    
    for (const item of alreadyHave) {
      const key = item.item.toLowerCase()
      const existing = itemMap.get(key)
      
      if (existing) {
        // Merge sources
        const existingSources = existing.sources || []
        const newSources = item.sources || []
        const sourceSet = new Set(existingSources.map((s) => s.recipeName))
        const combinedSources = [...existingSources]
        for (const source of newSources) {
          if (!sourceSet.has(source.recipeName)) {
            combinedSources.push(source)
          }
        }
        
        // Merge amounts
        const mergeResult = mergeAmounts(existing.amount, existing.unit, item.amount, item.unit)
        if (mergeResult) {
          itemMap.set(key, {
            ...existing,
            amount: roundForDisplay(mergeResult.amount),
            unit: mergeResult.unit,
            sources: combinedSources,
          })
        } else {
          // Units incompatible, keep existing but combine sources
          itemMap.set(key, {
            ...existing,
            sources: combinedSources,
          })
        }
      } else {
        itemMap.set(key, item)
      }
    }
    
    return Array.from(itemMap.values())
  }, [displayShoppingList.already_have])
  
  // Only show loading on initial load with no cached data
  const showLoading = isLoading && !shoppingList

  // Filter items for pending deletions
  const filteredItems = useMemo(() => {
    if (pendingClearList) return []
    let items = displayShoppingList?.items || []

    // Filter out single pending item deletion
    if (pendingItemDeletion) {
      items = items.filter(item => item.item !== pendingItemDeletion)
    }

    // Filter out items from pending recipe deletion
    if (pendingRecipeDeletion) {
      items = items.filter(item => {
        if (!item.sources) return true
        // Remove if all sources are from the pending recipe
        const nonPendingSources = item.sources.filter(s => s.recipeName !== pendingRecipeDeletion)
        return nonPendingSources.length > 0 || item.sources.length === 0
      })
    }

    return items
  }, [displayShoppingList?.items, pendingItemDeletion, pendingRecipeDeletion, pendingClearList])

  // Group items by category
  const groupedItems = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => {
        const category = item.categoryKey || "misc"
        if (!acc[category]) acc[category] = []
        acc[category].push(item)
        return acc
      },
      {} as Record<string, ShoppingItem[]>
    )
  }, [filteredItems])

  // Get ordered categories (with custom categories and custom ordering)
  const orderedCategories = useMemo(() => {
    return getAllShoppingCategories(
      config?.custom_categories || null,
      config?.category_order || null
    )
  }, [config?.custom_categories, config?.category_order])

  // Check if all items are checked
  const allItemsChecked = useMemo(() => {
    if (!filteredItems || filteredItems.length === 0) return false
    return filteredItems.every(item => item.checked === true)
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

  // Auto-collapse category when all items in it are checked (only if not manually expanded)
  useEffect(() => {
    const newCollapsed = new Set(collapsedCategories)
    let hasChanges = false
    
    orderedCategories.forEach(categoryData => {
      const items = groupedItems[categoryData.key]
      if (items && items.length > 0) {
        const allChecked = items.every(item => item.checked === true)
        if (allChecked && !manuallyExpandedCategories.has(categoryData.key)) {
          // Only auto-collapse if not manually expanded
          if (!newCollapsed.has(categoryData.key)) {
            newCollapsed.add(categoryData.key)
            hasChanges = true
          }
        } else if (!allChecked && newCollapsed.has(categoryData.key) && !manuallyExpandedCategories.has(categoryData.key)) {
          // Auto-expand if items become unchecked (only if not manually collapsed)
          newCollapsed.delete(categoryData.key)
          hasChanges = true
        }
      }
    })
    
    if (hasChanges) {
      setCollapsedCategories(newCollapsed)
    }
  }, [filteredItems, groupedItems, orderedCategories, manuallyExpandedCategories])

  // Create a flat list of all item IDs for the sortable context
  // Use index-based IDs to ensure uniqueness while preserving drag-and-drop functionality
  // Format: "idx-{index}" to avoid conflicts with item names that contain hyphens
  const allItemIds = useMemo(() => {
    return filteredItems.map((item, idx) => `idx-${idx}`)
  }, [filteredItems])

  // Get unique recipe names from active items only (excluding "Manual" and pending deletions)
  // Only show recipe tags when there are active unchecked items
  const uniqueRecipes = useMemo(() => {
    if (pendingClearList) return []
    const items = shoppingList?.items || []
    // Only show recipes for active items, not checked ones
    if (items.length === 0) return []

    const recipeSet = new Set<string>()
    for (const item of items) {
      if (item.sources) {
        for (const source of item.sources) {
          if (source.recipeName !== "Manual" && source.recipeName !== pendingRecipeDeletion) {
            recipeSet.add(source.recipeName)
          }
        }
      }
    }
    return Array.from(recipeSet).sort()
  }, [shoppingList?.items, pendingRecipeDeletion, pendingClearList])

  // Create a color mapping that assigns unique colors sequentially to recipes
  const recipeColorMap = useMemo(() => {
    const map = new Map<string, number>()
    uniqueRecipes.forEach((recipeName, index) => {
      map.set(recipeName, index)
    })
    return map
  }, [uniqueRecipes])

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    // Split by comma and filter empty strings
    const items = newItem
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    if (items.length === 0) return

    try {
      // Add each item
      const addedItems: string[] = []
      for (const item of items) {
        try {
          await addItem.mutateAsync({ itemName: item })
          addedItems.push(item)
        } catch (error) {
          // Skip duplicates or errors for individual items
          console.warn(`Skipped item "${item}":`, error)
        }
      }
      setNewItem("")

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
    // Extract index from ID (format: "idx-{index}")
    const index = typeof active.id === 'string' ? parseInt(active.id.replace('idx-', ''), 10) : -1
    if (index >= 0 && index < filteredItems.length) {
      setActiveItem(filteredItems[index])
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over || !filteredItems) {
      setDragOverCategory(null)
      return
    }
    // Extract index from ID (format: "idx-{index}")
    const index = typeof over.id === 'string' ? parseInt(over.id.replace('idx-', ''), 10) : -1
    if (index >= 0 && index < filteredItems.length) {
      const overItem = filteredItems[index]
      setDragOverCategory(overItem.categoryKey || null)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveItem(null)
    setDragOverCategory(null)

    if (!over || active.id === over.id || !shoppingList?.items) return

    // Extract indices from IDs (format: "idx-{index}")
    const activeIndex = typeof active.id === 'string' ? parseInt(active.id.replace('idx-', ''), 10) : -1
    const overIndex = typeof over.id === 'string' ? parseInt(over.id.replace('idx-', ''), 10) : -1

    if (activeIndex === -1 || overIndex === -1 || activeIndex >= filteredItems.length || overIndex >= filteredItems.length) return

    // Map filtered indices to actual item indices in shoppingList.items
    const activeItemFromFiltered = filteredItems[activeIndex]
    const overItemFromFiltered = filteredItems[overIndex]
    const items = shoppingList.items
    const actualActiveIndex = items.findIndex((i) => i.item === activeItemFromFiltered.item)
    const actualOverIndex = items.findIndex((i) => i.item === overItemFromFiltered.item)

    if (actualActiveIndex === -1 || actualOverIndex === -1) return

    const draggedItem = items[actualActiveIndex]
    const overItem = items[actualOverIndex]

    // Create new array with reordered items
    const newItems = [...items]
    newItems.splice(activeIndex, 1)
    newItems.splice(overIndex, 0, draggedItem)

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
      newItems[overIndex] = updatedItem

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

  const formatAmount = (item: ShoppingItem) => {
    const parts: string[] = []
    
    if (item.amount) {
      const amt = toFraction(item.amount)
      parts.push(`${amt}${item.unit ? " " + item.unit : ""}`)
    }
    
    if (item.additionalAmounts && item.additionalAmounts.length > 0) {
      for (const additional of item.additionalAmounts) {
        if (additional.amount) {
          const amt = toFraction(additional.amount)
          parts.push(`${amt}${additional.unit ? " " + additional.unit : ""}`)
        }
      }
    }
    
    return parts.join(" + ")
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Shopping List</h1>

      {/* Add Item */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleAddItem} className="flex gap-2">
            <Input
              placeholder="Add items (comma separated)..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="flex-1 text-base sm:text-sm"
            />
            <Button type="submit" disabled={addItem.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Recipe Sources and Action Buttons */}
      {(uniqueRecipes.length > 0 || filteredItems.length > 0) && (
        <div className="space-y-3 md:space-y-2">
          {/* Recipe tags - horizontally scrollable on mobile */}
          {uniqueRecipes.length > 0 && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground mb-2">Recipes in list:</p>
              <div className="relative">
                {/* Scrollable container with fade indicators */}
                <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:overflow-visible">
                  <div className="flex gap-2 md:flex-wrap min-w-max md:min-w-0 pb-1 md:pb-0">
                    {uniqueRecipes.map((recipeName) => (
                      <RecipeTag
                        key={recipeName}
                        recipeName={recipeName}
                        onRemove={() => handleRemoveRecipeItems(recipeName)}
                        isRemoving={false}
                        colorIndex={recipeColorMap.get(recipeName)}
                      />
                    ))}
                  </div>
                </div>
                {/* Fade indicator on mobile - only show if scrollable */}
                {uniqueRecipes.length > 2 && (
                  <div className="absolute right-0 top-6 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none md:hidden" />
                )}
              </div>
            </div>
          )}
          
          {/* Action buttons - icon-only on mobile */}
          {filteredItems.length > 0 && (
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowSettings(true)}
                className="h-11 w-11 md:h-auto md:w-auto md:px-4"
                title="Organize categories"
              >
                <Settings className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Organize</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyList}
                className="h-11 w-11 md:h-auto md:w-auto md:px-4"
                title="Copy list"
              >
                <Copy className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Copy</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleClearListWithUndo}
                className="h-11 w-11 md:h-auto md:w-auto md:px-4"
                title="Clear list"
              >
                <Trash2 className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Clear</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Shopping List */}
      {showLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No shopping list yet"
          description="Add items manually above, or generate a meal plan and add it to your shopping list."
        />
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
                let isFirstItem = true // Track if we've shown hint yet
                let globalIndexCounter = 0 // Track global index across all categories
                // Create a map of item to global index for reliable lookup
                const itemToGlobalIndex = new Map<ShoppingItem, number>()
                filteredItems.forEach((item, idx) => {
                  // Use a unique key based on item properties to handle potential duplicates
                  const itemKey = `${item.item.toLowerCase()}-${item.unit || ''}-${item.amount || 0}`
                  if (!itemToGlobalIndex.has(item)) {
                    itemToGlobalIndex.set(item, idx)
                  }
                })
                return orderedCategories.map((categoryData) => {
                  const items = groupedItems[categoryData.key]
                  if (!items || items.length === 0) return null

                  // Check if this category is a valid drop target
                  const isDragTarget = activeItem &&
                    dragOverCategory === categoryData.key &&
                    activeItem.categoryKey !== categoryData.key

                  const isCollapsed = collapsedCategories.has(categoryData.key)
                  const checkedCount = items.filter(item => item.checked).length

                  return (
                    <Card
                      key={categoryData.key}
                      className={`animate-fade-in transition-all duration-200 ${
                        isDragTarget ? 'border-2 border-dashed border-primary bg-primary/5' : ''
                      }`}
                    >
                      <CardHeader 
                        className="px-4 py-2.5 border-b border-sage-100 bg-transparent cursor-pointer hover:bg-sage-50/50 transition-colors"
                        onClick={() => toggleCategory(categoryData.key)}
                      >
                        <CardTitle className="text-xs font-semibold text-sage-600 uppercase tracking-wide flex items-center gap-2">
                          <Package className="h-3.5 w-3.5" />
                          {categoryData.name}
                          {categoryData.isCustom && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded normal-case">Custom</span>
                          )}
                          <div className="flex items-center gap-2 ml-auto">
                            {items.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleBulkCheckOff(items, categoryData.name)
                                }}
                                disabled={bulkCheckOff.isPending}
                                className="h-6 px-2 text-[10px] text-sage-500 hover:text-sage-700 hover:bg-sage-100"
                                title={`Check all items in ${categoryData.name}`}
                              >
                                <CheckCheck className="h-3 w-3 mr-1" />
                                <span className="hidden sm:inline">All</span>
                              </Button>
                            )}
                            <span className="text-xs font-normal text-sage-400">
                              ({checkedCount}/{items.length})
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleCategory(categoryData.key)
                              }}
                              className="ml-1 p-1 hover:bg-sage-100 rounded transition-colors"
                              aria-label={isCollapsed ? "Expand category" : "Collapse category"}
                            >
                              {isCollapsed ? (
                                <ChevronDown className="h-4 w-4 text-sage-500" />
                              ) : (
                                <ChevronUp className="h-4 w-4 text-sage-500" />
                              )}
                            </button>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      {!isCollapsed && (
                        <CardContent className="p-0">
                          <ul className="divide-y divide-sage-50" style={{ contain: 'layout style paint' }}>
                            {items.map((item, itemIdx) => {
                            const showHintForThisItem = isFirstItem && showSwipeHint
                            if (isFirstItem) isFirstItem = false
                            // Get global index from map, or use counter as fallback
                            let globalIndex = itemToGlobalIndex.get(item)
                            if (globalIndex === undefined) {
                              globalIndex = globalIndexCounter++
                              itemToGlobalIndex.set(item, globalIndex)
                            }
                            // Use a unique key that includes category, item name, unit, and GLOBAL index to prevent duplicates
                            // Using globalIndex ensures uniqueness even if items have the same name/unit
                            const reactKey = `${categoryData.key}-${item.item}-${item.unit || ''}-${globalIndex}`
                            return (
                              <SortableShoppingItem
                                key={reactKey}
                                item={item}
                                itemIdx={globalIndex}
                                onCheckOff={() => checkOffItem.mutate(item)}
                                onRemove={() => handleRemoveItem(item.item)}
                                onAddToPantry={() => handleAddToPantry(item)}
                                onRecipeTagClick={handleRecipeTagClick}
                                isCheckingOff={checkOffItem.isPending}
                                isRemoving={false}
                                isAddingToPantry={addToPantryAndRemove.isPending}
                                recipeColorMap={recipeColorMap}
                                showSwipeHint={showHintForThisItem}
                              />
                            )
                          })}
                        </ul>
                      </CardContent>
                      )}
                    </Card>
                  )
                })
              })()}
            </SortableContext>

            <DragOverlay>
              {activeItem ? <DragOverlayItem item={activeItem} recipeColorMap={recipeColorMap} onRecipeTagClick={handleRecipeTagClick} /> : null}
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

          {/* Pantry Section */}
          {mergedAlreadyHave && mergedAlreadyHave.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="px-4 py-2.5 border-b border-sage-100 bg-transparent">
                <CardTitle className="text-xs font-semibold text-sage-600 uppercase tracking-wide flex items-center gap-2">
                  <Package className="h-3.5 w-3.5" />
                  Pantry
                  <span className="text-xs font-normal text-sage-400 ml-auto">({mergedAlreadyHave.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 px-4 pb-4">
                <p className="text-xs text-muted-foreground mb-2">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {mergedAlreadyHave.map((item, index) => (
                    <button
                      key={`already-have-${item.item}-${item.unit || ''}-${index}`}
                      type="button"
                      onClick={() => moveToList.mutate(item)}
                      disabled={moveToList.isPending}
                      className="px-3 py-2 md:px-2.5 md:py-1 bg-sage-100 text-sage-700 rounded-full text-sm font-medium animate-fade-in hover:bg-sage-200 active:bg-sage-300 transition-colors cursor-pointer min-h-[44px] md:min-h-0"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {item.item}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Excluded Section */}
          {displayShoppingList?.excluded && displayShoppingList.excluded.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="px-4 py-2.5 border-b border-terracotta-100 bg-transparent">
                <CardTitle className="text-xs font-semibold text-terracotta-700 uppercase tracking-wide flex items-center gap-2">
                  <Ban className="h-3.5 w-3.5" />
                  Excluded
                  <span className="text-xs font-normal text-terracotta-500 ml-auto">({displayShoppingList.excluded.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 px-4 pb-4">
                <p className="text-xs text-muted-foreground mb-2">
                  Items excluded by your keywords. Click to add back to list.
                </p>
                <div className="flex flex-wrap gap-2">
                  {displayShoppingList.excluded.map((item, index) => (
                    <button
                      key={`excluded-${item.item}-${item.unit || ''}-${index}`}
                      type="button"
                      onClick={() => moveExcludedToList.mutate(item)}
                      disabled={moveExcludedToList.isPending}
                      className="px-3 py-2 md:px-2.5 md:py-1 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in hover:bg-terracotta-200 active:bg-terracotta-300 transition-colors cursor-pointer min-h-[44px] md:min-h-0 flex items-center gap-1.5"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      <span>{item.item}</span>
                      {item.excludedBy && (
                        <span className="text-[10px] text-terracotta-500 font-normal opacity-75">
                          ({item.excludedBy})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          </div>
        </div>
      )}

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
  )
}
