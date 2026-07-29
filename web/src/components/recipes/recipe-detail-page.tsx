"use client"

import { type MouseEvent, useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  Clock,
  Heart,
  History,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Printer,
  Share2,
  ShoppingCart,
  Trash2,
  Users,
  UtensilsCrossed,
} from "lucide-react"
import { AuthForm } from "@/components/auth/auth-form"
import { BottomNav } from "@/components/layout/bottom-nav"
import { Header } from "@/components/layout/header"
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
import {
  useCategories,
  useDeleteRecipe,
  useRecipe,
  useToggleFavorite,
} from "@/hooks/use-recipes"
import {
  useMarkRecipeAsMade,
  useRecipeHistoryStats,
  useUnmarkRecipeAsMade,
} from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import {
  formatRecipeTime,
  getRecipeIngredientGroups,
  getRecipeInstructionGroups,
  getRecipeNotes,
} from "@/lib/recipe-structure"
import {
  getRecipeDetailReturnSource,
  returnFromRecipeDetail,
  type RecipeDetailSource,
} from "@/lib/recipe-detail-navigation"
import { parseIngredientAmountInput } from "@/lib/recipe-parser"
import { getIngredientDisplayUnit } from "@/lib/ingredient-units"
import { getRecipeStatsMap } from "@/lib/recipe-history-stats"
import { formatShoppingAddMessage } from "@/lib/shopping-feedback"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import { getTagClassName } from "@/lib/tag-colors"
import { useAuthContext } from "@/lib/auth-context"
import { persistHomeTab } from "@/lib/home-navigation"
import { cn, getErrorMessage, toFraction } from "@/lib/utils"
import type { HomeTab } from "@/app/home-tab-state"
import { isValidHomeTab } from "@/app/home-tab-state"
import type { Ingredient, Recipe } from "@/types/database"
import { AddToPlanDialog } from "./add-to-plan-dialog"
import { RecipeDialog } from "./recipe-dialog"
import { ShareRecipeDialog } from "./share-recipe-dialog"

const SHOPPING_ITEM_LABEL = {
  singular: "shopping item",
  plural: "shopping items",
}

interface RecipeDetailPageProps {
  recipeId: string
  originToken?: string
}

interface RecipeDetailContentProps {
  recipe: Recipe
  returnLabel?: string
  lastMade?: string | null
  timesMade?: number
  onBack: () => void
  onDelete: () => void
  onEdit: () => void
  onFavorite: () => void
  onMarkMade: () => void
  onAddToPlan: () => void
  onAddToShopping: () => void
  onShare: () => void
  isDeleting?: boolean
  isFavoritePending?: boolean
  isMarkingMade?: boolean
  isAddingToShopping?: boolean
}

const UNICODE_QUANTITY_FRACTIONS = "½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞"
const QUANTITY_ENDPOINT = String.raw`(?:\d+\s+\d+\/\d+|\d+[${UNICODE_QUANTITY_FRACTIONS}]|[${UNICODE_QUANTITY_FRACTIONS}]|\d+\/\d+|\d+(?:\.\d+)?)`
const SCALABLE_QUANTITY_PATTERN = new RegExp(
  String.raw`^(\s*(?:(?:about|approx\.?|approximately|around)\s+)?)(${QUANTITY_ENDPOINT})(?:(\s*[-–—]\s*)(${QUANTITY_ENDPOINT}))?([^\d/${UNICODE_QUANTITY_FRACTIONS}–—-]*)$`,
  "i"
)

const RECIPE_RETURN_LABELS: Record<RecipeDetailSource, string> = {
  planner: "Back to planner",
  recipes: "Back to recipes",
  shopping: "Back to shopping",
}

function scaleQuantityEndpoint(endpoint: string, scale: number): string | null {
  const fraction = endpoint.match(/\/(\d+)$/)
  if (fraction && Number(fraction[1]) === 0) return null

  const parsed = parseIngredientAmountInput(endpoint)
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null

  const scaled = Math.round(parsed * scale * 10_000) / 10_000
  return toFraction(scaled)
}

export function scaleIngredientAmount(
  amount: Ingredient["amount"],
  originalServings: number,
  selectedServings: number
): Ingredient["amount"] {
  if (originalServings <= 0) return amount

  const scale = selectedServings / originalServings

  if (typeof amount === "string") {
    const quantity = amount.match(SCALABLE_QUANTITY_PATTERN)
    if (!quantity) return amount

    const start = scaleQuantityEndpoint(quantity[2], scale)
    if (start == null) return amount

    if (!quantity[4]) {
      return `${quantity[1]}${start}${quantity[5]}`
    }

    const end = scaleQuantityEndpoint(quantity[4], scale)
    if (end == null) return amount

    return `${quantity[1]}${start}${quantity[3]}${end}${quantity[5]}`
  }

  if (typeof amount !== "number") return amount

  return Math.round(
    amount * scale * 10_000
  ) / 10_000
}

function RecipeDetailState({
  title,
  message,
  onBack,
  returnLabel,
  onRetry,
}: {
  title: string
  message: string
  onBack: () => void
  returnLabel: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md rounded-3xl border bg-card p-8 text-center shadow-sm">
        <UtensilsCrossed className="mx-auto mb-4 h-10 w-10 text-primary/50" />
        <h1 className="font-display text-3xl font-bold text-primary">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {returnLabel}
          </Button>
          {onRetry ? (
            <Button type="button" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function RecipeDetailLoading() {
  return (
    <div
      className="mx-auto w-full max-w-7xl animate-pulse px-4 py-5 sm:px-6 lg:px-8"
      aria-label="Loading recipe"
    >
      <div className="mb-5 h-10 w-36 rounded-full bg-stone-100" />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-center">
        <div className="aspect-[4/3] rounded-3xl bg-stone-100" />
        <div className="space-y-4">
          <div className="h-8 w-24 rounded-full bg-stone-100" />
          <div className="h-14 w-4/5 rounded-2xl bg-stone-100" />
          <div className="h-5 w-3/5 rounded bg-stone-100" />
          <div className="h-11 w-full rounded-2xl bg-stone-100" />
        </div>
      </div>
    </div>
  )
}

export function RecipeDetailContent({
  recipe,
  returnLabel = RECIPE_RETURN_LABELS.recipes,
  lastMade,
  timesMade = 0,
  onBack,
  onDelete,
  onEdit,
  onFavorite,
  onMarkMade,
  onAddToPlan,
  onAddToShopping,
  onShare,
  isDeleting = false,
  isFavoritePending = false,
  isMarkingMade = false,
  isAddingToShopping = false,
}: RecipeDetailContentProps) {
  const [servings, setServings] = useState(recipe.servings)

  const handleSectionNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()

    const hash = event.currentTarget.getAttribute("href")
    if (!hash?.startsWith("#")) return

    const section = document.getElementById(hash.slice(1))
    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "start" })
    }

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`
    )
  }
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  const ingredientGroups = getRecipeIngredientGroups(recipe.ingredients)
  const ingredientCount = ingredientGroups.reduce(
    (count, group) => count + group.ingredients.length,
    0
  )
  const instructionGroups = getRecipeInstructionGroups(recipe)
  const notes = getRecipeNotes(recipe)
  const timeChips = [
    { label: "Prep", value: formatRecipeTime(recipe.prep_time_minutes) },
    { label: "Cook", value: formatRecipeTime(recipe.cook_time_minutes) },
    { label: "Total", value: formatRecipeTime(recipe.total_time_minutes) },
  ].filter((chip) => !!chip.value)

  let instructionNumber = 0

  return (
    <article
      className="recipe-detail-page mx-auto w-full max-w-7xl px-4 pb-[calc(var(--bottom-nav-safe-height)+2rem)] pt-4 sm:px-6 md:pb-10 md:pt-6 lg:px-8"
      data-testid="recipe-detail-page"
    >
      <div className="recipe-detail-print-hidden mb-4 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="-ml-3 min-h-11 rounded-full px-3 text-stone-600 hover:bg-stone-100 hover:text-primary"
          aria-label={returnLabel}
        >
          <ArrowLeft className="mr-2 h-5 w-5" />
          {returnLabel}
        </Button>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
          Recipe
        </span>
      </div>

      <div className="grid gap-5 md:gap-7 lg:grid-cols-[minmax(0,1.06fr)_minmax(22rem,0.94fr)] lg:items-center">
        <div className="relative aspect-[4/3] max-h-[32rem] overflow-hidden rounded-3xl bg-card-cream shadow-sm ring-1 ring-stone-200/70">
          {recipeImageUrl ? (
            <Image
              src={recipeImageUrl}
              alt={`${recipe.name} recipe`}
              fill
              priority
              className="object-cover"
              sizes="(max-width: 1023px) 100vw, 55vw"
              unoptimized={!recipeImageUrl.includes("supabase.co")}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <UtensilsCrossed
                className="h-20 w-20 text-stone-300/70"
                aria-hidden="true"
              />
            </div>
          )}
        </div>

        <div className="min-w-0 lg:px-2">
          <div className="flex flex-wrap gap-2">
            {recipe.category ? (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold capitalize",
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
                  "rounded-full px-3 py-1 text-xs font-medium",
                  getTagClassName(tag, false)
                )}
              >
                {tag}
              </span>
            ))}
          </div>

          <h1 className="mt-4 break-words font-display text-4xl font-bold leading-[0.98] tracking-[-0.025em] text-primary sm:text-5xl lg:text-6xl">
            {recipe.name}
          </h1>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-600">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4 text-secondary" aria-hidden="true" />
              {servings} {servings === 1 ? "serving" : "servings"}
            </span>
            {timesMade > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <History className="h-4 w-4 text-secondary" aria-hidden="true" />
                Made {timesMade} time{timesMade === 1 ? "" : "s"}
                {lastMade
                  ? ` · Last ${new Date(lastMade).toLocaleDateString()}`
                  : ""}
              </span>
            ) : null}
          </div>

          {timeChips.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {timeChips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700"
                >
                  <Clock className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />
                  {chip.label} {chip.value}
                </span>
              ))}
            </div>
          ) : null}

          <div className="recipe-detail-print-hidden mt-6 flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={onMarkMade}
              disabled={isMarkingMade}
              className="min-h-11 rounded-full px-5"
            >
              {isMarkingMade ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Mark made
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onFavorite}
              disabled={isFavoritePending}
              className="min-h-11 rounded-full px-4"
              aria-label={
                recipe.favorite ? "Remove from favorites" : "Add to favorites"
              }
            >
              {isFavoritePending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Heart
                  className={cn(
                    "mr-2 h-4 w-4",
                    recipe.favorite && "fill-terracotta-500 text-terracotta-500"
                  )}
                />
              )}
              {recipe.favorite ? "Favorited" : "Favorite"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onEdit}
              className="min-h-11 rounded-full px-4"
              aria-label="Edit Recipe"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          </div>

          <div className="recipe-detail-print-hidden mt-2 flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAddToPlan}
              className="min-h-11 rounded-full px-3 text-stone-600"
            >
              <CalendarPlus className="mr-2 h-4 w-4" />
              Add to plan
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAddToShopping}
              disabled={isAddingToShopping}
              className="min-h-11 rounded-full px-3 text-stone-600"
              aria-label="Add to Shopping List"
            >
              {isAddingToShopping ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="mr-2 h-4 w-4" />
              )}
              Shopping
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onShare}
              className="min-h-11 rounded-full px-3 text-stone-600"
            >
              <Share2 className="mr-2 h-4 w-4" />
              Share
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => window.print()}
              className="min-h-11 rounded-full px-3 text-stone-600"
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
          </div>
        </div>
      </div>

      <nav
        className="recipe-detail-print-hidden sticky top-0 z-30 -mx-4 mt-5 border-y border-stone-200/80 bg-background/95 px-4 py-2 backdrop-blur-md md:hidden"
        aria-label="Recipe sections"
      >
        <div className="grid grid-cols-3 gap-1">
          {[
            ["Ingredients", "#ingredients"],
            ["Instructions", "#instructions"],
            ["Notes", "#notes"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={handleSectionNavigation}
              className="rounded-full px-2 py-2.5 text-center text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-100 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="mt-8 grid gap-10 border-t border-stone-200/80 pt-8 md:grid-cols-12 md:gap-12 lg:mt-10 lg:pt-10">
        <section
          id="ingredients"
          aria-labelledby="ingredients-heading"
          className="scroll-mt-20 md:col-span-5 lg:col-span-4"
        >
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
                What you need
              </p>
              <h2
                id="ingredients-heading"
                className="mt-1 font-display text-3xl font-bold text-primary"
              >
                Ingredients
                <span
                  aria-hidden="true"
                  className="ml-2 font-sans text-sm font-medium text-stone-400"
                >
                  {ingredientCount}
                </span>
              </h2>
            </div>
            <div
              className="recipe-detail-print-hidden flex items-center rounded-full border border-stone-200 bg-white p-1"
              aria-label="Adjust servings"
            >
              <button
                type="button"
                onClick={() => setServings((value) => Math.max(1, value - 1))}
                disabled={servings <= 1}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 disabled:opacity-35"
                aria-label="Decrease servings"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span
                className="min-w-16 px-1 text-center text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {servings} servings
              </span>
              <button
                type="button"
                onClick={() => setServings((value) => Math.min(99, value + 1))}
                disabled={servings >= 99}
                className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 disabled:opacity-35"
                aria-label="Increase servings"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className="recipe-detail-print-only hidden text-sm text-stone-500">
              {servings} servings
            </span>
          </div>

          {ingredientGroups.length > 0 ? (
            <div className="space-y-7">
              {ingredientGroups.map((group, groupIndex) => (
                <section
                  key={`${group.label || "main"}-${groupIndex}`}
                  data-ingredient-group={group.label || ""}
                >
                  {group.label ? (
                    <h3 className="mb-3 break-words text-sm font-semibold text-primary">
                      {group.label}
                    </h3>
                  ) : null}
                  <ul className="space-y-3">
                    {group.ingredients.map((ingredient, index) => {
                      const scaledAmount = scaleIngredientAmount(
                        ingredient.amount,
                        recipe.servings,
                        servings
                      )
                      const displayUnit = getIngredientDisplayUnit(ingredient.unit)
                      const displayAmount =
                        typeof scaledAmount === "string"
                          ? scaledAmount
                          : toFraction(scaledAmount)
                      const quantityText =
                        scaledAmount != null
                          ? `${displayAmount}${
                              displayUnit ? ` ${displayUnit}` : ""
                            }`
                          : "As needed"

                      return (
                        <li
                          key={`${groupIndex}-${index}`}
                          className="grid grid-cols-[minmax(4.25rem,auto)_1fr] items-start gap-x-3 border-b border-stone-100 pb-3 text-stone-700 last:border-b-0"
                        >
                          <span className="pt-0.5 text-right text-sm tabular-nums text-stone-500">
                            {quantityText}
                          </span>
                          <span className="min-w-0 text-sm font-semibold leading-6 text-stone-900">
                            {ingredient.item}
                            {ingredient.alternatives?.length ? (
                              <span className="font-normal text-stone-600">
                                {" or "}
                                {ingredient.alternatives.join(" or ")}
                              </span>
                            ) : null}
                            {ingredient.modifier ? (
                              <span className="font-normal text-stone-500">
                                , {ingredient.modifier}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No ingredients available.
            </p>
          )}
        </section>

        <section
          id="instructions"
          aria-labelledby="instructions-heading"
          className="scroll-mt-20 md:col-span-7 lg:col-span-8"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
            How to make it
          </p>
          <h2
            id="instructions-heading"
            className="mt-1 font-display text-3xl font-bold text-primary"
          >
            Instructions
          </h2>

          {instructionGroups.length > 0 ? (
            <div className="mt-6 space-y-9">
              {instructionGroups.map((group, groupIndex) => {
                const start = instructionNumber + 1
                instructionNumber += group.steps.length

                return (
                  <section key={`${group.label || "main"}-${groupIndex}`}>
                    {group.label ? (
                      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
                        {group.label}
                      </h3>
                    ) : null}
                    <ol start={start} className="space-y-5">
                      {group.steps.map((step, stepIndex) => (
                        <li
                          key={`${groupIndex}-${stepIndex}`}
                          value={start + stepIndex}
                          className="grid grid-cols-[2.25rem_1fr] items-start gap-x-4"
                        >
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                            aria-hidden="true"
                          >
                            {start + stepIndex}
                          </span>
                          <p className="min-w-0 pt-1 leading-7 text-stone-700">
                            {step}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>
                )
              })}
            </div>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              No instructions available.
            </p>
          )}
        </section>
      </div>

      <section
        id="notes"
        aria-labelledby="notes-heading"
        className="scroll-mt-20 mt-10 border-t border-stone-200/80 pt-8"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-secondary">
          Keep in mind
        </p>
        <h2
          id="notes-heading"
          className="mt-1 font-display text-3xl font-bold text-primary"
        >
          Notes
        </h2>
        {notes.length > 0 ? (
          <ul className="mt-5 grid gap-3 md:grid-cols-2">
            {notes.map((note, index) => (
              <li
                key={index}
                className="rounded-2xl border border-stone-100 bg-stone-50 px-5 py-4 text-sm leading-6 text-stone-700"
              >
                {note}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No notes for this recipe.
          </p>
        )}
      </section>

      <div className="recipe-detail-print-hidden mt-10 flex justify-end border-t border-stone-200/80 pt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onDelete}
          disabled={isDeleting}
          className="min-h-11 border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {isDeleting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete recipe
        </Button>
      </div>
    </article>
  )
}

export function RecipeDetailPage({
  recipeId,
  originToken,
}: RecipeDetailPageProps) {
  const router = useRouter()
  const { user, loading: authLoading, signOut, isAuthenticated } =
    useAuthContext()
  const recipeQuery = useRecipe(recipeId)
  const { data: categories } = useCategories()
  const { data: historyStats } = useRecipeHistoryStats()
  const toggleFavorite = useToggleFavorite()
  const deleteRecipe = useDeleteRecipe()
  const markAsMade = useMarkRecipeAsMade()
  const unmarkAsMade = useUnmarkRecipeAsMade()
  const addToShopping = useAddToShoppingList()
  const { show: showToast } = useUndoToast()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isAddToPlanOpen, setIsAddToPlanOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [returnSource, setReturnSource] =
    useState<RecipeDetailSource | null>(null)
  const returnLabel =
    RECIPE_RETURN_LABELS[returnSource ?? "recipes"]
  const statsMap = useMemo(
    () => getRecipeStatsMap(historyStats),
    [historyStats]
  )
  const stats = statsMap.get(recipeId)

  useEffect(() => {
    setReturnSource(
      getRecipeDetailReturnSource(recipeId, originToken ?? null)
    )
  }, [originToken, recipeId])

  const handleReturn = () => {
    returnFromRecipeDetail(
      router,
      recipeId,
      originToken ?? null
    )
  }

  const handleTabChange = (tab: string) => {
    if (!isValidHomeTab(tab)) return
    persistHomeTab(tab)
    router.push("/")
  }

  const handleFavorite = async () => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      await toggleFavorite.mutateAsync({
        id: recipe.id,
        favorite: !!recipe.favorite,
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(error, "Failed to update favorite"),
      })
    }
  }

  const handleMarkMade = async () => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      await markAsMade.mutateAsync(recipe.id)
      showToast({
        message: `"${recipe.name}" marked as made`,
        onUndo: () => unmarkAsMade.mutate(recipe.id),
        onExpire: () => undefined,
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(error, "Failed to mark recipe as made"),
      })
    }
  }

  const handleAddToShopping = async () => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      const result = await addToShopping.mutateAsync({
        recipeIds: [recipe.id],
        scale: 1,
      })
      showToast({
        message: formatShoppingAddMessage(result, {
          sourceName: recipe.name,
          itemLabel: SHOPPING_ITEM_LABEL,
          zeroMessage: `All shopping items from "${recipe.name}" are already on the shopping list`,
        }),
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(
          error,
          "Failed to add ingredients to shopping list"
        ),
      })
    }
  }

  const handleDelete = async () => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      await deleteRecipe.mutateAsync(recipe.id)
      setShowDeleteConfirm(false)
      showToast({ message: `"${recipe.name}" deleted` })
      handleReturn()
    } catch (error) {
      showToast({
        message: getErrorMessage(error, `Failed to delete "${recipe.name}"`),
        duration: 4000,
      })
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <AuthForm />
      </main>
    )
  }

  const errorCode = (recipeQuery.error as { code?: string } | null)?.code
  const isMissing = recipeQuery.isSuccess && !recipeQuery.data

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background md:pt-[var(--header-height)]">
      <div className="recipe-detail-print-hidden">
        <Header
          userEmail={user?.email}
          onSignOut={signOut}
          activeTab={returnSource ?? "recipes"}
          onTabChange={handleTabChange}
        />
      </div>

      <div className="recipe-detail-scroll flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-smooth scrollbar-thin">
        {recipeQuery.isLoading ? <RecipeDetailLoading /> : null}
        {recipeQuery.isError ? (
          <RecipeDetailState
            title={errorCode === "PGRST116" ? "Recipe not found" : "Couldn’t load recipe"}
            message={
              errorCode === "PGRST116"
                ? "This recipe may have been removed or is not available to this account."
                : "Something went wrong while loading this recipe."
            }
            onBack={handleReturn}
            returnLabel={returnLabel}
            onRetry={() => void recipeQuery.refetch()}
          />
        ) : null}
        {isMissing ? (
          <RecipeDetailState
            title="Recipe not found"
            message="This recipe may have been removed or is not available to this account."
            onBack={handleReturn}
            returnLabel={returnLabel}
          />
        ) : null}
        {recipeQuery.data ? (
          <RecipeDetailContent
            key={`${recipeQuery.data.id}:${recipeQuery.data.updated_at ?? ""}`}
            recipe={recipeQuery.data}
            returnLabel={returnLabel}
            lastMade={stats?.lastMade ?? null}
            timesMade={stats?.timesMade ?? 0}
            onBack={handleReturn}
            onDelete={() => setShowDeleteConfirm(true)}
            onEdit={() => setIsEditOpen(true)}
            onFavorite={() => void handleFavorite()}
            onMarkMade={() => void handleMarkMade()}
            onAddToPlan={() => setIsAddToPlanOpen(true)}
            onAddToShopping={() => void handleAddToShopping()}
            onShare={() => setIsShareOpen(true)}
            isDeleting={deleteRecipe.isPending}
            isFavoritePending={toggleFavorite.isPending}
            isMarkingMade={markAsMade.isPending}
            isAddingToShopping={addToShopping.isPending}
          />
        ) : null}
      </div>

      <div className="recipe-detail-print-hidden">
        <BottomNav
          activeTab={returnSource ?? "recipes"}
          onTabChange={handleTabChange}
        />
      </div>

      <RecipeDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        recipeId={recipeId}
        categories={categories || []}
      />
      <ShareRecipeDialog
        open={isShareOpen}
        onOpenChange={setIsShareOpen}
        recipeId={recipeId}
      />
      <AddToPlanDialog
        open={isAddToPlanOpen}
        onOpenChange={setIsAddToPlanOpen}
        recipeId={recipeId}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{recipeQuery.data?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteRecipe.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleteRecipe.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRecipe.isPending ? (
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
    </main>
  )
}
