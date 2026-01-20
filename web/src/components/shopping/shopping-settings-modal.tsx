"use client"

import { useState, useMemo, useCallback } from "react"
import { Plus, Trash2, GripVertical, RotateCcw, Settings, X, Pencil, Check } from "lucide-react"
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
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { CustomShoppingCategory, UserConfig } from "@/types/database"
import {
  getAllShoppingCategories,
  generateCategoryId,
  getNextCategoryOrder,
} from "@/lib/shopping-categories"
import { useUndoToast } from "@/hooks/use-undo-toast"

interface ShoppingSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: UserConfig | null
  onUpdateConfig: (updates: Partial<UserConfig>) => Promise<void>
  isUpdating: boolean
}

// Sortable category row
function SortableCategoryRow({
  category,
  isEditing,
  editName,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
  onDelete,
}: {
  category: { key: string; name: string; isCustom: boolean }
  isEditing: boolean
  editName: string
  onEditStart: () => void
  onEditChange: (name: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.key })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 py-2 px-3 rounded-lg border bg-card ${
        isDragging ? "shadow-lg" : ""
      }`}
    >
      <button
        type="button"
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1 flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {isEditing ? (
        <div className="flex items-center gap-2 flex-1">
          <Input
            value={editName}
            onChange={(e) => onEditChange(e.target.value)}
            className="h-8 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onEditSave()
              if (e.key === "Escape") onEditCancel()
            }}
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEditSave}>
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEditCancel}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm">{category.name}</span>
          {category.isCustom && (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={onEditStart}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Drag overlay for category
function CategoryDragOverlay({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 rounded-lg border bg-card shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm">{name}</span>
    </div>
  )
}

export function ShoppingSettingsModal({
  open,
  onOpenChange,
  config,
  onUpdateConfig,
  isUpdating,
}: ShoppingSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<string>("order")
  const [newCategoryName, setNewCategoryName] = useState("")
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const undoToast = useUndoToast()

  const customCategories = config?.custom_categories || []
  const categoryOrder = config?.category_order || null
  const categoryOverrides = config?.category_overrides || {}

  // Get all categories with current ordering
  const allCategories = useMemo(() => {
    let categories = getAllShoppingCategories(customCategories, categoryOrder)
    // Filter out pending delete
    if (pendingDelete) {
      categories = categories.filter((c) => c.key !== pendingDelete)
    }
    return categories
  }, [customCategories, categoryOrder, pendingDelete])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Add custom category
  const handleAddCategory = useCallback(async () => {
    const name = newCategoryName.trim()
    if (!name) return

    const newCategory: CustomShoppingCategory = {
      id: generateCategoryId(),
      name,
      order: getNextCategoryOrder(customCategories),
    }

    const updatedCategories = [...customCategories, newCategory]

    try {
      await onUpdateConfig({ custom_categories: updatedCategories })
      setNewCategoryName("")
    } catch (error) {
      console.error("Failed to add category:", error)
    }
  }, [newCategoryName, customCategories, onUpdateConfig])

  // Start editing category name
  const handleEditStart = useCallback((key: string, name: string) => {
    setEditingCategory(key)
    setEditName(name)
  }, [])

  // Save edited category name
  const handleEditSave = useCallback(async () => {
    if (!editingCategory || !editName.trim()) {
      setEditingCategory(null)
      return
    }

    const customId = editingCategory.replace("custom_", "")
    const updatedCategories = customCategories.map((c) =>
      c.id === customId ? { ...c, name: editName.trim() } : c
    )

    try {
      await onUpdateConfig({ custom_categories: updatedCategories })
      setEditingCategory(null)
      setEditName("")
    } catch (error) {
      console.error("Failed to update category:", error)
    }
  }, [editingCategory, editName, customCategories, onUpdateConfig])

  // Delete custom category with undo
  const handleDeleteCategory = useCallback((key: string) => {
    setPendingDelete(key)
    const customId = key.replace("custom_", "")
    const category = customCategories.find((c) => c.id === customId)

    undoToast.show({
      message: `"${category?.name}" deleted`,
      onUndo: () => {
        setPendingDelete(null)
      },
      onExpire: async () => {
        // Items in this category get moved to misc
        const updatedOverrides = { ...categoryOverrides }
        for (const [item, cat] of Object.entries(updatedOverrides)) {
          if (cat === key) {
            updatedOverrides[item] = "misc"
          }
        }

        const updatedCategories = customCategories.filter((c) => c.id !== customId)
        const updatedOrder = categoryOrder?.filter((k) => k !== key) || null

        try {
          await onUpdateConfig({
            custom_categories: updatedCategories,
            category_order: updatedOrder,
            category_overrides: updatedOverrides,
          })
        } catch (error) {
          console.error("Failed to delete category:", error)
        }
        setPendingDelete(null)
      },
    })
  }, [customCategories, categoryOrder, categoryOverrides, onUpdateConfig, undoToast])

  // Handle drag end for category reordering
  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveCategory(null)

      if (!over || active.id === over.id) return

      const oldIndex = allCategories.findIndex((c) => c.key === active.id)
      const newIndex = allCategories.findIndex((c) => c.key === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      // Create new order array
      const newCategories = [...allCategories]
      const [moved] = newCategories.splice(oldIndex, 1)
      newCategories.splice(newIndex, 0, moved)

      const newOrder = newCategories.map((c) => c.key)

      try {
        await onUpdateConfig({ category_order: newOrder })
      } catch (error) {
        console.error("Failed to reorder categories:", error)
      }
    },
    [allCategories, onUpdateConfig]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveCategory(event.active.id as string)
  }, [])

  // Reset category order to default
  const handleResetOrder = useCallback(async () => {
    try {
      await onUpdateConfig({ category_order: null })
    } catch (error) {
      console.error("Failed to reset order:", error)
    }
  }, [onUpdateConfig])

  // Reset a single category override
  const handleResetOverride = useCallback(
    async (item: string) => {
      const { [item]: removed, ...rest } = categoryOverrides
      try {
        await onUpdateConfig({ category_overrides: rest })
      } catch (error) {
        console.error("Failed to reset override:", error)
      }
    },
    [categoryOverrides, onUpdateConfig]
  )

  // Reset all category overrides
  const handleResetAllOverrides = useCallback(async () => {
    try {
      await onUpdateConfig({ category_overrides: {} })
    } catch (error) {
      console.error("Failed to reset overrides:", error)
    }
  }, [onUpdateConfig])

  // Get override display info
  const overrideEntries = useMemo(() => {
    return Object.entries(categoryOverrides).map(([item, catKey]) => {
      const category = allCategories.find((c) => c.key === catKey)
      return {
        item,
        categoryKey: catKey,
        categoryName: category?.name || catKey,
      }
    })
  }, [categoryOverrides, allCategories])

  const activeItem = activeCategory
    ? allCategories.find((c) => c.key === activeCategory)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Shopping List Settings
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="order">Order</TabsTrigger>
            <TabsTrigger value="custom">Custom</TabsTrigger>
            <TabsTrigger value="overrides">Overrides</TabsTrigger>
          </TabsList>

          {/* Category Order Tab */}
          <TabsContent value="order" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Drag to reorder categories to match your store layout.
            </p>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={allCategories.map((c) => c.key)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {allCategories.map((category) => (
                    <SortableCategoryRow
                      key={category.key}
                      category={category}
                      isEditing={editingCategory === category.key}
                      editName={editName}
                      onEditStart={() => handleEditStart(category.key, category.name)}
                      onEditChange={setEditName}
                      onEditSave={handleEditSave}
                      onEditCancel={() => setEditingCategory(null)}
                      onDelete={() => handleDeleteCategory(category.key)}
                    />
                  ))}
                </div>
              </SortableContext>

              <DragOverlay>
                {activeItem ? <CategoryDragOverlay name={activeItem.name} /> : null}
              </DragOverlay>
            </DndContext>

            {categoryOrder && categoryOrder.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetOrder}
                disabled={isUpdating}
                className="w-full"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Default Order
              </Button>
            )}
          </TabsContent>

          {/* Custom Categories Tab */}
          <TabsContent value="custom" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Create custom categories for specialty stores or personal organization.
            </p>

            <div className="flex gap-2">
              <Input
                placeholder="Category name..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1 text-base sm:text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory()
                }}
              />
              <Button
                onClick={handleAddCategory}
                disabled={isUpdating || !newCategoryName.trim()}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            {customCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No custom categories yet. Add one above!
              </p>
            ) : (
              <div className="space-y-2">
                {customCategories
                  .filter((c) => pendingDelete !== `custom_${c.id}`)
                  .map((category) => (
                    <div
                      key={category.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg border bg-card"
                    >
                      {editingCategory === `custom_${category.id}` ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleEditSave()
                              if (e.key === "Escape") setEditingCategory(null)
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleEditSave}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingCategory(null)}
                          >
                            <X className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm">{category.name}</span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() =>
                                handleEditStart(`custom_${category.id}`, category.name)
                              }
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteCategory(`custom_${category.id}`)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Tip: You can have up to 10 custom categories.
            </p>
          </TabsContent>

          {/* Category Overrides Tab */}
          <TabsContent value="overrides" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Items you&apos;ve manually assigned to different categories.
            </p>

            {overrideEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No category overrides yet. Drag items between categories in your shopping
                list to create overrides.
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  {overrideEntries.map(({ item, categoryName }) => (
                    <div
                      key={item}
                      className="flex items-center justify-between py-2 px-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item}</span>
                        <span className="text-xs text-muted-foreground">→</span>
                        <span className="text-sm text-muted-foreground">
                          {categoryName}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-muted-foreground hover:text-foreground"
                        onClick={() => handleResetOverride(item)}
                        disabled={isUpdating}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Reset
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetAllOverrides}
                  disabled={isUpdating}
                  className="w-full"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset All Overrides
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
