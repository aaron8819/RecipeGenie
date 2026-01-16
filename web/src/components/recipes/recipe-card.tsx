"use client"

import { Heart, Trash2, Clock, CalendarPlus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"

interface RecipeCardProps {
  recipe: Recipe
  onDelete?: (recipe: Recipe) => void
  onToggleFavorite?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  lastMade?: string | null
  timesMade?: number
}

export function RecipeCard({
  recipe,
  onDelete,
  onToggleFavorite,
  onAddToPlan,
  onClick,
  lastMade,
  timesMade = 0,
}: RecipeCardProps) {
  return (
    <Card
      className={cn(
        "group relative cursor-pointer animate-fade-in",
        recipe.favorite && "ring-2 ring-terracotta-200"
      )}
      onClick={() => onClick?.(recipe)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg line-clamp-2 pr-8 font-semibold">
            {recipe.name}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8 transition-transform hover:scale-110"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite?.(recipe)
            }}
          >
            <Heart
              className={cn(
                "h-5 w-5 transition-colors",
                recipe.favorite
                  ? "fill-terracotta-500 text-terracotta-500"
                  : "text-muted-foreground hover:text-terracotta-400"
              )}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
          <span className="capitalize px-2.5 py-1 bg-sage-100 text-sage-700 rounded-full text-xs font-medium">
            {recipe.category}
          </span>
          <span className="text-xs">{recipe.servings} servings</span>
        </div>

        {timesMade > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <Clock className="h-3 w-3" />
            <span>
              Made {timesMade} time{timesMade !== 1 ? "s" : ""}
              {lastMade && ` · Last: ${new Date(lastMade).toLocaleDateString()}`}
            </span>
          </div>
        )}

        <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Button
            variant="outline"
            size="sm"
            className="text-sage-700 hover:text-sage-800 hover:bg-sage-50"
            onClick={(e) => {
              e.stopPropagation()
              onAddToPlan?.(recipe)
            }}
            title="Add to Meal Plan"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(recipe)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
