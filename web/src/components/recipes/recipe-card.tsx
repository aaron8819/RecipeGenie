"use client"

import { Heart, Trash2, Clock, CalendarPlus, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface RecipeCardProps {
  recipe: Recipe
  onDelete?: (recipe: Recipe) => void
  onToggleFavorite?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  lastMade?: string | null
  timesMade?: number
  isAddingToPlan?: boolean
}

export function RecipeCard({
  recipe,
  onDelete,
  onToggleFavorite,
  onAddToPlan,
  onClick,
  lastMade,
  timesMade = 0,
  isAddingToPlan = false,
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
        <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground mb-3">
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
            disabled={isAddingToPlan}
            title="Add to Meal Plan"
          >
            {isAddingToPlan ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarPlus className="h-3.5 w-3.5" />
            )}
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
