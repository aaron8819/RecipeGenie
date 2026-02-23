"use client"

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { Plus, Trash2, Package, Ban, Check, CheckCheck, Copy, GripVertical, X, Settings, Loader2, ChevronDown, ChevronUp, Leaf, Sparkles, MoreVertical } from "lucide-react"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { ShoppingItem, ShoppingList, Recipe } from "@/types/database"
import { toFraction, cn } from "@/lib/utils"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"
import { mergeAmounts, roundForDisplay } from "@/lib/unit-conversion"
import { reorderByFilteredIndices } from "@/lib/shopping-reorder"
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
  onClick,
  className,
}: {
  recipeName: string
  recipeId?: string
  colorIndex?: number
  onClick?: () => void
  className?: string
}) {
  const isManual = recipeName === "Manual"

  if (isManual) {
    return (
      <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 border border-gray-200", className)}>
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
      className={cn(baseClasses, clickableClasses, className)}
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
          className={cn(baseClasses, "cursor-pointer", className)}
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

// Recipe tag with remove button (for header "Recipes in list" section). Optional onClick to view recipe.
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
  const index = colorIndex !== undefined ? colorIndex : getColorIndex(recipeName)
  const colors = RECIPE_COLORS[index % RECIPE_COLORS.length]
  
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
      {/* Swipe strip removed: mobile uses more_vert (shoppinglist_mobile_redesign) */}
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

      {/* Main item content — mobile: items-start, px-4, two-line; md: items-center, px-6 (shoppinglist_mobile_redesign) */}
      <div
        className={`flex items-start md:items-center justify-between px-4 py-4 md:px-6 group transition-transform duration-200 ease-out swipeable-content hover:bg-stone-50 ${showSwipeHint ? 'animate-swipe-hint' : ''}`}
        style={{
          transform: showSwipeHint ? undefined : `translateX(-${swipeOffset}px)`,
          ...dragStyle,
          opacity: isDragging ? 0.5 : 1,
          willChange: isSwiping || isDragging ? 'transform' : 'auto',
        }}
      >
        {/* Swipe hint tooltip */}
        {showSwipeHint && (
          <div className={cn("absolute -top-8 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs px-2 py-1 rounded whitespace-nowrap z-10", isDesktop && "hidden")}>
            Swipe left to delete
          </div>
        )}
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Drag handle — visible on all breakpoints; long-press on mobile to drag (TouchSensor delay) */}
          <button
            type="button"
            data-drag-handle="true"
            className="flex touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1 flex-shrink-0 min-w-[36px] min-h-[36px] md:min-w-0 md:min-h-0 md:p-1 items-center justify-center"
            style={{ touchAction: 'none' }}
            aria-label="Drag to reorder"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4 md:h-4 md:w-4" />
          </button>
          
          {/* Checkbox — min 44px touch target on mobile for WCAG compliance */}
          <button
            type="button"
            data-checkbox="true"
            onClick={onCheckOff}
            disabled={isCheckingOff}
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center flex-shrink-0 -my-2 md:my-0"
            aria-label={isChecked ? "Uncheck item" : "Check off item"}
          >
            <span className={`w-6 h-6 md:w-5 md:h-5 rounded border-2 flex items-center justify-center transition-all active:scale-95 ${
              isChecked
                ? "border-sage-500 bg-sage-500 text-white"
                : "border-sage-300 hover:border-sage-500 hover:bg-sage-100 active:bg-sage-200"
            }`}>
              {isChecked && <Check className="h-4 w-4 md:h-3 md:w-3" />}
            </span>
          </button>
          
          {/* Inline: amount, name, and source tags on one line (wraps together), same on mobile and desktop */}
          <div className={`flex-1 min-w-0 flex flex-wrap items-center gap-1.5 md:gap-2 ${isChecked ? "opacity-60" : ""}`}>
            {formatAmount(item) && (
              <span className={`font-bold text-foreground shrink-0 ${isChecked ? "text-gray-500 line-through" : ""}`}>
                {formatAmount(item)}
              </span>
            )}
            <span className={`min-w-0 truncate font-medium text-slate-700 md:text-slate-600 ${isChecked ? "text-gray-500 line-through" : ""}`}>
              {item.item}
            </span>
            {uniqueSources.map((source, idx) => (
              <SourceTag
                key={`${source.recipeName}-${idx}`}
                recipeName={source.recipeName}
                colorIndex={recipeColorMap.get(source.recipeName)}
                className="text-[9px] px-1.5 py-0.5 md:text-[10px] md:px-2 md:py-0.5 shrink-0"
              />
            ))}
          </div>
        </div>
        
        {/* Mobile: more_vert menu (shoppinglist_mobile_redesign) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn("p-1 text-slate-400 hover:text-foreground", isDesktop && "hidden")}
              aria-label="Item actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onAddToPantry} disabled={isAddingToPantry}>
              <Package className="h-4 w-4 mr-2" />
              Add to pantry
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRemove} disabled={isRemoving} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Remove from list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
        {/* Desktop action buttons */}
        <div className={cn("items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity", isDesktop ? "flex" : "hidden")}>
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
  itemIdx: number
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
  } = useSortable({ id: `idx-${itemIdx}` })

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
  const [pendingItemDeletion, setPendingItemDeletion] = useState<string | null>(null)
  const [pendingRecipeDeletion, setPendingRecipeDeletion] = useState<string | null>(null)
  const [pendingClearList, setPendingClearList] = useState(false)
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

  // Handle adding item to pantry with per-item pending tracking
  const handleAddToPantry = useCallback((item: ShoppingItem) => {
    const itemKey = item.item.toLowerCase().trim()

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
    const itemKey = item.item.toLowerCase().trim()

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
  const displayShoppingList = shoppingList || {
    user_id: "",
    items: [],
    already_have: [],
    excluded: [],
    source_recipes: [],
    scale: 1.0,
    total_servings: 0,
    custom_order: false,
    generated_at: new Date().toISOString(),
  } as ShoppingList
  
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

  // Create a color mapping that assigns a unique color per recipe when possible.
  // Prefer hash-based index for stability; on collision use next available index.
  // If there are more recipes than colors, later recipes may reuse colors.
  const recipeColorMap = useMemo(() => {
    const map = new Map<string, number>()
    const usedIndices = new Set<number>()
    for (const recipeName of uniqueRecipes) {
      let idx = getColorIndex(recipeName)
      if (usedIndices.size < RECIPE_COLORS.length) {
        while (usedIndices.has(idx)) {
          idx = (idx + 1) % RECIPE_COLORS.length
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

    const items = shoppingList.items
    const reorderResult = reorderByFilteredIndices(items, filteredItems, activeIndex, overIndex)
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
      ) : filteredItems.length === 0 ? (
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
              <Card className="mb-4 animate-fade-in border border-stone-100 rounded-xl overflow-hidden shadow-sm">
                {/* Mobile: Collapsible header */}
                <CardHeader
                  role="button"
                  tabIndex={0}
                  className={cn("px-4 py-3 bg-stone-50/50 border-b border-stone-100 flex flex-row items-center justify-between cursor-pointer hover:bg-stone-100/50 transition-colors", isDesktop && "hidden")}
                  onClick={toggleRecipeSection}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleRecipeSection()
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    <CardTitle className="font-display text-sm font-semibold text-foreground uppercase tracking-wide">
                      Recipes in list
                    </CardTitle>
                    <span className="text-[10px] font-medium px-2 py-0.5 bg-accent-green/20 text-primary rounded-full uppercase tracking-tighter">
                      {uniqueRecipes.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleRecipeSection()
                    }}
                    className="p-1.5 text-stone-400 hover:text-primary rounded-lg transition-colors"
                    aria-label={recipeSectionCollapsed ? "Expand recipes list" : "Collapse recipes list"}
                  >
                    {recipeSectionCollapsed ? (
                      <ChevronDown className="h-5 w-5" />
                    ) : (
                      <ChevronUp className="h-5 w-5" />
                    )}
                  </button>
                </CardHeader>

                {/* Desktop: Static header (no collapse) */}
                <CardHeader className={cn("px-4 md:px-6 py-3 md:py-4 bg-stone-50/50 border-b border-stone-100 flex", !isDesktop && "hidden")}>
                  <div className="flex items-center gap-2 md:gap-3">
                    <CardTitle className="font-display text-sm md:text-lg font-semibold text-foreground uppercase tracking-wide">
                      Recipes in list
                    </CardTitle>
                    <span className="text-[10px] font-medium px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full">
                      {uniqueRecipes.length}
                    </span>
                  </div>
                </CardHeader>

                {/* Mobile: Conditional content */}
                {!recipeSectionCollapsed && (
                  <CardContent className={cn("p-4", isDesktop && "hidden")}>
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
                  </CardContent>
                )}

                {/* Desktop: Always visible content */}
                <CardContent className={cn("p-4 md:p-6", !isDesktop && "hidden")}>
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
                </CardContent>
              </Card>
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

                  const CategoryIcon = categoryData.key === "produce" ? Leaf : Package
                  return (
                    <Card
                      key={categoryData.key}
                      className={`animate-fade-in transition-all duration-200 bg-white border border-stone-100 rounded-xl overflow-hidden shadow-sm ${
                        isDragTarget ? 'border-2 border-dashed border-primary bg-primary/5' : ''
                      }`}
                    >
                      <CardHeader 
                        className="px-4 py-3 md:px-6 md:py-4 bg-stone-50/50 border-b border-stone-100 flex flex-row items-center justify-between cursor-pointer hover:bg-stone-100/50 transition-colors"
                        onClick={() => toggleCategory(categoryData.key)}
                      >
                        <div className="flex items-center gap-2 md:gap-3 min-w-0">
                          <CategoryIcon className="h-5 w-5 text-primary shrink-0" />
                          <CardTitle className="min-w-0 truncate font-display text-sm md:text-lg font-semibold text-foreground uppercase tracking-wide">
                            {categoryData.name}
                          </CardTitle>
                          {categoryData.isCustom && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded normal-case">Custom</span>
                          )}
                          <span className="text-[10px] font-medium px-2 py-0.5 bg-accent-green/20 text-primary rounded-full uppercase tracking-tighter">{checkedCount}/{items.length}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {items.length > 1 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleBulkCheckOff(items, categoryData.name)
                                }}
                                disabled={bulkCheckOff.isPending}
                                className="flex h-8 min-w-[36px] md:h-6 md:min-w-0 px-2 text-[10px] text-primary hover:bg-primary/10 touch-manipulation"
                                title={`Check all items in ${categoryData.name}`}
                                aria-label={`Check all items in ${categoryData.name}`}
                              >
                                <CheckCheck className="h-4 w-4 md:h-3 md:w-3 mr-1 shrink-0" />
                                <span>All</span>
                              </Button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleCategory(categoryData.key)
                              }}
                              className="p-1.5 text-stone-400 hover:text-primary rounded-lg transition-colors"
                              aria-label={isCollapsed ? "Expand category" : "Collapse category"}
                            >
                              {isCollapsed ? (
                                <ChevronDown className="h-5 w-5" />
                              ) : (
                                <ChevronUp className="h-5 w-5" />
                              )}
                            </button>
                        </div>
                      </CardHeader>
                      {!isCollapsed && (
                        <CardContent className="p-0">
                          <ul className="divide-y divide-stone-100" style={{ contain: 'layout style paint' }}>
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
                                isDesktop={isDesktop}
                                onCheckOff={() => handleCheckOff(item)}
                                onRemove={() => handleRemoveItem(item.item)}
                                onAddToPantry={() => handleAddToPantry(item)}
                                isCheckingOff={pendingCheckItems.has(item.item.toLowerCase().trim())}
                                isRemoving={false}
                                isAddingToPantry={pendingPantryItems.has(item.item.toLowerCase().trim())}
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
            <Card className="mb-4 animate-fade-in border border-stone-100 rounded-xl overflow-hidden shadow-sm">
              {/* Mobile: Collapsible header */}
              <CardHeader
                role="button"
                tabIndex={0}
                className={cn("px-4 py-3 bg-stone-50/50 border-b border-stone-100 flex flex-row items-center justify-between cursor-pointer hover:bg-stone-100/50 transition-colors", isDesktop && "hidden")}
                onClick={togglePantrySection}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    togglePantrySection()
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-primary" />
                  <CardTitle className="font-display text-sm font-semibold text-foreground uppercase tracking-wide">
                    In Pantry
                  </CardTitle>
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-accent-green/20 text-primary rounded-full uppercase tracking-tighter">
                    {mergedAlreadyHave.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePantrySection()
                  }}
                  className="p-1.5 text-stone-400 hover:text-primary rounded-lg transition-colors"
                  aria-label={pantryCollapsed ? "Expand pantry items" : "Collapse pantry items"}
                >
                  {pantryCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
              </CardHeader>

              {/* Desktop: Static header (no collapse) */}
              <CardHeader className={cn("px-4 md:px-6 py-3 md:py-4 bg-stone-50/50 border-b border-stone-100 flex", !isDesktop && "hidden")}>
                <div className="flex items-center gap-2 md:gap-3">
                  <Package className="h-5 w-5 text-primary" />
                  <CardTitle className="font-display text-sm md:text-lg font-semibold text-foreground uppercase tracking-wide">
                    In Pantry
                  </CardTitle>
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full">
                    {mergedAlreadyHave.length}
                  </span>
                </div>
              </CardHeader>

              {/* Mobile: Conditional content */}
              {!pantryCollapsed && (
                <CardContent className={cn("p-4", isDesktop && "hidden")}>
                  <p className="text-xs text-muted-foreground mb-3">Click to add back to list</p>
                  <div className="flex flex-wrap gap-2">
                    {mergedAlreadyHave.map((item, index) => (
                      <button
                        key={`already-have-${item.item}-${item.unit || ''}-${index}`}
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
                </CardContent>
              )}

              {/* Desktop: Always visible content */}
              <CardContent className={cn("p-4 md:p-6", !isDesktop && "hidden")}>
                <p className="text-xs text-muted-foreground mb-4">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {mergedAlreadyHave.map((item, index) => (
                    <button
                      key={`already-have-${item.item}-${item.unit || ''}-${index}`}
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
              </CardContent>
            </Card>
          )}

          {/* Excluded — Collapsible on mobile, always expanded on desktop */}
          {displayShoppingList?.excluded && displayShoppingList.excluded.length > 0 && (
            <Card className="mb-4 animate-fade-in border border-stone-100 rounded-xl overflow-hidden shadow-sm">
              {/* Mobile: Collapsible header */}
              <CardHeader
                role="button"
                tabIndex={0}
                className={cn("px-4 py-3 bg-stone-50/50 border-b border-stone-100 flex flex-row items-center justify-between cursor-pointer hover:bg-stone-100/50 transition-colors", isDesktop && "hidden")}
                onClick={toggleExcludedSection}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleExcludedSection()
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <Ban className="h-5 w-5 text-red-500" />
                  <CardTitle className="font-display text-sm font-semibold text-foreground uppercase tracking-wide">
                    Excluded
                  </CardTitle>
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full uppercase tracking-tighter">
                    {displayShoppingList.excluded.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleExcludedSection()
                  }}
                  className="p-1.5 text-stone-400 hover:text-primary rounded-lg transition-colors"
                  aria-label={excludedCollapsed ? "Expand excluded items" : "Collapse excluded items"}
                >
                  {excludedCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
              </CardHeader>

              {/* Desktop: Static header (no collapse) */}
              <CardHeader className={cn("px-4 md:px-6 py-3 md:py-4 bg-stone-50/50 border-b border-stone-100 flex", !isDesktop && "hidden")}>
                <div className="flex items-center gap-2 md:gap-3">
                  <Ban className="h-5 w-5 text-red-500" />
                  <CardTitle className="font-display text-sm md:text-lg font-semibold text-foreground uppercase tracking-wide">
                    Excluded
                  </CardTitle>
                  <span className="text-[10px] font-medium px-2 py-0.5 bg-stone-100 text-stone-500 rounded-full">
                    {displayShoppingList.excluded.length}
                  </span>
                </div>
              </CardHeader>

              {/* Mobile: Conditional content */}
              {!excludedCollapsed && (
                <CardContent className={cn("p-4", isDesktop && "hidden")}>
                  <p className="text-xs text-muted-foreground mb-3">Items excluded by keywords. Click to add back to list.</p>
                  <div className="flex flex-wrap gap-2">
                    {displayShoppingList.excluded.map((item, index) => (
                      <button
                        key={`excluded-${item.item}-${item.unit || ''}-${index}`}
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
                </CardContent>
              )}

              {/* Desktop: Always visible content */}
              <CardContent className={cn("p-4 md:p-6", !isDesktop && "hidden")}>
                <p className="text-xs text-muted-foreground mb-4">Items excluded by keywords. Click to add back to list.</p>
                <div className="flex flex-wrap gap-2">
                  {displayShoppingList.excluded.map((item, index) => (
                    <button
                      key={`excluded-${item.item}-${item.unit || ''}-${index}`}
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
              </CardContent>
            </Card>
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
