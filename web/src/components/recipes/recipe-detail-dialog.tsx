"use client"

import { Heart, Pencil } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useToggleFavorite } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"
import { cn, toFraction } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface RecipeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe | null
  onEdit?: (recipe: Recipe) => void
}

export function RecipeDetailDialog({
  open,
  onOpenChange,
  recipe,
  onEdit,
}: RecipeDetailDialogProps) {
  const toggleFavorite = useToggleFavorite()

  if (!recipe) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between pr-8">
            <DialogTitle className="text-xl">{recipe.name}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
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
        </DialogHeader>

        <div className="space-y-6 pt-2 pb-4">
          {/* Meta info */}
          <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
            <span className={cn("capitalize", getTagClassName(recipe.category, true))}>
              {recipe.category}
            </span>
            {recipe.tags && recipe.tags.length > 0 && (
              <>
                {recipe.tags.map((tag) => (
                  <span key={tag} className={getTagClassName(tag, false)}>
                    {tag}
                  </span>
                ))}
              </>
            )}
            <span className="text-xs">{recipe.servings} servings</span>
          </div>

          {/* Ingredients */}
          <div>
            <h3 className="font-semibold mb-3">Ingredients</h3>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
