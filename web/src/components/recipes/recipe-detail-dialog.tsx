"use client"

import { Heart, Pencil, Clock, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Button } from "@/components/ui/button"
import { useToggleFavorite } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"
import { cn, toFraction } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"
import { useState } from "react"

interface RecipeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe | null
  onEdit?: (recipe: Recipe) => void
  onDelete?: (recipe: Recipe) => void
  lastMade?: string | null
  timesMade?: number
}

export function RecipeDetailDialog({
  open,
  onOpenChange,
  recipe,
  onEdit,
  onDelete,
  lastMade,
  timesMade = 0,
}: RecipeDetailDialogProps) {
  const toggleFavorite = useToggleFavorite()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  if (!recipe) return null

  const handleDelete = () => {
    if (onDelete) {
      onDelete(recipe)
      setShowDeleteConfirm(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
        {/* Fixed Header */}
        <DialogHeader className="space-y-4 p-6 pb-4 flex-shrink-0 border-b">
          {/* Top row: Title and action buttons */}
          <div className="flex items-start justify-between gap-4 pr-8">
            <DialogTitle className="text-2xl font-bold leading-tight flex-1">
              {recipe.name}
            </DialogTitle>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() =>
                  toggleFavorite.mutate({ id: recipe.id, favorite: recipe.favorite })
                }
              >
                <Heart
                  className={cn(
                    "h-5 w-5",
                    recipe.favorite
                      ? "fill-terracotta-500 text-terracotta-500"
                      : "text-muted-foreground hover:text-terracotta-400"
                  )}
                />
              </Button>
              {onEdit && (
                <Button variant="outline" size="sm" onClick={() => onEdit(recipe)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Recipe
                </Button>
              )}
            </div>
          </div>

          {/* Meta info: Tags */}
          <div className="flex items-center gap-3 flex-wrap">
            {recipe.category && (
              <span className={cn("capitalize text-sm font-medium px-2.5 py-1 rounded-md", getTagClassName(recipe.category, true))}>
                {recipe.category}
              </span>
            )}
            {recipe.tags && recipe.tags.length > 0 && (
              <>
                {recipe.tags.map((tag) => (
                  <span key={tag} className={cn("text-sm font-medium px-2.5 py-1 rounded-md", getTagClassName(tag, false))}>
                    {tag}
                  </span>
                ))}
              </>
            )}
          </div>

          {/* Last made date and times made */}
          {timesMade > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Made {timesMade} time{timesMade !== 1 ? "s" : ""}
                {lastMade && ` · Last: ${new Date(lastMade).toLocaleDateString()}`}
              </span>
            </div>
          )}
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-thin">
          <div className="space-y-6">

          {/* Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Ingredients</h3>
              <span className="text-sm text-muted-foreground">
                {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}
              </span>
            </div>
            <ul className="space-y-2">
              {recipe.ingredients?.map((ingredient, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary/50" />
                  <span>
                    {ingredient.amount && (
                      <span className="font-medium">
                        {toFraction(ingredient.amount)} {ingredient.unit}{" "}
                      </span>
                    )}
                    {ingredient.item}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Instructions */}
          <div>
            <h3 className="font-semibold mb-3">Instructions</h3>
            <ol className="space-y-3">
              {recipe.instructions?.map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Delete Button - Only visible when scrolled to bottom */}
          {onDelete && (
            <div className="pt-6 border-t flex justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Recipe
              </Button>
            </div>
          )}
          </div>
        </div>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{recipe.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
