"use client"

import { Heart, Trash2, Clock, CalendarPlus, Loader2, ChevronRight, ShoppingCart, Check } from "lucide-react"
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
  onAddToShoppingList?: (recipe: Recipe) => void
  onMarkAsMade?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  onTagClick?: (tag: string) => void
  lastMade?: string | null
  timesMade?: number
  isAddingToPlan?: boolean
  isAddingToShoppingList?: boolean
  isMarkingAsMade?: boolean
}

export function RecipeCard({
  recipe,
  viewMode = "grid",
  onDelete,
  onToggleFavorite,
  onAddToPlan,
  onAddToShoppingList,
  onMarkAsMade,
  onClick,
  onTagClick,
  lastMade,
  timesMade = 0,
  isAddingToPlan = false,
  isAddingToShoppingList = false,
  isMarkingAsMade = false,
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
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick?.(tag)
                  }}
                  className={cn(
                    getTagClassName(tag, false),
                    onTagClick && "cursor-pointer hover:opacity-80 transition-opacity"
                  )}
                  title={onTagClick ? "Click to filter by this tag" : undefined}
                >
                  {tag}
                </button>
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
            {onMarkAsMade && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onMarkAsMade?.(recipe)
                }}
                disabled={isMarkingAsMade}
                className="text-green-700 hover:text-green-800 hover:bg-green-50"
                title="Mark as Made"
              >
                {isMarkingAsMade ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onAddToShoppingList?.(recipe)
              }}
              disabled={isAddingToShoppingList}
              className="text-blue-700 hover:text-blue-800 hover:bg-blue-50"
              title="Add to Shopping List"
            >
              {isAddingToShoppingList ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onAddToPlan?.(recipe)
              }}
              disabled={isAddingToPlan}
              className="text-sage-700 hover:text-sage-800 hover:bg-sage-50"
              title="Add to Meal Plan"
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

  // Grid view (enhanced with beautiful borders)
  return (
    <Card
      className={cn(
        "group relative cursor-pointer transition-all duration-300 animate-fade-in",
        "border-2 border-amber-200/50 hover:border-terracotta-300/60",
        "shadow-md hover:shadow-xl hover:-translate-y-1",
        "bg-gradient-to-br from-white to-amber-50/30",
        recipe.favorite && "ring-2 ring-terracotta-200/50 border-terracotta-300/70"
      )}
      onClick={() => onClick?.(recipe)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg line-clamp-2 pr-8 font-bold leading-tight">
            {recipe.name}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-9 w-9 rounded-full transition-all hover:bg-red-50"
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite?.(recipe)
            }}
          >
            <Heart
              className={cn(
                "h-5 w-5 transition-colors",
                recipe.favorite
                  ? "fill-red-500 text-red-500"
                  : "text-muted-foreground hover:text-red-400"
              )}
            />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <span className={cn("capitalize text-sm font-semibold px-3 py-1.5 rounded-lg", getTagClassName(recipe.category, true))}>
                {recipe.category}
              </span>
              {recipe.tags && recipe.tags.length > 0 && (
                <>
                  {recipe.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onTagClick?.(tag)
                      }}
                      className={cn(
                        "text-sm font-semibold px-3 py-1.5 rounded-lg",
                        getTagClassName(tag, false),
                        onTagClick && "cursor-pointer hover:opacity-80 transition-opacity"
                      )}
                      title={onTagClick ? "Click to filter by this tag" : undefined}
                    >
                      {tag}
                    </button>
                  ))}
                </>
              )}
            </div>

            {timesMade > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
                <Clock className="h-4 w-4" />
                <span>
                  Made {timesMade} time{timesMade !== 1 ? "s" : ""}
                  {lastMade && ` · Last: ${new Date(lastMade).toLocaleDateString()}`}
                </span>
              </div>
            )}

            {/* Actions - Visible on mobile, hover-reveal on desktop */}
            <div className="flex gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
              {onMarkAsMade && (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-initial text-green-700 hover:text-green-800 hover:bg-green-50 border-green-200"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkAsMade?.(recipe)
                  }}
                  disabled={isMarkingAsMade}
                  title="Mark as Made"
                >
                  {isMarkingAsMade ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1.5 sm:mr-0" />
                      <span className="sm:hidden">Mark Made</span>
                    </>
                  )}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-initial text-blue-700 hover:text-blue-800 hover:bg-blue-50 border-blue-200"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToShoppingList?.(recipe)
                }}
                disabled={isAddingToShoppingList}
                title="Add to Shopping List"
              >
                {isAddingToShoppingList ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <ShoppingCart className="h-3.5 w-3.5 mr-1.5 sm:mr-0" />
                    <span className="sm:hidden">Add to Cart</span>
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 sm:flex-initial text-sage-700 hover:text-sage-800 hover:bg-sage-50 border-sage-200"
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
            </div>
          </CardContent>
    </Card>
  )
}
