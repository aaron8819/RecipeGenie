"use client"

import { Heart, Trash2, Clock, CalendarPlus, Loader2, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface RecipeCardProps {
  recipe: Recipe
  viewMode?: "grid" | "list"
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
  viewMode = "grid",
  onDelete,
  onToggleFavorite,
  onAddToPlan,
  onClick,
  lastMade,
  timesMade = 0,
  isAddingToPlan = false,
}: RecipeCardProps) {
  // List view
  if (viewMode === "list") {
    return (
      <Card
        className="group cursor-pointer hover:shadow-md transition-shadow animate-fade-in"
        onClick={() => onClick?.(recipe)}
      >
        <div className="flex items-center gap-4 p-4">
          {/* Favorite Button - Always Visible */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite?.(recipe)
            }}
          >
            <Heart
              className={cn(
                "h-4 w-4",
                recipe.favorite
                  ? "fill-terracotta-500 text-terracotta-500"
                  : "text-muted-foreground"
              )}
            />
          </Button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base line-clamp-1 mb-1 w-full">{recipe.name}</h3>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={cn("capitalize", getTagClassName(recipe.category, true))}>
                {recipe.category}
              </span>
              {recipe.tags?.slice(0, 2).map((tag) => (
                <span key={tag} className={getTagClassName(tag, false)}>
                  {tag}
                </span>
              ))}
              {timesMade > 0 && (
                <span className="text-muted-foreground">
                  Made {timesMade}x
                  {lastMade && ` · Last: ${new Date(lastMade).toLocaleDateString()}`}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onAddToPlan?.(recipe)
              }}
              disabled={isAddingToPlan}
              className="text-sage-700 hover:text-sage-800 hover:bg-sage-50"
            >
              {isAddingToPlan ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                onClick?.(recipe)
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  // Grid view (enhanced)
  return (
    <Card
      className={cn(
        "group relative cursor-pointer transition-all hover:shadow-lg animate-fade-in",
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

        {/* Actions - Visible on mobile, hover-reveal on desktop */}
        <div className="flex gap-2 mt-3 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-initial text-sage-700 hover:text-sage-800 hover:bg-sage-50"
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
              <>
                <CalendarPlus className="h-3.5 w-3.5 mr-1.5 sm:mr-0" />
                <span className="sm:hidden">Add to Plan</span>
              </>
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
