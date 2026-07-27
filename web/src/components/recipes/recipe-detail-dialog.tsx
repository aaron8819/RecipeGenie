"use client"

import Image from "next/image"
import { Heart, Pencil, Trash2, X, History, UtensilsCrossed, Check, Share2, CalendarPlus, ShoppingCart, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useRecipe, useToggleFavorite } from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"
import { cn, toFraction } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"
import { useState } from "react"
import {
  formatRecipeTime,
  getRecipeIngredientGroups,
  getRecipeInstructionGroups,
  getRecipeNotes,
} from "@/lib/recipe-structure"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import { getIngredientDisplayUnit } from "@/lib/ingredient-units"

interface RecipeDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipeId?: string | null
  recipe?: Recipe | null
  onEdit?: (recipe: Recipe) => void
  onDelete?: (recipe: Recipe) => Promise<boolean> | boolean | void
  onShare?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onAddToShoppingList?: (recipe: Recipe) => void
  onMarkAsMade?: (recipe: Recipe) => void
  lastMade?: string | null
  timesMade?: number
  isAddingToPlan?: boolean
  isAddingToShoppingList?: boolean
  isMarkingAsMade?: boolean
  isSharing?: boolean
}

const HEADER_PRIMARY_BUTTON_CLASS =
  "h-9 rounded-full px-3.5 text-sm font-semibold shadow-sm"

const HEADER_SECONDARY_BUTTON_CLASS =
  "h-9 justify-center gap-2 rounded-full px-4 text-sm font-semibold"

const HEADER_SECONDARY_OUTLINE_CLASS =
  "border-stone-300/80 bg-background text-stone-700 hover:bg-stone-100 hover:text-primary dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-200 dark:hover:bg-stone-800"

const HEADER_TERTIARY_BUTTON_CLASS =
  "h-8 justify-start gap-1.5 rounded-full px-2.5 text-xs font-medium text-stone-600 hover:bg-stone-100 hover:text-primary dark:text-stone-300 dark:hover:bg-stone-800"

interface RecipeDetailHeaderProps {
  recipe: Recipe
  recipeImageUrl: string | null
  timesMade: number
  lastMade?: string | null
  onMarkAsMade?: (recipe: Recipe) => void
  onEdit?: (recipe: Recipe) => void
  onShare?: (recipe: Recipe) => void
  onAddToPlan?: (recipe: Recipe) => void
  onAddToShoppingList?: (recipe: Recipe) => void
  onToggleFavorite: () => void
  isAddingToPlan?: boolean
  isAddingToShoppingList?: boolean
  isMarkingAsMade?: boolean
  isSharing?: boolean
}

function RecipeDetailHeader({
  recipe,
  recipeImageUrl,
  timesMade,
  lastMade,
  onMarkAsMade,
  onEdit,
  onShare,
  onAddToPlan,
  onAddToShoppingList,
  onToggleFavorite,
  isAddingToPlan = false,
  isAddingToShoppingList = false,
  isMarkingAsMade = false,
  isSharing = false,
}: RecipeDetailHeaderProps) {
  const hasTertiaryActions = !!(onShare || onAddToPlan || onAddToShoppingList)
  const timeChips = [
    { label: "Prep", value: formatRecipeTime(recipe.prep_time_minutes) },
    { label: "Cook", value: formatRecipeTime(recipe.cook_time_minutes) },
    { label: "Total", value: formatRecipeTime(recipe.total_time_minutes) },
  ].filter((chip) => !!chip.value)

  return (
    <>
      <div className="sticky top-3 z-20 h-0">
        <div className="flex justify-end px-4">
          <DialogClose asChild>
            <button
              type="button"
              className="pointer-events-auto rounded-full bg-white/90 p-1.5 text-stone-800 shadow-md backdrop-blur-md transition-colors hover:bg-white dark:bg-black/50 dark:text-stone-200 dark:hover:bg-black/60"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>
      </div>

      <div className="p-3 pb-0 sm:p-6 sm:pb-0">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-card-cream sm:rounded-[24px] dark:bg-zinc-800">
          {recipeImageUrl ? (
            <Image
              src={recipeImageUrl}
              alt={recipe.name}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 672px"
              unoptimized={!recipeImageUrl.includes("supabase.co")}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <UtensilsCrossed className="h-16 w-16 text-stone-300 opacity-40 dark:text-zinc-600" />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 pt-6 sm:px-8 sm:pt-8">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            <h1 className="mb-3 text-3xl font-display font-bold leading-[0.9] tracking-[-0.02em] text-primary md:text-4xl dark:text-stone-100">
              {recipe.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-[0.95rem]">
              {recipe.category ? (
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold capitalize md:text-sm",
                    getTagClassName(recipe.category, true)
                  )}
                >
                  {recipe.category}
                </span>
              ) : null}
              {recipe.tags?.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium md:text-sm",
                    getTagClassName(tag, false)
                  )}
                >
                  {tag}
                </span>
              ))}
              {timesMade > 0 ? (
                <div className="flex items-center text-sm text-stone-400 dark:text-stone-500">
                  <History className="mr-1 h-4 w-4 shrink-0" />
                  <span>
                    Made {timesMade} time{timesMade !== 1 ? "s" : ""}
                    {lastMade ? ` - Last: ${new Date(lastMade).toLocaleDateString()}` : ""}
                  </span>
                </div>
              ) : null}
            </div>
            {timeChips.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {timeChips.map((chip) => (
                  <span
                    key={chip.label}
                    className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700 dark:bg-zinc-800 dark:text-stone-200"
                  >
                    {chip.label} {chip.value}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:max-w-[28rem] lg:justify-self-end lg:justify-end">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onToggleFavorite}
              className="h-9 w-9 rounded-full border-stone-300/80 bg-background text-stone-500 hover:bg-stone-100 hover:text-terracotta-500 dark:border-stone-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-stone-800 dark:hover:text-terracotta-400"
              aria-label={recipe.favorite ? "Remove from favorites" : "Add to favorites"}
            >
              <Heart
                className={cn(
                  "h-5 w-5",
                  !!recipe.favorite
                    ? "fill-terracotta-500 text-terracotta-500"
                    : "text-current"
                )}
              />
            </Button>

            {onMarkAsMade ? (
              <Button
                onClick={() => onMarkAsMade(recipe)}
                disabled={isMarkingAsMade}
                className={cn("gap-2.5", HEADER_PRIMARY_BUTTON_CLASS)}
                aria-label="Mark Made"
              >
                {isMarkingAsMade ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Mark Made
              </Button>
            ) : null}

            {onEdit ? (
              <Button
                variant="outline"
                onClick={() => onEdit(recipe)}
                className={cn(HEADER_SECONDARY_BUTTON_CLASS, HEADER_SECONDARY_OUTLINE_CLASS)}
                aria-label="Edit Recipe"
              >
                <Pencil className="h-4 w-4" />
                <span aria-hidden="true">Edit</span>
              </Button>
            ) : null}
          </div>
        </div>

        {hasTertiaryActions ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-stone-200/80 pt-2 dark:border-stone-800">
            {onShare ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onShare(recipe)}
                disabled={isSharing}
                className={HEADER_TERTIARY_BUTTON_CLASS}
                title="Share"
              >
                {isSharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-4 w-4" />
                )}
                Share
              </Button>
            ) : null}

            {onAddToPlan ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddToPlan(recipe)}
                disabled={isAddingToPlan}
                className={HEADER_TERTIARY_BUTTON_CLASS}
                aria-label="Add to Plan"
              >
                {isAddingToPlan ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="h-4 w-4" />
                )}
                <span aria-hidden="true">Plan</span>
              </Button>
            ) : null}

            {onAddToShoppingList ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAddToShoppingList(recipe)}
                disabled={isAddingToShoppingList}
                className={HEADER_TERTIARY_BUTTON_CLASS}
                aria-label="Add to Shopping List"
              >
                {isAddingToShoppingList ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShoppingCart className="h-4 w-4" />
                )}
                <span aria-hidden="true">Shopping</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        <hr className="mt-4 border-stone-200/70 dark:border-stone-800/70" />
      </div>
    </>
  )
}

export function RecipeDetailDialog({
  open,
  onOpenChange,
  recipeId,
  recipe: initialRecipe = null,
  onEdit,
  onDelete,
  onShare,
  onAddToPlan,
  onAddToShoppingList,
  onMarkAsMade,
  lastMade,
  timesMade = 0,
  isAddingToPlan = false,
  isAddingToShoppingList = false,
  isMarkingAsMade = false,
  isSharing = false,
}: RecipeDetailDialogProps) {
  const toggleFavorite = useToggleFavorite()
  const resolvedRecipeId = recipeId ?? initialRecipe?.id ?? null
  const { data: liveRecipe } = useRecipe(open ? resolvedRecipeId : null)
  const recipe = liveRecipe ?? initialRecipe
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const recipeImageUrl = recipe ? getRecipeImageUrl(recipe.image_url) : null
  const ingredientGroups = getRecipeIngredientGroups(recipe?.ingredients)
  const ingredientCount = ingredientGroups.reduce(
    (count, group) => count + group.ingredients.length,
    0
  )
  const instructionGroups = recipe ? getRecipeInstructionGroups(recipe) : []
  const notes = recipe ? getRecipeNotes(recipe) : []

  const handleDelete = async () => {
    if (onDelete && recipe) {
      setIsDeleting(true)
      try {
        const deleted = await onDelete(recipe)
        if (deleted !== false) {
          setShowDeleteConfirm(false)
          onOpenChange(false)
        }
      } finally {
        setIsDeleting(false)
      }
    }
  }

  if (!recipe) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="relative max-w-3xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-2xl sm:rounded-[32px] bg-card overflow-x-hidden overflow-y-auto scrollbar-recipe-dialog !top-2 !translate-y-0 !max-h-[calc(100dvh-1rem)] md:!top-6 md:!translate-y-0 md:!max-h-[calc(100dvh-3rem)]"
      >
        <DialogTitle className="sr-only">{recipe.name}</DialogTitle>
        <div>
          <RecipeDetailHeader
            recipe={recipe}
            recipeImageUrl={recipeImageUrl}
            timesMade={timesMade}
            lastMade={lastMade}
            onMarkAsMade={onMarkAsMade}
            onEdit={onEdit}
            onShare={onShare}
            onAddToPlan={onAddToPlan}
            onAddToShoppingList={onAddToShoppingList}
            onToggleFavorite={() =>
              toggleFavorite.mutate({ id: recipe.id, favorite: !!recipe.favorite })
            }
            isAddingToPlan={isAddingToPlan}
            isAddingToShoppingList={isAddingToShoppingList}
            isMarkingAsMade={isMarkingAsMade}
            isSharing={isSharing}
          />
          {/* Ingredients | Instructions - 2-col grid */}
          <div className="px-4 sm:px-8 pb-12 grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12">
            <section
              aria-labelledby="recipe-ingredients-heading"
              className="min-w-0 md:col-span-4"
            >
              <div className="flex items-center justify-between mb-6">
                <h2
                  id="recipe-ingredients-heading"
                  className="text-xl font-bold text-primary dark:text-stone-200"
                >
                  Ingredients{" "}
                  <span className="text-sm font-medium text-stone-500 dark:text-stone-400">
                    ({ingredientCount})
                  </span>
                </h2>
                <span className="text-stone-500 dark:text-stone-400 text-sm">
                  {recipe.servings} {recipe.servings === 1 ? "serving" : "servings"}
                </span>
              </div>
              {ingredientGroups.length > 0 ? (
                <div className="space-y-7">
                  {ingredientGroups.map((group, groupIndex) => (
                    <section
                      key={`${group.label || "main"}-${groupIndex}`}
                      data-ingredient-group={group.label || ""}
                      className="min-w-0"
                    >
                      {group.label ? (
                        <h3 className="mb-3 min-w-0 break-words text-sm font-semibold leading-5 text-primary dark:text-stone-300">
                          {group.label}
                        </h3>
                      ) : null}
                      <ul className="space-y-4">
                        {group.ingredients.map((ingredient, index) => {
                          const displayUnit = getIngredientDisplayUnit(ingredient.unit)
                          const displayAmount = typeof ingredient.amount === "string"
                            ? ingredient.amount
                            : toFraction(ingredient.amount)
                          const quantityText = ingredient.amount != null
                            ? `${displayAmount}${displayUnit ? ` ${displayUnit}` : ""}`
                            : "—"

                          return (
                            <li
                              key={`${groupIndex}-${index}`}
                              className="grid grid-cols-[minmax(3.75rem,auto)_1fr] items-start gap-x-3 text-stone-700 dark:text-stone-300"
                            >
                              <span className="pt-0.5 text-right text-sm font-normal tabular-nums text-stone-500 dark:text-stone-400">
                                {quantityText}
                              </span>
                              <span className="min-w-0 text-sm font-semibold leading-6 text-stone-900 dark:text-stone-100">
                                {ingredient.item}
                                {ingredient.alternatives && ingredient.alternatives.length > 0 && (
                                  <span className="font-normal text-stone-600 dark:text-stone-400">
                                    {" or "}
                                    {ingredient.alternatives.join(" or ")}
                                  </span>
                                )}
                                {ingredient.modifier && (
                                  <span className="font-normal text-stone-500 dark:text-stone-400">, {ingredient.modifier}</span>
                                )}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No ingredients available.</p>
              )}
            </section>
            <div className="md:col-span-8">
              <h2 className="text-xl font-bold text-primary dark:text-stone-200 mb-6">Instructions</h2>
              {instructionGroups.length > 0 ? (
                <div className="space-y-10">
                  {(() => {
                    let stepNumber = 0

                    return instructionGroups.map((group, groupIndex) => (
                      <div key={`${group.label || "main"}-${groupIndex}`} className="space-y-6">
                        {group.label ? (
                          <div className="pt-2">
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                              {group.label}
                            </h3>
                          </div>
                        ) : null}
                        {group.steps.map((step, stepIndex) => {
                          stepNumber += 1

                          return (
                            <div
                              key={`${groupIndex}-${stepIndex}`}
                              className="grid grid-cols-[2rem_1fr] items-start gap-x-4"
                            >
                              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                                {stepNumber}
                              </span>
                              <p className="min-w-0 leading-7 text-stone-700 dark:text-stone-300">{step}</p>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  })()}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No instructions available.</p>
              )}
              {notes.length > 0 ? (
                <div className="mt-10">
                  <h2 className="mb-4 text-xl font-bold text-primary dark:text-stone-200">Notes</h2>
                  <ul className="space-y-3">
                    {notes.map((note, index) => (
                      <li
                        key={index}
                        className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700 dark:bg-zinc-900 dark:text-stone-300"
                      >
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          {/* Delete */}
          {onDelete && (
            <div className="px-4 sm:px-8 pb-8 pt-2 border-t border-stone-200 dark:border-stone-800 flex justify-end">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Recipe
              </Button>
            </div>
          )}
        </div>
      </DialogContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{recipe.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

