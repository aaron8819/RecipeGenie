"use client"

import Image from "next/image"
import { Heart, History, UtensilsCrossed, CalendarPlus, Loader2, ChevronRight, ShoppingCart, Check } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagClassName, getTagColor } from "@/lib/tag-colors"

/** Stitch recipes_redesign: category pill classes for grid cards */
const REF_CATEGORY_PILL: Record<string, string> = {
  beef: "bg-accent-rose text-red-800",
  chicken: "bg-accent-mint text-emerald-800",
  lamb: "bg-accent-peach text-orange-800",
  turkey: "bg-amber-100 text-amber-800",
  vegetarian: "bg-blue-100 text-blue-800",
}

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
        className="group cursor-pointer hover:shadow-md transition-shadow animate-fade-in overflow-hidden w-full"
        onClick={() => onClick?.(recipe)}
      >
        <div className="flex items-center gap-2 sm:gap-4 p-3 sm:p-4">
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

          {/* Recipe Image - List View */}
          <div className="w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-gradient-to-br from-amber-50 to-amber-100/50">
            {recipe.image_url ? (
              <Image
                src={recipe.image_url}
                alt={recipe.name}
                width={80}
                height={80}
                className="w-full h-full object-cover"
                unoptimized={!recipe.image_url.includes('supabase.co')}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">
                🍳
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <h3 className="font-semibold text-base line-clamp-1 mb-1">{recipe.name}</h3>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap text-xs">
              <span className={cn("capitalize whitespace-nowrap", getTagClassName(recipe.category, true))}>
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
                    "whitespace-nowrap",
                    getTagClassName(tag, false),
                    onTagClick && "cursor-pointer hover:opacity-80 transition-opacity"
                  )}
                  title={onTagClick ? "Click to filter by this tag" : undefined}
                >
                  {tag}
                </button>
              ))}
              {timesMade > 0 && (
                <span className="text-muted-foreground whitespace-nowrap">
                  Made {timesMade}x
                  {lastMade && ` · Last: ${new Date(lastMade).toLocaleDateString()}`}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {onMarkAsMade && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onMarkAsMade?.(recipe)
                }}
                disabled={isMarkingAsMade}
                className="text-green-700 hover:text-green-800 hover:bg-green-50 p-2"
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
              className="text-blue-700 hover:text-blue-800 hover:bg-blue-50 p-2"
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
              className="text-sage-700 hover:text-sage-800 hover:bg-sage-50 p-2"
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
              className="h-8 w-8"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  // Grid view — Stitch recipes_redesign: rounded-3xl, h-60 image, heart overlay, pills, Made X times / Last: date
  return (
    <Card
      className="group relative cursor-pointer overflow-hidden w-full rounded-3xl border border-stone-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm hover:shadow-xl transition-all duration-300 animate-fade-in"
      onClick={() => onClick?.(recipe)}
    >
      {/* Image */}
      <div className="relative h-60 overflow-hidden bg-stone-100 dark:bg-zinc-800">
        {recipe.image_url ? (
          <Image
            src={recipe.image_url}
            alt={recipe.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            unoptimized={!recipe.image_url.includes("supabase.co")}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card-cream dark:bg-zinc-800">
            <UtensilsCrossed className="h-16 w-16 text-primary opacity-40" />
          </div>
        )}
        {/* Heart — top-right overlay */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite?.(recipe)
          }}
          className="absolute top-4 right-4 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm p-2 rounded-full shadow-md hover:text-red-500 transition-colors"
        >
          <Heart
            className={cn(
              "h-5 w-5",
              recipe.favorite ? "fill-red-500 text-red-500" : "text-stone-400 dark:text-zinc-500"
            )}
          />
        </button>
      </div>
      {/* Body */}
      <div className="p-6">
        <h3 className="text-xl font-bold mb-3 dark:text-white line-clamp-2">{recipe.name}</h3>
        <div className="flex flex-wrap gap-2 mb-4">
          <span
            className={cn(
              "px-3 py-1 text-xs font-semibold rounded-full capitalize",
              REF_CATEGORY_PILL[recipe.category?.toLowerCase()] ??
                getTagColor(recipe.category, true).bg + " " + getTagColor(recipe.category, true).text
            )}
          >
            {recipe.category}
          </span>
          {recipe.tags?.map((tag) => {
            const c = getTagColor(tag, false)
            return (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(tag)
                }}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-full",
                  c.bg,
                  c.text,
                  onTagClick && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                title={onTagClick ? "Filter by this tag" : undefined}
              >
                {tag}
              </button>
            )
          })}
        </div>
        {(timesMade > 0 || lastMade) && (
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-medium">
            <div className="flex items-center gap-1.5">
              <History className="h-4 w-4" />
              Made {timesMade} time{timesMade !== 1 ? "s" : ""}
            </div>
            {lastMade && (
              <div className="flex items-center gap-1.5">Last: {new Date(lastMade).toLocaleDateString()}</div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
