"use client"

import { useState, useMemo, useCallback } from "react"
import { Plus, Trash2, GripVertical, RotateCcw, Settings, X, Pencil, Check, AlertTriangle, Merge } from "lucide-react"
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
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useUpdateCategories, useBulkUpdateRecipeCategories, useRecipes, useAllTags, useTagsWithCounts, useRenameTag, useMergeTags, useDeleteTag } from "@/hooks/use-recipes"
import { useUserConfig, useUpdateUserConfig } from "@/hooks/use-planner"
import { getDefaultConfig } from "@/lib/guest-storage"
import { useAuthContext } from "@/lib/auth-context"
import { getTagClassName } from "@/lib/tag-colors"
import { cn } from "@/lib/utils"

interface RecipeSettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  recipeCount,
}: {
  category: string
  isEditing: boolean
  editName: string
  onEditStart: () => void
  onEditChange: (name: string) => void
  onEditSave: () => void
  onEditCancel: () => void
  onDelete: () => void
  recipeCount: number
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category })

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
          <span className="flex-1 text-sm capitalize">{category}</span>
          {recipeCount > 0 && (
            <span className="text-xs text-muted-foreground">({recipeCount} recipe{recipeCount !== 1 ? "s" : ""})</span>
          )}
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
              disabled={recipeCount > 0}
              title={recipeCount > 0 ? "Cannot delete category with recipes. Reassign recipes first." : "Delete category"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
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
      <span className="flex-1 text-sm capitalize">{name}</span>
    </div>
  )
}

export function RecipeSettingsModal({
  open,
  onOpenChange,
}: RecipeSettingsModalProps) {
  const { isGuest } = useAuthContext()
  const { data: config, isLoading: configLoading } = useUserConfig()
  const updateCategories = useUpdateCategories()
  const bulkUpdate = useBulkUpdateRecipeCategories()
  const updateConfig = useUpdateUserConfig()

  // Category state
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editCategoryName, setEditCategoryName] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [showReassignDialog, setShowReassignDialog] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null)
  const [targetCategory, setTargetCategory] = useState("")

  // Tag state
  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()
  const renameTag = useRenameTag()
  const mergeTags = useMergeTags()
  const deleteTag = useDeleteTag()
  const [editingTag, setEditingTag] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState("")
  const [showRenameDialog, setShowRenameDialog] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [tagToManage, setTagToManage] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState("")
  const [mergeSources, setMergeSources] = useState<string[]>([])

  // Get current categories
  const categories = useMemo(() => {
    if (isGuest) {
      const guestConfig = getDefaultConfig()
      return guestConfig.categories || []
    }
    if (configLoading) {
      return []
    }
    return (config?.categories as string[]) || []
  }, [config?.categories, isGuest, configLoading])

  // Get all recipes to count by category
  const { data: allRecipes } = useRecipes({})

  // Get recipe counts for each category
  const categoryRecipeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    categories.forEach((cat) => {
      counts.set(cat, 0)
    })
    if (allRecipes) {
      allRecipes.forEach((recipe) => {
        const current = counts.get(recipe.category) || 0
        counts.set(recipe.category, current + 1)
      })
    }
    return counts
  }, [categories, allRecipes])

  // Create a map of tag to count for quick lookup
  const tagCountMap = useMemo(() => {
    const map = new Map<string, number>()
    tagCounts.forEach(({ tag, count }) => map.set(tag, count))
    return map
  }, [tagCounts])

  // Get all categories for reassignment dialog
  const availableCategoriesForReassign = useMemo(() => {
    const uniqueCategories = new Set<string>()
    // Include all categories from config except the one being deleted
    categories.forEach((cat) => {
      if (cat !== categoryToDelete) {
        uniqueCategories.add(cat)
      }
    })
    return Array.from(uniqueCategories).sort()
  }, [categories, categoryToDelete])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Category handlers
  const handleAddCategory = useCallback(async () => {
    const name = newCategoryName.trim()
    if (!name) return

    // Check for duplicates (case-insensitive)
    const lowerName = name.toLowerCase()
    if (categories.some((c) => c.toLowerCase() === lowerName)) {
      alert("A category with this name already exists")
      return
    }

    const updatedCategories = [...categories, name]

    try {
      await updateCategories.mutateAsync(updatedCategories)
      setNewCategoryName("")
    } catch (error) {
      console.error("Failed to add category:", error)
      alert(error instanceof Error ? error.message : "Failed to add category")
    }
  }, [newCategoryName, categories, updateCategories])

  const handleEditStart = useCallback((category: string) => {
    setEditingCategory(category)
    setEditCategoryName(category)
  }, [])

  const handleEditSave = useCallback(async () => {
    if (!editingCategory || !editCategoryName.trim()) {
      setEditingCategory(null)
      return
    }

    const newName = editCategoryName.trim()

    // Check for duplicates (case-insensitive, excluding current)
    const lowerName = newName.toLowerCase()
    if (categories.some((c) => c !== editingCategory && c.toLowerCase() === lowerName)) {
      alert("A category with this name already exists")
      return
    }

    // If name changed, update all recipes with the old category name
    if (newName !== editingCategory) {
      try {
        await bulkUpdate.mutateAsync({
          oldCategory: editingCategory,
          newCategory: newName,
        })
      } catch (error) {
        console.error("Failed to update recipes:", error)
        alert("Failed to update recipes with new category name")
        return
      }

      // Update default_selection if it exists and has the old category
      if (config?.default_selection && typeof config.default_selection === 'object') {
        const defaultSelection = config.default_selection as Record<string, number>
        if (defaultSelection[editingCategory] !== undefined) {
          const updatedDefaultSelection = { ...defaultSelection }
          updatedDefaultSelection[newName] = updatedDefaultSelection[editingCategory]
          delete updatedDefaultSelection[editingCategory]
          
          try {
            await updateConfig.mutateAsync({ default_selection: updatedDefaultSelection })
          } catch (error) {
            console.error("Failed to update default_selection:", error)
            // Don't fail the whole operation, just log the error
          }
        }
      }
    }

    // Update category list
    const updatedCategories = categories.map((c) => (c === editingCategory ? newName : c))

    try {
      await updateCategories.mutateAsync(updatedCategories)
      setEditingCategory(null)
      setEditCategoryName("")
    } catch (error) {
      console.error("Failed to update category:", error)
      alert(error instanceof Error ? error.message : "Failed to update category")
    }
  }, [editingCategory, editCategoryName, categories, updateCategories, bulkUpdate, config?.default_selection, updateConfig])

  const handleDeleteCategory = useCallback(
    async (category: string) => {
      const recipeCount = categoryRecipeCounts.get(category) || 0

      if (recipeCount > 0) {
        // Show reassignment dialog
        setCategoryToDelete(category)
        setTargetCategory("")
        setShowReassignDialog(true)
        return
      }

      // No recipes, safe to delete
      const updatedCategories = categories.filter((c) => c !== category)

      // Update default_selection to remove the deleted category
      let updatedDefaultSelection = config?.default_selection
      if (config?.default_selection && typeof config.default_selection === 'object') {
        const defaultSelection = config.default_selection as Record<string, number>
        if (defaultSelection[category] !== undefined) {
          updatedDefaultSelection = { ...defaultSelection }
          delete updatedDefaultSelection[category]
        }
      }

      try {
        await updateCategories.mutateAsync(updatedCategories)
        // Update default_selection if it was modified
        if (updatedDefaultSelection !== config?.default_selection) {
          await updateConfig.mutateAsync({ default_selection: updatedDefaultSelection })
        }
      } catch (error) {
        console.error("Failed to delete category:", error)
        alert(error instanceof Error ? error.message : "Failed to delete category")
      }
    },
    [categories, categoryRecipeCounts, updateCategories, config?.default_selection, updateConfig]
  )

  const handleReassignAndDelete = useCallback(async () => {
    if (!categoryToDelete || !targetCategory) return

    try {
      // Reassign recipes
      await bulkUpdate.mutateAsync({
        oldCategory: categoryToDelete,
        newCategory: targetCategory,
      })

      // Delete category
      const updatedCategories = categories.filter((c) => c !== categoryToDelete)
      
      // Update default_selection: remove deleted category, merge its count into target if both exist
      let updatedDefaultSelection = config?.default_selection
      if (config?.default_selection && typeof config.default_selection === 'object') {
        const defaultSelection = config.default_selection as Record<string, number>
        const deletedCount = defaultSelection[categoryToDelete] || 0
        const targetCount = defaultSelection[targetCategory] || 0
        
        if (deletedCount > 0 || defaultSelection[categoryToDelete] !== undefined) {
          updatedDefaultSelection = { ...defaultSelection }
          delete updatedDefaultSelection[categoryToDelete]
          // If target category already has a count, keep the higher value (don't add them)
          // If target doesn't have a count, use the deleted category's count
          if (targetCount === 0 && deletedCount > 0) {
            updatedDefaultSelection[targetCategory] = deletedCount
          }
        }
      }

      await updateCategories.mutateAsync(updatedCategories)
      
      // Update default_selection if it was modified
      if (updatedDefaultSelection !== config?.default_selection) {
        await updateConfig.mutateAsync({ default_selection: updatedDefaultSelection })
      }

      setShowReassignDialog(false)
      setCategoryToDelete(null)
      setTargetCategory("")
    } catch (error) {
      console.error("Failed to reassign and delete:", error)
      alert("Failed to reassign recipes and delete category")
    }
  }, [categoryToDelete, targetCategory, categories, bulkUpdate, updateCategories, config?.default_selection, updateConfig])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      setActiveCategory(null)

      if (!over || active.id === over.id) return

      const oldIndex = categories.indexOf(active.id as string)
      const newIndex = categories.indexOf(over.id as string)

      if (oldIndex === -1 || newIndex === -1) return

      // Create new order array
      const newCategories = [...categories]
      const [moved] = newCategories.splice(oldIndex, 1)
      newCategories.splice(newIndex, 0, moved)

      try {
        await updateCategories.mutateAsync(newCategories)
      } catch (error) {
        console.error("Failed to reorder categories:", error)
      }
    },
    [categories, updateCategories]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveCategory(event.active.id as string)
  }, [])

  const handleResetToDefaults = useCallback(async () => {
    const defaultCategories = ["chicken", "beef", "turkey", "lamb", "vegetarian"]
    try {
      await updateCategories.mutateAsync(defaultCategories)
    } catch (error) {
      console.error("Failed to reset categories:", error)
    }
  }, [updateCategories])

  // Tag handlers
  const handleStartRename = (tag: string) => {
    setTagToManage(tag)
    setEditTagName(tag)
    setShowRenameDialog(true)
  }

  const handleConfirmRename = async () => {
    if (!tagToManage || !editTagName.trim() || editTagName.trim() === tagToManage) {
      setShowRenameDialog(false)
      setTagToManage(null)
      setEditTagName("")
      return
    }

    try {
      await renameTag.mutateAsync({
        oldTag: tagToManage,
        newTag: editTagName.trim(),
      })
      setShowRenameDialog(false)
      setTagToManage(null)
      setEditTagName("")
    } catch (error) {
      console.error("Failed to rename tag:", error)
      alert(error instanceof Error ? error.message : "Failed to rename tag")
    }
  }

  const handleStartMerge = (tag: string) => {
    setTagToManage(tag)
    setMergeSources([tag])
    setMergeTarget("")
    setShowMergeDialog(true)
  }

  const handleAddMergeSource = (tag: string) => {
    if (!mergeSources.includes(tag)) {
      setMergeSources([...mergeSources, tag])
    }
  }

  const handleRemoveMergeSource = (tag: string) => {
    setMergeSources(mergeSources.filter((t) => t !== tag))
  }

  const handleConfirmMerge = async () => {
    if (!mergeTarget || mergeSources.length === 0) {
      setShowMergeDialog(false)
      setTagToManage(null)
      setMergeSources([])
      setMergeTarget("")
      return
    }

    // Don't allow merging if target is in sources
    if (mergeSources.includes(mergeTarget)) {
      alert("Target tag cannot be one of the source tags")
      return
    }

    try {
      await mergeTags.mutateAsync({
        sourceTags: mergeSources,
        targetTag: mergeTarget,
      })
      setShowMergeDialog(false)
      setTagToManage(null)
      setMergeSources([])
      setMergeTarget("")
    } catch (error) {
      console.error("Failed to merge tags:", error)
      alert(error instanceof Error ? error.message : "Failed to merge tags")
    }
  }

  const handleStartDelete = (tag: string) => {
    setTagToManage(tag)
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = async () => {
    if (!tagToManage) return

    try {
      await deleteTag.mutateAsync(tagToManage)
      setShowDeleteDialog(false)
      setTagToManage(null)
    } catch (error) {
      console.error("Failed to delete tag:", error)
      alert(error instanceof Error ? error.message : "Failed to delete tag")
    }
  }

  const activeItem = activeCategory ? categories.find((c) => c === activeCategory) : null
  const recipeCount = categoryToDelete ? categoryRecipeCounts.get(categoryToDelete) || 0 : 0
  const isLoading = renameTag.isPending || mergeTags.isPending || deleteTag.isPending

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Recipe Settings
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="categories" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="tags">Tags</TabsTrigger>
            </TabsList>

            <TabsContent value="categories" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Customize your recipe categories. Drag to reorder, edit names, or add new categories.
              </p>

              {/* Add new category */}
              <div className="flex gap-2">
                <Input
                  placeholder="Category name..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddCategory()
                  }}
                />
                <Button
                  onClick={handleAddCategory}
                  disabled={updateCategories.isPending || !newCategoryName.trim()}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {/* Category list with drag and drop */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={categories} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {categories.map((category) => {
                      const recipeCount = categoryRecipeCounts.get(category) || 0
                      return (
                        <SortableCategoryRow
                          key={category}
                          category={category}
                          isEditing={editingCategory === category}
                          editName={editCategoryName}
                          onEditStart={() => handleEditStart(category)}
                          onEditChange={setEditCategoryName}
                          onEditSave={handleEditSave}
                          onEditCancel={() => {
                            setEditingCategory(null)
                            setEditCategoryName("")
                          }}
                          onDelete={() => handleDeleteCategory(category)}
                          recipeCount={recipeCount}
                        />
                      )
                    })}
                  </div>
                </SortableContext>

                <DragOverlay>
                  {activeItem ? <CategoryDragOverlay name={activeItem} /> : null}
                </DragOverlay>
              </DndContext>

              {/* Reset to defaults */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetToDefaults}
                disabled={updateCategories.isPending}
                className="w-full"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset to Default Categories
              </Button>

              {/* Warning about categories with recipes */}
              {Array.from(categoryRecipeCounts.entries()).some(([_, count]) => count > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Note
                  </div>
                  <p className="text-xs text-amber-700">
                    Categories with recipes cannot be deleted. Reassign recipes to another category first.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="tags" className="space-y-4 mt-4">
              {allTags.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No tags yet. Add tags to recipes to manage them here.
                </div>
              ) : (
                <div className="space-y-2">
                  {allTags.map((tag) => {
                    const count = tagCountMap.get(tag) || 0
                    const tagColors = getTagClassName(tag, false)
                    return (
                      <div
                        key={tag}
                        className="flex items-center gap-3 py-2 px-3 rounded-lg border bg-card"
                      >
                        <span className={cn("px-2.5 py-1 rounded-full text-xs font-medium", tagColors)}>
                          {tag}
                        </span>
                        <span className="text-xs text-muted-foreground flex-1">
                          {count} recipe{count !== 1 ? "s" : ""}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleStartRename(tag)}
                            disabled={isLoading}
                            title="Rename tag"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-blue-600"
                            onClick={() => handleStartMerge(tag)}
                            disabled={isLoading}
                            title="Merge into another tag"
                          >
                            <Merge className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleStartDelete(tag)}
                            disabled={isLoading}
                            title="Delete tag from all recipes"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Reassign recipes dialog */}
      <Dialog open={showReassignDialog} onOpenChange={setShowReassignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign Recipes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              The category &quot;{categoryToDelete}&quot; has {recipeCount} recipe{recipeCount !== 1 ? "s" : ""} assigned to it.
              Please select a category to reassign these recipes to before deleting.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Target Category</label>
              <Select value={targetCategory} onValueChange={setTargetCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategoriesForReassign.map((cat) => (
                    <SelectItem key={cat} value={cat} className="capitalize">
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleReassignAndDelete}
              disabled={!targetCategory || bulkUpdate.isPending || updateCategories.isPending}
            >
              {bulkUpdate.isPending || updateCategories.isPending
                ? "Reassigning..."
                : "Reassign & Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Tag Dialog */}
      <AlertDialog open={showRenameDialog} onOpenChange={setShowRenameDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Rename "{tagToManage}" to a new name. This will update all recipes that use this tag.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Input
              value={editTagName}
              onChange={(e) => setEditTagName(e.target.value)}
              placeholder="New tag name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmRename()
                if (e.key === "Escape") setShowRenameDialog(false)
              }}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRename} disabled={!editTagName.trim() || isLoading}>
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Tag Dialog */}
      <AlertDialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Tags</AlertDialogTitle>
            <AlertDialogDescription>
              Merge selected tags into a target tag. All recipes with the source tags will be updated to use the target tag.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Source Tags (to merge):</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {mergeSources.map((tag) => {
                  const tagColors = getTagClassName(tag, false)
                  return (
                    <div
                      key={tag}
                      className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", tagColors)}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveMergeSource(tag)}
                        className="hover:opacity-70"
                        disabled={mergeSources.length === 1}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
              {mergeSources.length < allTags.length && (
                <Select
                  value=""
                  onValueChange={(value) => {
                    if (value && !mergeSources.includes(value)) {
                      handleAddMergeSource(value)
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add another tag to merge..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allTags
                      .filter((tag) => !mergeSources.includes(tag))
                      .map((tag) => (
                        <SelectItem key={tag} value={tag}>
                          {tag}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Target Tag (merge into):</label>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target tag..." />
                </SelectTrigger>
                <SelectContent>
                  {allTags
                    .filter((tag) => !mergeSources.includes(tag))
                    .map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmMerge}
              disabled={!mergeTarget || mergeSources.length === 0 || isLoading}
            >
              Merge Tags
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Tag Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{tagToManage}" from all recipes? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={isLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
