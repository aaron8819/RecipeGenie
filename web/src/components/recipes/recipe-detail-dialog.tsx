"use client"

import Image from "next/image"
import { Heart, Pencil, Trash2, X, History, UtensilsCrossed } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogClose,
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
      <DialogContent
        hideCloseButton
        className="max-w-3xl w-full p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-[32px] overflow-hidden bg-card max-h-[90vh] overflow-y-auto scrollbar-recipe-dialog"
      >
        {/* Custom close — recipemodal_redesign */}
        <DialogTitle className="sr-only">{recipe.name}</DialogTitle>
        <DialogClose asChild>
          <button
            type="button"
            className="absolute top-6 right-6 z-10 bg-white/80 dark:bg-black/40 backdrop-blur-md p-2 rounded-full hover:bg-white dark:hover:bg-black/60 transition-colors text-stone-800 dark:text-stone-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </DialogClose>

        <div>
          {/* Image — aspect 16/10, rounded-3xl; placeholder when no image */}
          <div className="p-6 pb-0">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-card-cream dark:bg-zinc-800">
              {recipe.image_url ? (
                <Image
                  src={recipe.image_url}
                  alt={recipe.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 672px"
                  unoptimized={!recipe.image_url.includes("supabase.co")}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <UtensilsCrossed className="h-16 w-16 text-stone-300 dark:text-zinc-600 opacity-40" />
                </div>
              )}
            </div>
          </div>

          {/* Header: title, category, history, heart, Edit — recipemodal_redesign */}
          <div className="px-8 pt-8 pb-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl md:text-4xl font-display font-bold text-primary dark:text-stone-100 mb-2">
                  {recipe.name}
                </h1>
                <div className="flex items-center gap-3 flex-wrap">
                  {recipe.category && (
                    <span
                      className={cn(
                        "px-3 py-1 text-sm font-semibold rounded-full capitalize",
                        getTagClassName(recipe.category, true)
                      )}
                    >
                      {recipe.category}
                    </span>
                  )}
                  {recipe.tags && recipe.tags.length > 0 && (
                    recipe.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "px-3 py-1 text-sm font-medium rounded-full",
                          getTagClassName(tag, false)
                        )}
                      >
                        {tag}
                      </span>
                    ))
                  )}
                  {timesMade > 0 && (
                    <div className="flex items-center text-stone-500 dark:text-stone-400 text-sm">
                      <History className="h-4 w-4 mr-1 shrink-0" />
                      Made {timesMade} time{timesMade !== 1 ? "s" : ""}
                      {lastMade && ` • Last: ${new Date(lastMade).toLocaleDateString()}`}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    toggleFavorite.mutate({ id: recipe.id, favorite: recipe.favorite })
                  }
                  className="p-2 rounded-full hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
                  aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Heart
                    className={cn(
                      "h-6 w-6",
                      recipe.favorite
                        ? "fill-terracotta-500 text-terracotta-500"
                        : "text-stone-400 dark:text-zinc-500"
                    )}
                  />
                </button>
                {onEdit && (
                  <Button
                    variant="outline"
                    onClick={() => onEdit(recipe)}
                    className="flex items-center gap-2 border-2 border-primary dark:border-stone-700 text-primary dark:text-stone-300 font-semibold rounded-full hover:bg-primary hover:text-primary-foreground dark:hover:bg-stone-700 dark:hover:text-stone-100 transition-all px-6 py-2.5"
                  >
                    <Pencil className="h-5 w-5" />
                    Edit Recipe
                  </Button>
                )}
              </div>
            </div>
            <hr className="mt-8 border-stone-200 dark:border-stone-800" />
          </div>

          {/* Ingredients | Instructions — 2-col grid, recipemodal_redesign */}
          <div className="px-8 pb-12 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
            <div className="md:col-span-4">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-primary dark:text-stone-200">Ingredients</h2>
                <span className="text-stone-500 dark:text-stone-400 text-sm">
                  {recipe.servings} {recipe.servings === 1 ? "serving" : "servings"}
                </span>
              </div>
              <ul className="space-y-4">
                {recipe.ingredients?.map((ingredient, index) => (
                  <li key={index} className="flex items-start gap-3 text-stone-700 dark:text-stone-300">
                    <span className="w-2 h-2 rounded-full bg-stone-300 dark:bg-stone-600 mt-2 flex-shrink-0" />
                    <span className="font-medium">
                      {ingredient.amount != null && (
                        <>{toFraction(ingredient.amount)} {ingredient.unit}{" "}</>
                      )}
                      {ingredient.item}
                      {ingredient.modifier && (
                        <span className="text-stone-500 dark:text-stone-400 font-normal">, {ingredient.modifier}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:col-span-8">
              <h2 className="text-xl font-bold text-primary dark:text-stone-200 mb-6">Instructions</h2>
              <div className="space-y-8">
                {recipe.instructions?.map((step, index) => (
                  <div key={index} className="flex gap-4">
                    <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                      {index + 1}
                    </span>
                    <p className="text-stone-700 dark:text-stone-300 leading-relaxed pt-1">{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Delete */}
          {onDelete && (
            <div className="px-8 pb-8 pt-2 border-t border-stone-200 dark:border-stone-800 flex justify-end">
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
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{recipe.name}&quot;? This action cannot be undone.
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
