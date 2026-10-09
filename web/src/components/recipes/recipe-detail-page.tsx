"use client"

import { type MouseEvent, type Ref, useEffect, useMemo, useRef, useState } from "react"
import "./recipe-detail.css"
import Image from "next/image"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  ChevronDown,
  Heart,
  Loader2,
  Minus,
  Pencil,
  Plus,
  Copy,
  MoreHorizontal,
  Share2,
  ShoppingCart,
  Trash2,
  UtensilsCrossed
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { recipePlainText, readableRecipeQuantity } from '@/lib/recipe-plain-text'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Button } from "@/components/ui/button"
import {
  useCategories,
  useDeleteRecipe,
  useRecipe,
  useToggleFavorite
} from "@/hooks/use-recipes"
import {
  useMarkRecipeAsMade,
  useRecipeHistoryStats,
  useUnmarkRecipeAsMade
} from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import {
  flattenRecipeIngredients,
  formatRecipeTime,
  normalizeRecipeNotes
} from "@/lib/recipe-structure"
import {
  returnFromRecipeDetail,
  type RecipeDetailSource
} from "@/lib/recipe-detail-navigation"
import {
  assertRecipeScalingFeasible,
  formatRecipeQuantity,
  getAuthoredYieldText,
  getScalingBasis,
  getSelectedYieldText,
} from "@/lib/recipe-quantity"
export { scaleIngredientAmount } from "@/lib/recipe-quantity"
import { getRecipeStatsMap } from "@/lib/recipe-history-stats"
import { formatShoppingAddMessage } from "@/lib/shopping-feedback"
import { getRecipeImageUrl } from "@/lib/supabase/storage"
import { getErrorMessage } from "@/lib/utils"
import type { Recipe } from "@/types/database"
import { AddToPlanDialog } from "./add-to-plan-dialog"
import { ShoppingSelectionDialog } from "@/components/shopping/shopping-selection-dialog"
import type { ShoppingRecipeSelection } from "@/lib/shopping-selection"
import { RecipeDialog } from "./recipe-dialog"
import { ShareRecipeDialog } from "./share-recipe-dialog"

const SHOPPING_ITEM_LABEL = {
  singular: "shopping item",
  plural: "shopping items"
}

interface RecipeDetailPageProps {
  recipeId: string
  returnSource?: RecipeDetailSource | null
}

interface RecipeDetailContentProps {
  recipe: Recipe
  editButtonRef?: Ref<HTMLButtonElement>
  shoppingButtonRef?: Ref<HTMLButtonElement>
  returnLabel?: string
  lastMade?: string | null
  timesMade?: number
  onBack: () => void
  onDelete: () => void
  onEdit: () => void
  onFavorite: () => void
  onMarkMade: () => void
  onAddToPlan: () => void
  onAddToShopping: (selectedYield: number) => void
  onShare: () => void
  isDeleting?: boolean
  isFavoritePending?: boolean
  isMarkingMade?: boolean
  isAddingToShopping?: boolean
}

const RECIPE_RETURN_LABELS: Record<RecipeDetailSource, string> = {
  planner: "Back to planner",
  recipes: "Back to recipes",
  shopping: "Back to shopping",
  dashboard: "Back to dashboard"
}

function RecipeDetailState({
  title,
  message,
  onBack,
  returnLabel,
  onRetry
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
        <h1 className="font-display text-3xl font-bold text-primary">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {message}
        </p>
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
  editButtonRef,
  shoppingButtonRef,
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
  isAddingToShopping = false
}: RecipeDetailContentProps) {
  const scalingBasis = getScalingBasis(recipe.yield_metadata, recipe.servings)
  const [servings, setServings] = useState(scalingBasis)
  const [copyStatus, setCopyStatus] = useState('')
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const copyTextRef = useRef<HTMLTextAreaElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const sharingFromMenuRef = useRef(false)
  const copyInFlight = useRef(false)
  const handleCopy = async () => {
    if (copyInFlight.current) return
    copyInFlight.current = true
    setCopyStatus('Copying…')
    const text = recipePlainText(recipe, servings)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setCopyStatus('Recipe copied')
    } catch {
      setCopyStatus('Copy unavailable. Select and copy the recipe below.')
      setCopyFallback(text)
    } finally {
      copyInFlight.current = false
    }
  }
  const [scaleError, setScaleError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState("ingredients")
  const articleRef = useRef<HTMLElement>(null)
  const sectionNavRef = useRef<HTMLElement>(null)
  const jumpScrollPositionRef = useRef<number | null>(null)

  useEffect(() => {
    let frame = 0
    const updateSection = () => {
      frame = 0
      // A short section can be visible without reaching the reading line.
      // Keep its explicit jump indication until the reader actually scrolls.
      if (jumpScrollPositionRef.current !== null) {
        if (Math.abs(window.scrollY - jumpScrollPositionRef.current) < 1) return
        jumpScrollPositionRef.current = null
      }
      const nav = sectionNavRef.current
      const article = articleRef.current
      if (!nav || !article) return
      const readingLine = nav.getBoundingClientRect().bottom + 16
      const sections = ["ingredients", "instructions", "notes"]
        .flatMap((id) => {
          const element = article.querySelector<HTMLElement>(`#${id}`)
          return element ? [{ id, rect: element.getBoundingClientRect() }] : []
        })
      const reached = sections.filter(({ rect }) => rect.top <= readingLine)
      const last = sections.at(-1)
      const atBottom = window.scrollY > 0 &&
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2

      setActiveSection((current) => {
        // Short final sections may never reach the sticky reading line.
        if (atBottom && last && last.rect.top < window.innerHeight) return last.id
        if (!reached.length) return "ingredients"
        const nearestTop = Math.max(...reached.map(({ rect }) => rect.top))
        const nearest = reached.filter(({ rect }) => Math.abs(rect.top - nearestTop) < 2)
        // Desktop columns share a heading row; keep the chosen column while
        // it still contains the reading line, then follow the remaining one.
        const reading = nearest.filter(({ rect }) => rect.bottom > readingLine)
        const candidates = reading.length ? reading : nearest
        return candidates.find(({ id }) => id === current)?.id ?? candidates[0].id
      })
    }
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateSection)
    }
    const handleResize = () => {
      jumpScrollPositionRef.current = null
      scheduleUpdate()
    }
    window.addEventListener("scroll", scheduleUpdate, { passive: true })
    window.addEventListener("resize", handleResize)
    articleRef.current?.addEventListener("toggle", scheduleUpdate, true)
    const article = articleRef.current
    scheduleUpdate()
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", scheduleUpdate)
      window.removeEventListener("resize", handleResize)
      article?.removeEventListener("toggle", scheduleUpdate, true)
    }
  }, [])
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
  const isOriginalYield = servings === scalingBasis
  const authoredYield = getAuthoredYieldText(
    recipe.yield_metadata,
    recipe.servings
  )
  const selectedYieldLabel = getSelectedYieldText(
    recipe.yield_metadata,
    recipe.servings,
    servings
  )
  const selectYield = (nextYield: number) => {
    try {
      assertRecipeScalingFeasible(
        flattenRecipeIngredients(recipe.ingredientSections),
        scalingBasis,
        nextYield
      )
      setServings(nextYield)
      setScaleError(null)
    } catch (error) {
      setScaleError(
        getErrorMessage(error, "The selected yield cannot be scaled safely")
      )
    }
  }

  const handleSectionNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()

    const hash = event.currentTarget.getAttribute("href")
    if (!hash?.startsWith("#")) return
    setActiveSection(hash.slice(1))

    const section = document.getElementById(hash.slice(1))
    if (section instanceof HTMLDetailsElement) section.open = true
    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "start" })
    }

    section?.focus({ preventScroll: true })
    jumpScrollPositionRef.current = window.scrollY

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`
    )
  }
  const recipeImageUrl = getRecipeImageUrl(recipe.image_url)
  const ingredientGroups = recipe.ingredientSections
  const ingredientCount = ingredientGroups.reduce(
    (count, group) => count + group.ingredients.length,
    0
  )
  const instructionGroups = recipe.instructionSections
  const notes = normalizeRecipeNotes(recipe.notes)
  const timeChips = [
    { label: "Prep", value: formatRecipeTime(recipe.prep_time_minutes) },
    { label: "Cook", value: formatRecipeTime(recipe.cook_time_minutes) },
    { label: "Total", value: formatRecipeTime(recipe.total_time_minutes) }
  ].filter((chip) => !!chip.value)

  let instructionNumber = 0

  return (
    <article
      ref={articleRef}
      className="recipe-detail-page recipe-reading"
      data-testid="recipe-detail-page"
    >
      <div className="recipe-detail-print-hidden detail-return">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          aria-label={returnLabel}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {returnLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onFavorite}
          disabled={isFavoritePending}
          aria-pressed={!!recipe.favorite}
          aria-label={
            recipe.favorite ? "Remove from favorites" : "Add to favorites"
          }
        >
          {isFavoritePending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart
              className="h-5 w-5"
              fill={recipe.favorite ? "currentColor" : "none"}
            />
          )}
        </Button>
      </div>

      <header className="detail-heading">
        <div>
          <p className="detail-eyebrow">
            {recipe.category}
            {recipe.total_time_minutes != null
              ? ` · ${formatRecipeTime(recipe.total_time_minutes)} total`
              : ""}
          </p>
          <h1 tabIndex={-1}>{recipe.name}</h1>

        </div>
        {recipeImageUrl && failedImageUrl !== recipeImageUrl ? (
          <a
            className="detail-photo recipe-detail-print-hidden"
            href={recipeImageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View recipe photo"
          >
            <Image
              src={recipeImageUrl}
              alt={`${recipe.name} recipe`}
              fill
              priority
              sizes="120px"
              className="object-cover"
              unoptimized={!recipeImageUrl.includes("supabase.co")}
              onError={() => setFailedImageUrl(recipeImageUrl)}
            />
          </a>
        ) : null}
      </header>

      <div className="detail-header-controls">
          <details className="detail-metadata">
            <summary>
              Recipe details <ChevronDown aria-hidden="true" />
            </summary>
            <div>
              {recipe.tags?.length ? <p>{recipe.tags.join(" · ")}</p> : null}
              <p>Original yield: {authoredYield}</p>
              {timeChips.map((chip) => (
                <p key={chip.label}>
                  {chip.label} {chip.value}
                </p>
              ))}
              <p>
                {timesMade > 0
                  ? `Made ${timesMade} time${timesMade === 1 ? "" : "s"}${lastMade ? ` · Last ${new Date(lastMade).toLocaleDateString()}` : ""}`
                  : "Not made yet"}
              </p>
              {recipeImageUrl && failedImageUrl !== recipeImageUrl ? (
                <a href={recipeImageUrl} target="_blank" rel="noreferrer">
                  View recipe photo
                </a>
              ) : null}
            </div>
          </details>
        <div className="detail-yield">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" aria-label="Adjust yield">
                {selectedYieldLabel}<ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto">
          <div
            className="detail-yield-control recipe-detail-print-hidden"
            aria-label="Adjust yield"
          >
            <button
              type="button"
              onClick={() => selectYield(Math.max(1, servings - 1))}
              disabled={servings <= 1}
              aria-label="Decrease yield"
            >
              <Minus className="h-4 w-4" />
            </button>
            <output aria-live="polite">{selectedYieldLabel}</output>
            <button
              type="button"
              onClick={() => selectYield(Math.min(100, servings + 1))}
              disabled={servings >= 100}
              aria-label="Increase yield"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
            </PopoverContent>
          </Popover>
          <span className="recipe-detail-print-only hidden">
            {selectedYieldLabel}
          </span>
          {!isOriginalYield ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => selectYield(scalingBasis)}
              className="recipe-detail-print-hidden detail-reset"
            >
              Reset to {authoredYield}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="detail-existing-actions recipe-detail-print-hidden" aria-label="Recipe actions">
        <Button type="button" variant="ghost" onClick={handleCopy} disabled={copyStatus === 'Copying…'}>
          <Copy className="h-5 w-5" />Copy
        </Button>
        <Button type="button" variant="ghost" onClick={event => { event.currentTarget.focus(); onEdit() }} aria-label="Edit Recipe" ref={editButtonRef}>
          <Pencil className="h-5 w-5" />Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" ref={moreButtonRef}><MoreHorizontal className="h-5 w-5" />More</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={event => {
            if (sharingFromMenuRef.current) event.preventDefault()
            sharingFromMenuRef.current = false
          }}>
            <DropdownMenuItem onSelect={() => {
              sharingFromMenuRef.current = true
              moreButtonRef.current?.focus()
              onShare()
            }} className="min-h-11">
              <Share2 className="mr-2 h-4 w-4" />Share
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p role="status" className="detail-copy-status">{copyStatus}</p>
      <Dialog open={copyFallback !== null} onOpenChange={open => { if (!open) setCopyFallback(null) }}>
        <DialogContent>
          <DialogTitle>Copy recipe</DialogTitle>
          <DialogDescription>Clipboard access failed. Select the text and use Copy.</DialogDescription>
          <Textarea ref={copyTextRef} aria-label="Recipe text to copy" value={copyFallback ?? ''} readOnly className="min-h-64 !text-base" onFocus={event => event.currentTarget.select()} />
          <Button type="button" variant="outline" onClick={() => { copyTextRef.current?.focus(); copyTextRef.current?.select() }}>Select all</Button>
        </DialogContent>
      </Dialog>
      <div className="detail-tools">
        <div className="detail-primary-actions recipe-detail-print-hidden">
          <Button
            type="button"
            onClick={event => { event.currentTarget.focus(); onAddToShopping(servings) }}
            disabled={isAddingToShopping}
            aria-label="Add to Shopping List"
            ref={shoppingButtonRef}
          >
            {isAddingToShopping ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
            Add to Shopping
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              event.currentTarget.focus()
              onAddToPlan()
            }}
          >
            <CalendarPlus className="h-4 w-4" />
            Add to plan
          </Button>
        </div>
      </div>
      {scaleError ? (
        <p
          className="recipe-detail-print-hidden detail-scale-error"
          role="alert"
        >
          {scaleError}
        </p>
      ) : null}


      <nav
        ref={sectionNavRef}
        className="detail-section-nav recipe-detail-print-hidden"
        aria-label="Recipe sections"
      >
        <a
          href="#ingredients"
          onClick={handleSectionNavigation}
          aria-current={
            activeSection === "ingredients" ? "location" : undefined
          }
        >
          Ingredients <small aria-hidden="true">{ingredientCount}</small>
        </a>
        <a
          href="#instructions"
          onClick={handleSectionNavigation}
          aria-current={
            activeSection === "instructions" ? "location" : undefined
          }
        >
          Instructions{" "}
          <small aria-hidden="true">
            {instructionGroups.reduce(
              (count, group) => count + group.steps.length,
              0
            )}
          </small>
        </a>
        {notes.length ? (
          <a
            href="#notes"
            onClick={handleSectionNavigation}
            aria-current={activeSection === "notes" ? "location" : undefined}
          >
            Notes
          </a>
        ) : null}
      </nav>
      <div className="detail-cooking-layout">
        <section
          id="ingredients"
          tabIndex={-1}
          aria-labelledby="ingredients-heading"
        >
          <h2 id="ingredients-heading">Ingredients</h2>
          {!isOriginalYield ? (
            <p className="detail-scale-note" role="status">
              Scaled to {selectedYieldLabel} · original {authoredYield}
            </p>
          ) : null}
          {ingredientGroups.length ? (
            ingredientGroups.map((group, groupIndex) => (
              <section
                key={groupIndex}
                className="detail-ingredient-group"
                data-ingredient-group={group.label || ""}
              >
                {group.label ? <h3>{group.label}</h3> : null}
                <ul>
                  {group.ingredients.map((ingredient, index) => {
                    const formattedQuantity = formatRecipeQuantity(
                      ingredient,
                      scalingBasis,
                      servings
                    )
                    return (
                      <li key={index}>
                        <span className="detail-amount">
                          {readableRecipeQuantity(formattedQuantity.text)}
                          {formattedQuantity.hardToMeasure ? (
                            <small>hard to measure</small>
                          ) : null}
                        </span>
                        <span className="detail-ingredient-name">
                          {ingredient.item}
                          {ingredient.modifier ? (
                            <span className="detail-preparation">
                              , {ingredient.modifier}
                            </span>
                          ) : null}
                          {ingredient.alternatives?.length ? (
                            <span className="detail-alternatives">
                              or {ingredient.alternatives.join(" or ")}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          ) : (
            <p>No ingredients available.</p>
          )}
        </section>
        <section
          id="instructions"
          tabIndex={-1}
          aria-labelledby="instructions-heading"
        >
          <h2 id="instructions-heading">Instructions</h2>
          {instructionGroups.length ? (
            instructionGroups.map((group, groupIndex) => {
              const start = instructionNumber + 1
              instructionNumber += group.steps.length
              return (
                <section key={groupIndex} className="detail-instruction-group">
                  {group.label ? <h3>{group.label}</h3> : null}
                  <ol start={start}>
                    {group.steps.map((step, stepIndex) => (
                      <li key={stepIndex} value={start + stepIndex}>
                        <span className="detail-step-number" aria-hidden="true">
                          {start + stepIndex}
                        </span>
                        <p>{step}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              )
            })
          ) : (
            <p>No instructions available.</p>
          )}
          <div className="detail-made-footer recipe-detail-print-hidden">
            <div>
              <p>Made this recipe?</p>
              <span>Keep your cooking history up to date.</span>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={onMarkMade}
              disabled={isMarkingMade}
            >
              {isMarkingMade ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Mark made
            </Button>
          </div>
        </section>
      </div>
      {notes.length ? (
        <details id="notes" className="detail-notes" tabIndex={-1}>
          <summary>
            <h2 id="notes-heading">Notes</h2>
            <span>{notes.length}</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <ul>
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="detail-delete recipe-detail-print-hidden">
        <Button
          type="button"
          variant="ghost"
          onClick={(event) => {
            event.currentTarget.focus()
            onDelete()
          }}
          disabled={isDeleting}
          className="text-destructive hover:text-destructive"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete recipe
        </Button>
      </div>
    </article>
  )
}

export function RecipeDetailPage({
  recipeId,
  returnSource = null
}: RecipeDetailPageProps) {
  const router = useRouter()
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
  const [shoppingYield, setShoppingYield] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const shoppingButtonRef = useRef<HTMLButtonElement>(null)
  const rememberDialogFocus = () => {
    dialogReturnFocusRef.current = document.activeElement as HTMLElement | null
  }
  const restoreDialogFocus = () => {
    window.setTimeout(() => {
      const target = dialogReturnFocusRef.current
      const currentTarget = target?.isConnected ? target :
        target?.getAttribute("aria-label") === "Edit Recipe" ? editButtonRef.current :
        target?.getAttribute("aria-label") === "Add to Shopping List" ? shoppingButtonRef.current : null
      currentTarget?.focus({ preventScroll: true })
    }, 0)
  }
  const returnLabel = RECIPE_RETURN_LABELS[returnSource ?? "recipes"]
  const statsMap = useMemo(
    () => getRecipeStatsMap(historyStats),
    [historyStats]
  )
  const stats = statsMap.get(recipeId)

  const handleReturn = () => {
    returnFromRecipeDetail(router, returnSource)
  }

  const handleFavorite = async () => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      await toggleFavorite.mutateAsync({
        id: recipe.id,
        favorite: !!recipe.favorite
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(error, "Failed to update favorite")
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
        onExpire: () => undefined
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(error, "Failed to mark recipe as made")
      })
    }
  }

  const handleAddToShopping = async (selections: ShoppingRecipeSelection[]) => {
    const recipe = recipeQuery.data
    if (!recipe) return

    try {
      const result = await addToShopping.mutateAsync({
        recipeIds: selections.map(selection => selection.recipeId),
        selections,
      })
      showToast({
        message: formatShoppingAddMessage(result, {
          sourceName: recipe.name,
          itemLabel: SHOPPING_ITEM_LABEL,
          zeroMessage: `All shopping items from "${recipe.name}" are already on the shopping list`
        })
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(
          error,
          "Failed to add ingredients to shopping list"
        )
      })
      throw error
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
        duration: 4000
      })
    }
  }

  const errorCode = (recipeQuery.error as { code?: string } | null)?.code
  const isMissing = recipeQuery.isSuccess && !recipeQuery.data

  return (
    <>
      <div className="recipe-detail-scroll min-w-0 overflow-x-clip scroll-smooth">
        {recipeQuery.isLoading ? <RecipeDetailLoading /> : null}
        {recipeQuery.isError ? (
          <RecipeDetailState
            title={
              errorCode === "PGRST116"
                ? "Recipe not found"
                : "Couldn’t load recipe"
            }
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
            editButtonRef={editButtonRef}
            shoppingButtonRef={shoppingButtonRef}
            key={`${recipeQuery.data.id}:${recipeQuery.data.updated_at ?? ""}`}
            recipe={recipeQuery.data}
            returnLabel={returnLabel}
            lastMade={stats?.lastMade ?? null}
            timesMade={stats?.timesMade ?? 0}
            onBack={handleReturn}
            onDelete={() => {
              rememberDialogFocus()
              setShowDeleteConfirm(true)
            }}
            onEdit={() => {
              rememberDialogFocus()
              setIsEditOpen(true)
            }}
            onFavorite={() => void handleFavorite()}
            onMarkMade={() => void handleMarkMade()}
            onAddToPlan={() => {
              rememberDialogFocus()
              setIsAddToPlanOpen(true)
            }}
            onAddToShopping={(selectedYield) =>
              { rememberDialogFocus(); setShoppingYield(selectedYield) }
            }
            onShare={() => {
              rememberDialogFocus()
              setIsShareOpen(true)
            }}
            isDeleting={deleteRecipe.isPending}
            isFavoritePending={toggleFavorite.isPending}
            isMarkingMade={markAsMade.isPending}
            isAddingToShopping={addToShopping.isPending}
          />
        ) : null}
      </div>

      <ShoppingSelectionDialog
        open={shoppingYield !== null}
        onOpenChange={open => { if (!open && !addToShopping.isPending) setShoppingYield(null) }}
        onCloseAutoFocus={() => restoreDialogFocus()}
        recipes={recipeQuery.data ? [recipeQuery.data] : []}
        defaultScale={recipeQuery.data && shoppingYield !== null ? shoppingYield / getScalingBasis(recipeQuery.data.yield_metadata, recipeQuery.data.servings) : 1}
        onSubmit={handleAddToShopping}
      />
      <RecipeDialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open)
          if (!open) restoreDialogFocus()
        }}
        recipeId={recipeId}
        categories={categories || []}
      />
      <ShareRecipeDialog
        open={isShareOpen}
        onOpenChange={(open) => {
          setIsShareOpen(open)
          if (!open) restoreDialogFocus()
        }}
        recipeId={recipeId}
      />
      <AddToPlanDialog
        open={isAddToPlanOpen}
        onOpenChange={(open) => {
          setIsAddToPlanOpen(open)
          if (!open) restoreDialogFocus()
        }}
        recipeId={recipeId}
      />

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => {
          setShowDeleteConfirm(open)
          if (!open) restoreDialogFocus()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{recipeQuery.data?.name}
              &quot;? This action cannot be undone.
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
    </>
  )
}
