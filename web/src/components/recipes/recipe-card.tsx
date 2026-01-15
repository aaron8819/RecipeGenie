"use client"

import { Heart, Pencil, Trash2, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"

interface RecipeCardProps {
  recipe: Recipe
  onEdit?: (recipe: Recipe) => void
  onDelete?: (recipe: Recipe) => void
  onToggleFavorite?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  lastMade?: string | null
}

export function RecipeCard({
  recipe,
  onEdit,
  onDelete,
  onToggleFavorite,
  onClick,
  lastMade,
}: RecipeCardProps) {
  return (
    <Card
      className={cn(
        "relative cursor-pointer hover:shadow-md transition-shadow",
        recipe.favorite && "ring-2 ring-primary/20"
      )}
      onClick={() => onClick?.(recipe)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg line-clamp-2 pr-8">
            {recipe.name}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite?.(recipe)
            }}
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
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <span className="capitalize px-2 py-1 bg-secondary rounded-md">
            {recipe.category}
          </span>
          <span>{recipe.servings} servings</span>
        </div>

        {lastMade && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
            <Clock className="h-3 w-3" />
            <span>Last made: {new Date(lastMade).toLocaleDateString()}</span>
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit?.(recipe)
            }}
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(recipe)
            }}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
