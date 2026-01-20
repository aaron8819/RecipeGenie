"use client"

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react"
import { Plus, Trash2, Package, Ban, Check, Copy, GripVertical, X, Settings } from "lucide-react"
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
import {
  useShoppingList,
  useAddShoppingItem,
  useRemoveShoppingItem,
  useRemoveRecipeItems,
  useClearShoppingList,
  useCheckOffItem,
  useMoveToShoppingList,
  useMoveExcludedToShoppingList,
  useReorderShoppingList,
  useSaveCategoryOverride,
  useUpdateItemCategory,
  useShoppingConfig,
  useUpdateShoppingConfig,
} from "@/hooks/use-shopping"
import { SHOPPING_CATEGORIES, getAllShoppingCategories, getCategoryByKey } from "@/lib/shopping-categories"
import { ShoppingSettingsModal } from "./shopping-settings-modal"
import type { ShoppingItem } from "@/types/database"
import { toFraction } from "@/lib/utils"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { EmptyState } from "@/components/ui/empty-state"
import { ShoppingCart } from "lucide-react"

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

// Source tag component (for item rows)
function SourceTag({ 
  recipeName, 
  colorIndex 
}: { 
  recipeName: string
  colorIndex?: number 
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
  const displayName = recipeName.length > 20 ? recipeName.slice(0, 18) + "…" : recipeName
  
  return (
    <span 
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
      title={recipeName}
    >
      {displayName}
    </span>
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
  isCheckingOff,
  isRemoving,
  recipeColorMap,
  dragHandleProps,
  dragStyle,
  isDragging,
}: {
  item: ShoppingItem
  onCheckOff: () => void
  onRemove: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  recipeColorMap: Map<string, number>
  dragHandleProps?: any
  dragStyle?: React.CSSProperties
  isDragging?: boolean
}) {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchStartTime = useRef<number | null>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const SWIPE_THRESHOLD = 100 // Minimum swipe distance to reveal delete
  const DELETE_THRESHOLD = 150 // Distance to trigger delete
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

    // Trigger delete if swiped far enough or with enough velocity
    if (swipeOffset >= DELETE_THRESHOLD || (swipeOffset >= SWIPE_THRESHOLD && velocity > SWIPE_VELOCITY_THRESHOLD)) {
      onRemove()
      setSwipeOffset(0)
    } else if (swipeOffset >= SWIPE_THRESHOLD) {
      // Reveal delete button
      setSwipeOffset(100) // Slightly increased reveal distance
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
      {/* Delete button (revealed on swipe) */}
      <div
        className="absolute right-0 top-0 bottom-0 flex items-center bg-destructive px-4 transition-transform duration-200 ease-out md:hidden"
        style={{
          transform: `translateX(${swipeOffset > 0 ? 0 : 100}%)`,
          width: '80px',
          willChange: isSwiping ? 'transform' : 'auto',
        }}
      >
        <button
          type="button"
          onClick={handleDeleteClick}
          disabled={isRemoving}
          className="h-11 w-11 rounded-full bg-white/20 flex items-center justify-center text-white disabled:opacity-50"
          aria-label="Delete item"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Main item content */}
      <div
        className="flex items-center justify-between px-4 py-3.5 md:py-3 group transition-transform duration-200 ease-out swipeable-content hover:bg-sage-50/50"
        style={{
          transform: `translateX(-${swipeOffset}px)`,
          ...dragStyle,
          opacity: isDragging ? 0.5 : 1,
          willChange: isSwiping || isDragging ? 'transform' : 'auto',
        }}
      >
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
            className="w-6 h-6 md:w-5 md:h-5 rounded border-2 border-sage-300 flex items-center justify-center transition-all hover:border-sage-500 hover:bg-sage-100 active:bg-sage-200 active:scale-95 flex-shrink-0"
            aria-label="Check off item"
          >
            <Check className="h-4 w-4 md:h-3 md:w-3 text-transparent hover:text-sage-500 active:text-sage-600" />
          </button>
          
          <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {formatAmount(item) && (
                <span className="text-sm font-medium text-gray-700">
                  {formatAmount(item)}
                </span>
              )}
              <span className="text-sm text-gray-600">
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
        </div>
        
        {/* Desktop delete button */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={onRemove}
          disabled={isRemoving}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// Sortable item component - memoized for better scroll performance
const SortableShoppingItem = memo(function SortableShoppingItem({
  item,
  onCheckOff,
  onRemove,
  isCheckingOff,
  isRemoving,
  recipeColorMap,
}: {
  item: ShoppingItem
  onCheckOff: () => void
  onRemove: () => void
  isCheckingOff: boolean
  isRemoving: boolean
  recipeColorMap: Map<string, number>
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.item })

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
        isCheckingOff={isCheckingOff}
        isRemoving={isRemoving}
        recipeColorMap={recipeColorMap}
        dragHandleProps={{ ...attributes, ...listeners }}
        dragStyle={dragStyle}
        isDragging={isDragging}
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
    prevProps.isCheckingOff === nextProps.isCheckingOff &&
    prevProps.isRemoving === nextProps.isRemoving &&
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

export function ShoppingListView() {
  const [newItem, setNewItem] = useState("")
  const [activeItem, setActiveItem] = useState<ShoppingItem | null>(null)
  const [pendingItemDeletion, setPendingItemDeletion] = useState<string | null>(null)
  const [pendingRecipeDeletion, setPendingRecipeDeletion] = useState<string | null>(null)
  const [pendingClearList, setPendingClearList] = useState(false)
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { data: shoppingList, isLoading } = useShoppingList()
  const { data: config } = useShoppingConfig()
  const updateConfig = useUpdateShoppingConfig()

  const addItem = useAddShoppingItem()
  const removeItem = useRemoveShoppingItem()
  const removeRecipeItems = useRemoveRecipeItems()
  const clearList = useClearShoppingList()
  const checkOffItem = useCheckOffItem()
  const moveToList = useMoveToShoppingList()
  const moveExcludedToList = useMoveExcludedToShoppingList()
  const reorderList = useReorderShoppingList()
  const saveCategoryOverride = useSaveCategoryOverride()
  const updateItemCategory = useUpdateItemCategory()
  const undoToast = useUndoToast()

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

  // Filter items for pending deletions
  const filteredItems = useMemo(() => {
    if (pendingClearList) return []
    let items = shoppingList?.items || []

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
  }, [shoppingList?.items, pendingItemDeletion, pendingRecipeDeletion, pendingClearList])

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

  // Create a flat list of all item IDs for the sortable context
  const allItemIds = useMemo(() => {
    return filteredItems.map((item) => item.item)
  }, [filteredItems])

  // Get unique recipe names from all items (excluding "Manual" and pending deletions)
  const uniqueRecipes = useMemo(() => {
    if (pendingClearList) return []
    const items = shoppingList?.items || []
    const alreadyHave = shoppingList?.already_have || []
    const allItems = [...items, ...alreadyHave]

    const recipeSet = new Set<string>()
    for (const item of allItems) {
      if (item.sources) {
        for (const source of item.sources) {
          if (source.recipeName !== "Manual" && source.recipeName !== pendingRecipeDeletion) {
            recipeSet.add(source.recipeName)
          }
        }
      }
    }
    return Array.from(recipeSet).sort()
  }, [shoppingList?.items, shoppingList?.already_have, pendingRecipeDeletion, pendingClearList])

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
      for (const item of items) {
        try {
          await addItem.mutateAsync({ itemName: item })
        } catch (error) {
          // Skip duplicates or errors for individual items
          console.warn(`Skipped item "${item}":`, error)
        }
      }
      setNewItem("")
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
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const item = shoppingList?.items?.find((i) => i.item === active.id)
    if (item) {
      setActiveItem(item)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over || !shoppingList?.items) {
      setDragOverCategory(null)
      return
    }
    const overItem = shoppingList.items.find((i) => i.item === over.id)
    if (overItem) {
      setDragOverCategory(overItem.categoryKey || null)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveItem(null)
    setDragOverCategory(null)

    if (!over || active.id === over.id || !shoppingList?.items) return

    const items = shoppingList.items
    const activeIndex = items.findIndex((i) => i.item === active.id)
    const overIndex = items.findIndex((i) => i.item === over.id)

    if (activeIndex === -1 || overIndex === -1) return

    const draggedItem = items[activeIndex]
    const overItem = items[overIndex]

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
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No shopping list yet"
          description="Add items manually above, or generate a meal plan and add it to your shopping list."
        />
      ) : (
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
              {orderedCategories.map((categoryData) => {
                  const items = groupedItems[categoryData.key]
                  if (!items || items.length === 0) return null

                  // Check if this category is a valid drop target
                  const isDragTarget = activeItem &&
                    dragOverCategory === categoryData.key &&
                    activeItem.categoryKey !== categoryData.key

                  return (
                    <Card
                      key={categoryData.key}
                      className={`animate-fade-in transition-all duration-200 ${
                        isDragTarget ? 'border-2 border-dashed border-primary bg-primary/5' : ''
                      }`}
                    >
                      <CardHeader className="px-4 py-2.5 border-b border-sage-100 bg-transparent">
                        <CardTitle className="text-xs font-semibold text-sage-600 uppercase tracking-wide flex items-center gap-2">
                          <Package className="h-3.5 w-3.5" />
                          {categoryData.name}
                          {categoryData.isCustom && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded normal-case">Custom</span>
                          )}
                          <span className="text-xs font-normal text-sage-400 ml-auto">({items.length})</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ul className="divide-y divide-sage-50" style={{ contain: 'layout style paint' }}>
                          {items.map((item) => (
                            <SortableShoppingItem
                              key={item.item}
                              item={item}
                              onCheckOff={() => checkOffItem.mutate(item)}
                              onRemove={() => handleRemoveItem(item.item)}
                              isCheckingOff={checkOffItem.isPending}
                              isRemoving={false}
                              recipeColorMap={recipeColorMap}
                            />
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )
                })}
            </SortableContext>

            <DragOverlay>
              {activeItem ? <DragOverlayItem item={activeItem} recipeColorMap={recipeColorMap} /> : null}
            </DragOverlay>
          </DndContext>

          {/* Already Have Section */}
          {shoppingList?.already_have && shoppingList.already_have.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="px-4 py-2.5 border-b border-sage-100 bg-transparent">
                <CardTitle className="text-xs font-semibold text-sage-600 uppercase tracking-wide flex items-center gap-2">
                  <Package className="h-3.5 w-3.5" />
                  Already Have
                  <span className="text-xs font-normal text-sage-400 ml-auto">({shoppingList.already_have.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 px-4 pb-4">
                <p className="text-xs text-muted-foreground mb-2">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {shoppingList.already_have.map((item, index) => (
                    <button
                      key={item.item}
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
          {shoppingList?.excluded && shoppingList.excluded.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="px-4 py-2.5 border-b border-terracotta-100 bg-transparent">
                <CardTitle className="text-xs font-semibold text-terracotta-700 uppercase tracking-wide flex items-center gap-2">
                  <Ban className="h-3.5 w-3.5" />
                  Excluded
                  <span className="text-xs font-normal text-terracotta-500 ml-auto">({shoppingList.excluded.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3 px-4 pb-4">
                <p className="text-xs text-muted-foreground mb-2">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {shoppingList.excluded.map((item, index) => (
                    <button
                      key={item.item}
                      type="button"
                      onClick={() => moveExcludedToList.mutate(item)}
                      disabled={moveExcludedToList.isPending}
                      className="px-3 py-2 md:px-2.5 md:py-1 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in hover:bg-terracotta-200 active:bg-terracotta-300 transition-colors cursor-pointer min-h-[44px] md:min-h-0"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {item.item}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
    </div>
  )
}
