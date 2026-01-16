"use client"

import { useState, useMemo } from "react"
import { Plus, Trash2, Package, Ban, Check, Copy, GripVertical, X } from "lucide-react"
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
} from "@/hooks/use-shopping"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import type { ShoppingItem } from "@/types/database"
import { toFraction } from "@/lib/utils"

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
function SourceTag({ recipeName }: { recipeName: string }) {
  const isManual = recipeName === "Manual"
  
  if (isManual) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500 border border-gray-200">
        Manual
      </span>
    )
  }
  
  const colorIndex = getColorIndex(recipeName)
  const colors = RECIPE_COLORS[colorIndex]
  
  // Truncate long recipe names
  const displayName = recipeName.length > 20 ? recipeName.slice(0, 18) + "…" : recipeName
  
  return (
    <span 
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
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
  isRemoving 
}: { 
  recipeName: string
  onRemove: () => void
  isRemoving: boolean
}) {
  const colorIndex = getColorIndex(recipeName)
  const colors = RECIPE_COLORS[colorIndex]
  
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
        className={`p-0.5 rounded-full transition-colors hover:bg-black/10 disabled:opacity-50`}
        title={`Remove all items from ${recipeName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

// Sortable item component
function SortableShoppingItem({
  item,
  onCheckOff,
  onRemove,
  isCheckingOff,
  isRemoving,
}: {
  item: ShoppingItem
  onCheckOff: () => void
  onRemove: () => void
  isCheckingOff: boolean
  isRemoving: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.item })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between py-1.5 group"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1 flex-shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCheckOff}
          disabled={isCheckingOff}
          className="w-5 h-5 rounded border-2 border-sage-300 flex items-center justify-center transition-colors hover:border-sage-500 hover:bg-sage-100 flex-shrink-0"
        >
          <Check className="h-3 w-3 text-transparent hover:text-sage-500" />
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
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
                <SourceTag key={`${source.recipeName}-${idx}`} recipeName={source.recipeName} />
              ))}
            </div>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={onRemove}
        disabled={isRemoving}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  )
}

// Drag overlay item (shown while dragging)
function DragOverlayItem({ item }: { item: ShoppingItem }) {
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
              <SourceTag key={`${source.recipeName}-${idx}`} recipeName={source.recipeName} />
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

  const { data: shoppingList, isLoading } = useShoppingList()

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

  // Set up drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Group items by category
  const groupedItems = useMemo(() => {
    const items = shoppingList?.items || []
    return items.reduce(
      (acc, item) => {
        const category = item.categoryKey || "misc"
        if (!acc[category]) acc[category] = []
        acc[category].push(item)
        return acc
      },
      {} as Record<string, ShoppingItem[]>
    )
  }, [shoppingList?.items])

  // Create a flat list of all item IDs for the sortable context
  const allItemIds = useMemo(() => {
    return (shoppingList?.items || []).map((item) => item.item)
  }, [shoppingList?.items])

  // Get unique recipe names from all items (excluding "Manual")
  const uniqueRecipes = useMemo(() => {
    const items = shoppingList?.items || []
    const alreadyHave = shoppingList?.already_have || []
    const allItems = [...items, ...alreadyHave]
    
    const recipeSet = new Set<string>()
    for (const item of allItems) {
      if (item.sources) {
        for (const source of item.sources) {
          if (source.recipeName !== "Manual") {
            recipeSet.add(source.recipeName)
          }
        }
      }
    }
    return Array.from(recipeSet).sort()
  }, [shoppingList?.items, shoppingList?.already_have])

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

  const handleClearList = async () => {
    if (confirm("Clear the entire shopping list?")) {
      await clearList.mutateAsync()
    }
  }

  const handleCopyList = async () => {
    if (!shoppingList?.items?.length) return

    // Format the list as plain text grouped by category
    const lines: string[] = []
    
    Object.entries(SHOPPING_CATEGORIES)
      .sort(([, a], [, b]) => a.order - b.order)
      .forEach(([categoryKey, categoryData]) => {
        const items = (shoppingList.items || []).filter(
          (item) => (item.categoryKey || "misc") === categoryKey
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveItem(null)

    if (!over || active.id === over.id || !shoppingList?.items) return

    const items = shoppingList.items
    const activeIndex = items.findIndex((i) => i.item === active.id)
    const overIndex = items.findIndex((i) => i.item === over.id)

    if (activeIndex === -1 || overIndex === -1) return

    const activeItem = items[activeIndex]
    const overItem = items[overIndex]

    // Create new array with reordered items
    const newItems = [...items]
    newItems.splice(activeIndex, 1)
    newItems.splice(overIndex, 0, activeItem)

    // Check if the item is being moved to a different category
    const oldCategory = activeItem.categoryKey
    const newCategory = overItem.categoryKey

    if (oldCategory !== newCategory) {
      // Update the dragged item's category to match the drop target's category
      const updatedItem = {
        ...activeItem,
        categoryKey: newCategory,
        categoryOrder: SHOPPING_CATEGORIES[newCategory]?.order || 8,
      }
      newItems[overIndex] = updatedItem

      // Save category override for future shopping lists
      try {
        await saveCategoryOverride.mutateAsync({
          itemName: activeItem.item,
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
              className="flex-1"
            />
            <Button type="submit" disabled={addItem.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Recipe Sources */}
      {uniqueRecipes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Recipes in list:</p>
          <div className="flex flex-wrap gap-2">
            {uniqueRecipes.map((recipeName) => (
              <RecipeTag
                key={recipeName}
                recipeName={recipeName}
                onRemove={() => removeRecipeItems.mutate(recipeName)}
                isRemoving={removeRecipeItems.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shopping List */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : !shoppingList?.items?.length ? (
        <p className="text-center text-muted-foreground py-8">
          Shopping list is empty. Add items above to get started!
        </p>
      ) : (
        <div className="space-y-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={allItemIds}
              strategy={verticalListSortingStrategy}
            >
              {/* Main shopping items grouped by category */}
              {Object.entries(SHOPPING_CATEGORIES)
                .sort(([, a], [, b]) => a.order - b.order)
                .map(([categoryKey, categoryData]) => {
                  const items = groupedItems[categoryKey]
                  if (!items || items.length === 0) return null

                  return (
                    <Card key={categoryKey} className="animate-fade-in">
                      <CardHeader className="py-3 bg-sage-50 rounded-t-xl">
                        <CardTitle className="text-sm font-semibold text-sage-700 flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          {categoryData.name}
                          <span className="text-xs font-normal text-sage-500">({items.length})</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-3">
                        <ul className="space-y-1">
                          {items.map((item) => (
                            <SortableShoppingItem
                              key={item.item}
                              item={item}
                              onCheckOff={() => checkOffItem.mutate(item)}
                              onRemove={() => removeItem.mutate(item.item)}
                              isCheckingOff={checkOffItem.isPending}
                              isRemoving={removeItem.isPending}
                            />
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )
                })}
            </SortableContext>

            <DragOverlay>
              {activeItem ? <DragOverlayItem item={activeItem} /> : null}
            </DragOverlay>
          </DndContext>

          {/* Already Have Section */}
          {shoppingList.already_have && shoppingList.already_have.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="py-3 bg-sage-50 rounded-t-xl">
                <CardTitle className="text-sm font-semibold text-sage-700 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Already Have
                  <span className="text-xs font-normal text-sage-500">({shoppingList.already_have.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <p className="text-xs text-muted-foreground mb-2">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {shoppingList.already_have.map((item, index) => (
                    <button
                      key={item.item}
                      type="button"
                      onClick={() => moveToList.mutate(item)}
                      disabled={moveToList.isPending}
                      className="px-2.5 py-1 bg-sage-100 text-sage-700 rounded-full text-sm font-medium animate-fade-in hover:bg-sage-200 transition-colors cursor-pointer"
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
          {shoppingList.excluded && shoppingList.excluded.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="py-3 bg-terracotta-50 rounded-t-xl">
                <CardTitle className="text-sm font-semibold text-terracotta-700 flex items-center gap-2">
                  <Ban className="h-4 w-4" />
                  Excluded
                  <span className="text-xs font-normal text-terracotta-500">({shoppingList.excluded.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <p className="text-xs text-muted-foreground mb-2">Click to add back to list</p>
                <div className="flex flex-wrap gap-2">
                  {shoppingList.excluded.map((item, index) => (
                    <button
                      key={item.item}
                      type="button"
                      onClick={() => moveExcludedToList.mutate(item)}
                      disabled={moveExcludedToList.isPending}
                      className="px-2.5 py-1 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in hover:bg-terracotta-200 transition-colors cursor-pointer"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {item.item}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCopyList}
              className="flex-1"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={handleClearList}
              disabled={clearList.isPending}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
