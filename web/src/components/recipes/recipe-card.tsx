"use client"

import Image from "next/image"
import { Heart, History, UtensilsCrossed, CalendarPlus, Loader2, ChevronRight, ShoppingCart, Check, MoreVertical, Share2 } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagColor } from "@/lib/tag-colors"
import { getRecipeImageUrl } from "@/lib/supabase/storage"

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
  isDesktopViewport?: boolean
  onDelete?: (recipe: Recipe) => void
  onToggleFavorite?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onAddToShoppingList?: (recipe: Recipe) => void
  onMarkAsMade?: (recipe: Recipe) => void
  onShare?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  onTagClick?: (tag: string) => void
  lastMade?: string | null
  timesMade?: number
  isAddingToPlan?: boolean
  isAddingToShoppingList?: boolean
  isMarkingAsMade?: boolean
  isSharing?: boolean
}

export function RecipeCard({
  recipe,
  viewMode = "grid",
  isDesktopViewport = true,
  onDelete,
  onToggleFavorite,
  onAddToPlan,
  onAddToShoppingList,
  onMarkAsMade,
  onShare,
  onClick,
  onTagClick,
  lastMade,
  timesMade = 0,
  isAddingToPlan = false,
  isAddingToShoppingList = false,
  isMarkingAsMade = false,
  isSharing = false,
}: RecipeCardProps) {
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  // List view — match reference: horizontal card, image + favorite overlay, pills, icon actions
  if (viewMode === "list") {
    const categoryColor = getTagColor(recipe.category, true)
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick?.(recipe)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick?.(recipe)
          }
        }}
        className="recipe-card group flex items-center justify-between p-4 md:p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.98] animate-fade-in cursor-pointer w-full"
      >
        <div className="flex items-start md:items-center gap-4 md:gap-6 min-w-0 flex-1">
          {/* Image with favorite overlay — reference: w-32 h-32 rounded-2xl, heart top-left */}
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite?.(recipe)
              }}
              className={cn(
                "absolute top-2 left-2 p-1.5 bg-white/80 dark:bg-slate-800/80 backdrop-blur rounded-full z-10 transition-opacity",
                recipe.favorite
                  ? "opacity-100"
                  : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
              )}
              aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart
                className={cn(
                  "h-4 w-4 text-red-500",
                  recipe.favorite && "fill-red-500"
                )}
              />
            </button>
            <div className="w-28 h-28 md:w-32 md:h-32 rounded-2xl overflow-hidden bg-stone-100 dark:bg-slate-700 shadow-inner">
              {recipeImageUrl ? (
                <Image
                  src={recipeImageUrl}
                  alt={recipe.name}
                  width={128}
                  height={128}
                  className="w-full h-full object-cover"
                  unoptimized={!recipeImageUrl.includes("supabase.co")}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">
                  🍳
                </div>
              )}
            </div>
          </div>

          {/* Title, tags, history */}
          <div className="min-w-0 flex-1 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-lg md:text-2xl font-semibold text-slate-900 dark:text-white line-clamp-2">
                {recipe.name}
              </h3>
              {!isDesktopViewport && (
                <ChevronRight className="h-4 w-4 text-slate-300 mt-1 flex-shrink-0" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {recipe.category && (
                <span
                  className={cn(
                    "px-2.5 py-0.5 text-[10px] font-bold rounded-md uppercase tracking-wider md:px-3 md:py-1 md:text-xs md:rounded-full",
                    categoryColor.bg,
                    categoryColor.text
                  )}
                >
                  {recipe.category}
                </span>
              )}
              {recipe.tags?.slice(0, 3).map((tag) => {
                const tagColor = getTagColor(tag, false)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTagClick?.(tag)
                    }}
                    className={cn(
                      "px-2.5 py-0.5 text-[10px] font-medium rounded-md md:px-3 md:py-1 md:text-xs md:rounded-full",
                      tagColor.bg,
                      tagColor.text,
                      onTagClick && "cursor-pointer hover:opacity-80 transition-opacity"
                    )}
                    title={onTagClick ? "Filter by this tag" : undefined}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            <p className="-mt-0.5 text-xs md:text-sm text-slate-400 dark:text-slate-500 font-medium">
              {timesMade > 0
                ? `Made ${timesMade}x${lastMade ? ` • Last: ${new Date(lastMade).toLocaleDateString()}` : ""}`
                : "Not made yet"}
            </p>

            <div className={cn("flex justify-end gap-2", isDesktopViewport && "hidden")}>
              {onMarkAsMade && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onMarkAsMade?.(recipe)
                  }}
                  disabled={isMarkingAsMade}
                  className="p-1.5 text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-all"
                  title="Mark as Done"
                >
                  {isMarkingAsMade ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Check className="h-5 w-5" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToShoppingList?.(recipe)
                }}
                disabled={isAddingToShoppingList}
                className="p-1.5 text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-all"
                title="Add to Shopping List"
              >
                {isAddingToShoppingList ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ShoppingCart className="h-5 w-5" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAddToPlan?.(recipe)
                }}
                disabled={isAddingToPlan}
                className="p-1.5 text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-all"
                title="Plan Meal"
              >
                {isAddingToPlan ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <CalendarPlus className="h-5 w-5" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onShare?.(recipe)
                }}
                disabled={isSharing}
                className="p-1.5 text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-all"
                title="Share Recipe"
              >
                {isSharing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Share2 className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Action icons — reference: check_circle, shopping_cart, calendar_today, divider, chevron_right */}
        <div className={cn("items-center gap-1 flex-shrink-0", isDesktopViewport ? "flex" : "hidden")}>
          {onMarkAsMade && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onMarkAsMade?.(recipe)
              }}
              disabled={isMarkingAsMade}
              className="p-3 text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-full transition-all"
              title="Mark as Done"
            >
              {isMarkingAsMade ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Check className="h-5 w-5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddToShoppingList?.(recipe)
            }}
            disabled={isAddingToShoppingList}
            className="p-3 text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-full transition-all"
            title="Add to Shopping List"
          >
            {isAddingToShoppingList ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ShoppingCart className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAddToPlan?.(recipe)
            }}
            disabled={isAddingToPlan}
            className="p-3 text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-full transition-all"
            title="Plan Meal"
          >
            {isAddingToPlan ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CalendarPlus className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onShare?.(recipe)
            }}
            disabled={isSharing}
            className="p-3 text-slate-400 hover:text-primary dark:hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-full transition-all"
            title="Share Recipe"
          >
            {isSharing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Share2 className="h-5 w-5" />
            )}
          </button>
          <div className="w-px h-8 bg-slate-100 dark:bg-slate-700 mx-2" aria-hidden />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClick?.(recipe)
            }}
            className="p-3 text-slate-400 group-hover:text-primary dark:group-hover:text-white transition-all"
            aria-label="View recipe"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
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
        {recipeImageUrl ? (
          <Image
            src={recipeImageUrl}
            alt={recipe.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            unoptimized={!recipeImageUrl.includes("supabase.co")}
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
        <div className="flex flex-wrap gap-2 mb-3">
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
        {/* History row: inline with mobile 3-dot to avoid extra bottom space */}
        <div className="flex items-center justify-between gap-2 mb-2 md:mb-6">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-medium min-h-5 flex-1 min-w-0">
            {(timesMade > 0 || lastMade) ? (
              <>
                <History className="h-4 w-4 flex-shrink-0" />
                Made {timesMade} time{timesMade !== 1 ? "s" : ""}
                {lastMade && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600 mx-1" aria-hidden>·</span>
                    <span>Last: {new Date(lastMade).toLocaleDateString()}</span>
                  </>
                )}
              </>
            ) : (
              <span className={cn(isDesktopViewport && "hidden")} aria-hidden />
            )}
          </div>
          <div className={cn("flex-shrink-0", isDesktopViewport && "hidden")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-xl"
                  onClick={(e) => e.stopPropagation()}
                  title="Actions"
                >
                  <MoreVertical className="h-5 w-5 text-slate-600 dark:text-slate-400" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                {onMarkAsMade && (
                  <DropdownMenuItem
                    onClick={() => onMarkAsMade?.(recipe)}
                    disabled={isMarkingAsMade}
                    className="text-slate-700 dark:text-slate-300"
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Mark as Made
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => onAddToShoppingList?.(recipe)}
                  disabled={isAddingToShoppingList}
                  className="text-slate-700 dark:text-slate-300"
                >
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Add to Shopping List
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onAddToPlan?.(recipe)}
                  disabled={isAddingToPlan}
                  className="text-slate-700 dark:text-slate-300"
                >
                  <CalendarPlus className="h-4 w-4 mr-2" />
                  Add to Meal Plan
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onShare?.(recipe)}
                  disabled={isSharing}
                  className="text-slate-700 dark:text-slate-300"
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Recipe
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {/* Desktop: 4-button grid. Mobile: no separate action row */}
        <div className={cn("grid grid-cols-4 gap-2", !isDesktopViewport && "hidden")}>
          {onMarkAsMade && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onMarkAsMade?.(recipe)
              }}
              disabled={isMarkingAsMade}
              className="flex items-center justify-center gap-1.5 py-2 px-1 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:border-slate-300 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-100 transition-colors"
              title="Mark as Made"
            >
              {isMarkingAsMade ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-[18px] w-[18px]" />
                  Made
                </>
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
            className="flex items-center justify-center gap-1.5 py-2 px-1 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:border-slate-300 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-100 transition-colors"
            title="Add to Shopping List"
          >
            {isAddingToShoppingList ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ShoppingCart className="h-[18px] w-[18px]" />
                Shop
              </>
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
            className="flex items-center justify-center gap-1.5 py-2 px-1 bg-primary text-white rounded-xl text-xs font-semibold hover:bg-primary/90 hover:ring-2 hover:ring-primary/30 transition-colors"
            title="Add to Meal Plan"
          >
            {isAddingToPlan ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <CalendarPlus className="h-[18px] w-[18px]" />
                Plan
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onShare?.(recipe)
            }}
            disabled={isSharing}
            className="flex items-center justify-center gap-1.5 py-2 px-1 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 hover:border-slate-300 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-100 transition-colors"
            title="Share Recipe"
          >
            {isSharing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Share2 className="h-[18px] w-[18px]" />
                Share
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  )
}



