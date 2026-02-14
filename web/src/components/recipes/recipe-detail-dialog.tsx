"use client"

import Image from "next/image"
import { Heart, Pencil, Trash2, X, History, UtensilsCrossed, ChefHat, Share2 } from "lucide-react"
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
import { useRef, useState } from "react"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import { CookMode } from "./cook-mode"

interface RecipeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe | null
  onEdit?: (recipe: Recipe) => void
  onDelete?: (recipe: Recipe) => void
  onShare?: (recipe: Recipe) => void
  lastMade?: string | null
  timesMade?: number
}

export function RecipeDetailDialog({
  open,
  onOpenChange,
  recipe,
  onEdit,
  onDelete,
  onShare,
  lastMade,
  timesMade = 0,
}: RecipeDetailDialogProps) {
  const toggleFavorite = useToggleFavorite()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isCookMode, setIsCookMode] = useState(false)
  const cookModeRecipeRef = useRef<Recipe | null>(null)

  const recipeImageUrl = recipe ? getRecipeImageUrl(recipe.image_url) : null

  const handleDelete = () => {
    if (onDelete && recipe) {
      onDelete(recipe)
      setShowDeleteConfirm(false)
      onOpenChange(false)
    }
  }

  if (!recipe) {
    // Render cook mode even when dialog recipe is null (dialog was closed to enter cook mode)
    if (isCookMode && cookModeRecipeRef.current) {
      return (
        <CookMode
          recipe={cookModeRecipeRef.current}
          onClose={() => {
            setIsCookMode(false)
            cookModeRecipeRef.current = null
          }}
        />
      )
    }
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="relative max-w-3xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-2xl sm:rounded-[32px] bg-card overflow-x-hidden overflow-y-auto scrollbar-recipe-dialog !top-2 !translate-y-0 !max-h-[calc(100dvh-1rem)] md:!top-6 md:!translate-y-0 md:!max-h-[calc(100dvh-3rem)]"
      >
        {/* Custom close — recipemodal_redesign */}
        <DialogTitle className="sr-only">{recipe.name}</DialogTitle>
        <div className="sticky top-3 z-20 h-0">
          <div className="flex justify-end px-4">
            <DialogClose asChild>
              <button
                type="button"
                className="pointer-events-auto bg-white/90 dark:bg-black/50 backdrop-blur-md p-1.5 rounded-full hover:bg-white dark:hover:bg-black/60 transition-colors text-stone-800 dark:text-stone-200 shadow-md"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </DialogClose>
          </div>
        </div>
        <div>
          {/* Image — aspect 16/10, rounded-3xl; placeholder when no image */}
          <div className="p-3 sm:p-6 pb-0">
            <div className="relative aspect-[16/10] overflow-hidden rounded-2xl sm:rounded-[24px] bg-card-cream dark:bg-zinc-800">
              {recipeImageUrl ? (
                <Image
                  src={recipeImageUrl}
                  alt={recipe.name}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 672px"
                  unoptimized={!recipeImageUrl.includes("supabase.co")}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <UtensilsCrossed className="h-16 w-16 text-stone-300 dark:text-zinc-600 opacity-40" />
                </div>
              )}
            </div>
          </div>

          {/* Header: title, category, history, heart, Edit — recipemodal_redesign */}
          <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-4">
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
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
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
                {recipe.instructions && recipe.instructions.length > 0 && (
                  <Button
                    onClick={() => {
                      cookModeRecipeRef.current = recipe
                      onOpenChange(false)
                      setIsCookMode(true)
                    }}
                    className="flex items-center gap-2 bg-primary text-primary-foreground font-semibold rounded-full px-4 sm:px-6 py-2 sm:py-2.5 text-sm"
                  >
                    <ChefHat className="h-4 w-4 sm:h-5 sm:w-5" />
                    Start Cooking
                  </Button>
                )}
                {onEdit && (
                  <Button
                    variant="outline"
                    onClick={() => onEdit(recipe)}
                    className="flex items-center gap-2 border-2 border-primary dark:border-stone-700 text-primary dark:text-stone-300 font-semibold rounded-full hover:bg-primary hover:text-primary-foreground dark:hover:bg-stone-700 dark:hover:text-stone-100 transition-all px-4 sm:px-6 py-2 sm:py-2.5 text-sm"
                  >
                    <Pencil className="h-4 w-4 sm:h-5 sm:w-5" />
                    Edit Recipe
                  </Button>
                )}
                {onShare && (
                  <Button
                    variant="outline"
                    onClick={() => onShare(recipe)}
                    className="flex items-center gap-2 border-2 border-slate-200 dark:border-stone-700 text-slate-700 dark:text-stone-200 font-semibold rounded-full hover:bg-slate-100 dark:hover:bg-stone-700 transition-all px-4 sm:px-6 py-2 sm:py-2.5 text-sm"
                  >
                    <Share2 className="h-4 w-4 sm:h-5 sm:w-5" />
                    Share
                  </Button>
                )}
              </div>
            </div>
            <hr className="mt-8 border-stone-200 dark:border-stone-800" />
          </div>

          {/* Ingredients | Instructions — 2-col grid, recipemodal_redesign */}
          <div className="px-4 sm:px-8 pb-12 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
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
                      {ingredient.alternatives && ingredient.alternatives.length > 0 && (
                        <span className="text-stone-600 dark:text-stone-400 font-normal">
                          {' or '}
                          {ingredient.alternatives.join(' or ')}
                        </span>
                      )}
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
            <div className="px-4 sm:px-8 pb-8 pt-2 border-t border-stone-200 dark:border-stone-800 flex justify-end">
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


