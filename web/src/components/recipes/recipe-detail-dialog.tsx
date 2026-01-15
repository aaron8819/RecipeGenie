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
import { cn } from "@/lib/utils"

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
                    ? "fill-red-500 text-red-500"
                    : "text-muted-foreground"
                )}
              />
            </Button>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Meta info */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="capitalize px-2 py-1 bg-secondary rounded-md">
              {recipe.category}
            </span>
            <span>{recipe.servings} servings</span>
            {recipe.tags && recipe.tags.length > 0 && (
              <div className="flex gap-1">
                {recipe.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-primary/10 text-primary rounded-full text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
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
                        {ingredient.amount} {ingredient.unit}{" "}
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

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onEdit?.(recipe)}>
            <Pencil className="h-4 w-4 mr-2" />
            Edit Recipe
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
