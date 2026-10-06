"use client"

import { memo, useRef, useState } from "react"
import Image from "next/image"
import { Heart, Clock, UtensilsCrossed, CalendarPlus, Loader2, ShoppingCart, MoreHorizontal, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import { buildRecipeDetailHref } from "@/lib/recipe-detail-navigation"
import { getAuthoredYieldText } from "@/lib/recipe-quantity"
import "./recipe-collection.css"

interface RecipeCardProps {
  recipe: Recipe
  viewMode?: "grid" | "list"
  isDesktopViewport?: boolean
  onDelete?: (recipe: Recipe) => void
  onToggleFavorite?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onAddToShoppingList?: (recipe: Recipe) => void
  onShare?: (recipe: Recipe) => void
  onClick?: (recipe: Recipe) => void
  onTagClick?: (tag: string) => void
  lastMade?: string | null
  timesMade?: number
  isAddingToPlan?: boolean
  isAddingToShoppingList?: boolean
  isSharing?: boolean
}

function RecipeCard({ recipe, viewMode = "grid", onToggleFavorite, onAddToPlan, onTagClick,
  onAddToShoppingList, onShare, onClick, isAddingToPlan = false,
  isAddingToShoppingList = false, isSharing = false }: RecipeCardProps) {
  const imageUrl = getRecipeImageUrl(recipe.image_url)
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const selectedActionRef = useRef<(() => void) | null>(null)

  return (
    <article data-recipe-name={recipe.name} className={cn("recipe-collection-card", viewMode === "list" && "recipe-collection-card-list")}>
      <a
        className="recipe-collection-card-link"
        href={buildRecipeDetailHref(recipe.id, "recipes")}
        onClick={(event) => {
          if (!onClick || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
          event.preventDefault()
          onClick(recipe)
        }}
      >
        <div className="recipe-collection-photo">
          {imageUrl && imageUrl !== failedImageUrl ? (
            <Image src={imageUrl} alt="" fill sizes={viewMode === "list" ? "96px" : "(max-width: 639px) 50vw, (min-width: 1360px) 25vw, 33vw"}
              className="object-cover" unoptimized={!imageUrl.includes("supabase.co")} onError={() => setFailedImageUrl(imageUrl)} />
          ) : (
            <div className="recipe-collection-photo-fallback" aria-hidden="true"><UtensilsCrossed /><span>Recipe</span></div>
          )}
        </div>
        <div className="recipe-collection-copy">
          <p className="recipe-collection-category">{recipe.category}</p>
          <h2>{recipe.name}</h2>
          <div className="recipe-collection-meta">
            {!!recipe.total_time_minutes && <span><Clock aria-hidden="true" />{recipe.total_time_minutes} min</span>}
            <span>{getAuthoredYieldText(recipe.yield_metadata, recipe.servings)}</span>
            {!!recipe.tags?.length && <span className="recipe-collection-tag">{recipe.tags[0]}</span>}
          </div>
        </div>
      </a>
      <div className="recipe-collection-card-actions">
        {onToggleFavorite && <Button type="button" variant="ghost" size="icon" className="h-11 w-11"
          aria-label={`${recipe.favorite ? "Remove" : "Add"} ${recipe.name} ${recipe.favorite ? "from" : "to"} favorites`}
          aria-pressed={!!recipe.favorite} onClick={() => onToggleFavorite(recipe)}>
          <Heart className={cn("h-5 w-5", recipe.favorite && "fill-current")} />
        </Button>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={menuTriggerRef} type="button" variant="ghost" size="icon" className="h-11 w-11" title="Actions" aria-label={`Actions for ${recipe.name}`}>
              <MoreHorizontal className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
            const action = selectedActionRef.current
            selectedActionRef.current = null
            if (action) {
              event.preventDefault()
              menuTriggerRef.current?.focus()
              action()
            }
          }}>
            {onAddToShoppingList && <DropdownMenuItem className="min-h-11" disabled={isAddingToShoppingList} onSelect={() => { selectedActionRef.current = () => onAddToShoppingList(recipe) }}>
              {isAddingToShoppingList ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}Add to Shopping List
            </DropdownMenuItem>}
            {onAddToPlan && <DropdownMenuItem className="min-h-11" disabled={isAddingToPlan} onSelect={() => { selectedActionRef.current = () => onAddToPlan(recipe) }}>
              {isAddingToPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarPlus className="mr-2 h-4 w-4" />}Add to Meal Plan
            </DropdownMenuItem>}
            {onShare && <DropdownMenuItem className="min-h-11" disabled={isSharing} onSelect={() => { selectedActionRef.current = () => onShare(recipe) }}>
              {isSharing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}Share Recipe
            </DropdownMenuItem>}
            {onTagClick && recipe.tags?.map((tag) => <DropdownMenuItem className="min-h-11" key={tag} onSelect={() => { selectedActionRef.current = () => onTagClick(tag) }}>Filter by {tag}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  )
}

const MemoizedRecipeCard = memo(RecipeCard)
export { MemoizedRecipeCard as RecipeCard }
