"use client"

import React, { useCallback, useRef, useState } from "react"
import { Ban, Loader2, Package, Plus, Search } from "lucide-react"
import type { PantryItem } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import {
  CategorizedPantryItems,
  ExactExclusionItems,
} from "@/components/pantry/pantry-item-lists"
import {
  useAddPantryItems,
  usePantryItems,
  useRemovePantryItem,
  useRestorePantryItem,
} from "@/hooks/use-pantry"
import { usePantryExcludedKeywords } from "@/hooks/use-pantry-excluded-keywords"
import {
  type IngredientExclusionSetting,
  useShoppingConfig,
  useUpdateIngredientExclusionSetting,
} from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { cn } from "@/lib/utils"

type InlineFeedback = {
  message: string
  tone: "neutral" | "error"
}

function formatOutcomeGroup(label: string, items: string[]) {
  if (items.length === 0) return null
  return `${label}: ${items.join(", ")}`
}

function summarizeOutcomes(
  subject: string,
  outcomes: Array<{
    input: string
    normalizedItem?: string
    normalizedKeyword?: string
    status: "success" | "duplicate" | "failure"
  }>
) {
  const successItems = outcomes
    .filter((outcome) => outcome.status === "success")
    .map(
      (outcome) =>
        outcome.normalizedItem ?? outcome.normalizedKeyword ?? outcome.input
    )
  const duplicateItems = outcomes
    .filter((outcome) => outcome.status === "duplicate")
    .map(
      (outcome) =>
        outcome.normalizedItem ?? outcome.normalizedKeyword ?? outcome.input
    )
  const failureItems = outcomes
    .filter((outcome) => outcome.status === "failure")
    .map((outcome) => outcome.input)

  const parts: string[] = []
  const added = formatOutcomeGroup("Added", successItems)
  const duplicates = formatOutcomeGroup("Already existed", duplicateItems)
  const failures = formatOutcomeGroup("Needs retry", failureItems)
  if (added) parts.push(added)
  if (duplicates) parts.push(duplicates)
  if (failures) parts.push(failures)

  if (parts.length === 0) return null
  return `${subject}: ${parts.join(". ")}.`
}

interface PantryPanelProps {
  isActive: boolean
  items: PantryItem[]
  isLoading: boolean
  isFetching: boolean
  newItem: string
  query: string
  feedback: InlineFeedback | null
  isAdding: boolean
  removingIds: Set<string>
  inputRef: React.RefObject<HTMLInputElement | null>
  onNewItemChange: (value: string) => void
  onQueryChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  onRemove: (item: PantryItem) => void
}

function PantryPanel({
  isActive,
  items,
  isLoading,
  isFetching,
  newItem,
  query,
  feedback,
  isAdding,
  removingIds,
  inputRef,
  onNewItemChange,
  onQueryChange,
  onSubmit,
  onRemove,
}: PantryPanelProps) {
  const normalizedQuery = query.trim().toLowerCase()
  const hasMatches = items.some((item) =>
    item.item.toLowerCase().includes(normalizedQuery)
  )
  const showLoading = isLoading && items.length === 0

  return (
    <Card
      className={cn(!isActive && "hidden md:block")}
      data-testid="pantry-panel"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Pantry Items
          <span className="rounded-full bg-sage-100 px-2 py-0.5 text-xs font-medium text-sage-700">
            {items.length}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Items you already have at home. These will be excluded from shopping
          lists.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="mb-4 flex gap-2">
          <Input
            ref={inputRef}
            placeholder="Add pantry item (comma-separated)..."
            value={newItem}
            onChange={(event) => onNewItemChange(event.target.value)}
            className="text-base sm:text-sm"
          />
          <Button
            type="submit"
            size="icon"
            disabled={isAdding}
            className="h-11 w-11 shrink-0"
            aria-label="Submit pantry items"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </form>
        <p className="mb-4 text-xs text-muted-foreground">
          Add one or several ingredients separated by commas. Duplicates are
          skipped and anything that fails stays in the field for retry.
        </p>
        {items.length > 10 ? (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Search pantry items"
              placeholder="Search pantry items..."
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="pl-9 text-base md:text-sm"
            />
          </div>
        ) : null}
        {feedback ? (
          <p
            className={cn(
              "mb-4 text-sm",
              feedback.tone === "error"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        ) : null}

        {showLoading ? (
          <p className="py-4 text-center text-muted-foreground">
            Loading pantry items...
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No pantry items yet"
            description="Add staples you already have so shopping lists can separate what is covered at home."
            action={{
              label: "Add pantry items",
              onClick: () => inputRef.current?.focus(),
            }}
          />
        ) : (
          <div className="relative">
            {normalizedQuery && !hasMatches ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No pantry items match “{query.trim()}”.
              </p>
            ) : null}
            <div className={cn(normalizedQuery && !hasMatches && "hidden")}>
              {isFetching && !isLoading ? (
                <div className="absolute right-0 top-0 z-10 p-2">
                  <div className="rounded-full border bg-background/80 p-1.5 shadow-sm backdrop-blur-sm">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                </div>
              ) : null}
              <CategorizedPantryItems
                items={items}
                query={query}
                removingIds={removingIds}
                onRemove={onRemove}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ExcludedIngredientsPanelProps {
  isActive: boolean
  keywords: string[]
  isLoading: boolean
  isFetching: boolean
  newKeyword: string
  query: string
  feedback: InlineFeedback | null
  isAdding: boolean
  removingKeywords: Set<string>
  inputRef: React.RefObject<HTMLInputElement | null>
  familySettingsLoading: boolean
  familySettingsError: boolean
  excludeSaltVariants: boolean
  excludeBlackPepperVariants: boolean
  familySettingsPending: boolean
  onNewKeywordChange: (value: string) => void
  onQueryChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  onRemove: (keyword: string) => void
  onFamilySettingChange: (
    setting: IngredientExclusionSetting,
    enabled: boolean
  ) => void
}

function ExcludedIngredientsPanel({
  isActive,
  keywords,
  isLoading,
  isFetching,
  newKeyword,
  query,
  feedback,
  isAdding,
  removingKeywords,
  inputRef,
  familySettingsLoading,
  familySettingsError,
  excludeSaltVariants,
  excludeBlackPepperVariants,
  familySettingsPending,
  onNewKeywordChange,
  onQueryChange,
  onSubmit,
  onRemove,
  onFamilySettingChange,
}: ExcludedIngredientsPanelProps) {
  const normalizedQuery = query.trim().toLowerCase()
  const hasMatches = keywords.some((keyword) =>
    keyword.toLowerCase().includes(normalizedQuery)
  )
  const showLoading = isLoading && keywords.length === 0

  return (
    <Card
      className={cn(!isActive && "hidden md:block")}
      data-testid="excluded-ingredients-panel"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="h-5 w-5" />
          Excluded Items
          <span className="rounded-full bg-terracotta-100 px-2 py-0.5 text-xs font-medium text-terracotta-700">
            {keywords.length}
          </span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Keep common staples and exact ingredient names out of newly generated
          shopping lists.
        </p>
      </CardHeader>
      <CardContent>
        <section
          aria-labelledby="always-exclude-heading"
          className="space-y-3 rounded-xl border border-border-muted/70 bg-stone-50/60 p-3"
        >
          <div>
            <h3 id="always-exclude-heading" className="text-sm font-semibold">
              Always exclude
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Clear/reset the shopping list, then regenerate it to reliably
              rebuild with current settings.
            </p>
          </div>
          {familySettingsLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading exclusion settings...
            </p>
          ) : familySettingsError ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load exclusion settings. Try refreshing the page.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="exclude-salt-variants"
                  checked={excludeSaltVariants}
                  onCheckedChange={(checked) =>
                    onFamilySettingChange("exclude_salt_variants", checked)
                  }
                  aria-describedby="exclude-salt-variants-description"
                  disabled={familySettingsPending}
                />
                <div className="space-y-1">
                  <label
                    htmlFor="exclude-salt-variants"
                    className="text-sm font-medium"
                  >
                    Salt variants
                  </label>
                  <p
                    id="exclude-salt-variants-description"
                    className="text-xs text-muted-foreground"
                  >
                    Salt variants include salt, kosher salt, sea salt, and table
                    salt.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="exclude-black-pepper-variants"
                  checked={excludeBlackPepperVariants}
                  onCheckedChange={(checked) =>
                    onFamilySettingChange(
                      "exclude_black_pepper_variants",
                      checked
                    )
                  }
                  aria-describedby="exclude-black-pepper-variants-description"
                  disabled={familySettingsPending}
                />
                <div className="space-y-1">
                  <label
                    htmlFor="exclude-black-pepper-variants"
                    className="text-sm font-medium"
                  >
                    Black pepper variants
                  </label>
                  <p
                    id="exclude-black-pepper-variants-description"
                    className="text-xs text-muted-foreground"
                  >
                    Black pepper variants include black pepper, ground black
                    pepper, freshly ground black pepper, and cracked black
                    pepper.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="my-5 border-t border-border-muted" />

        <section aria-labelledby="exact-exclusions-heading">
          <h3 id="exact-exclusions-heading" className="mb-1 text-sm font-semibold">
            Exact exclusions
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Matches a whole normalized ingredient name and does not perform
            substring matching.
          </p>
          <form onSubmit={onSubmit} className="mb-4 flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Add excluded keyword (comma-separated)..."
              value={newKeyword}
              onChange={(event) => onNewKeywordChange(event.target.value)}
              className="text-base sm:text-sm"
            />
            <Button
              type="submit"
              size="icon"
              disabled={isAdding}
              className="h-11 w-11 shrink-0"
              aria-label="Submit excluded keywords"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <p className="mb-4 text-xs text-muted-foreground">
            Use exact keywords for ingredients that should stay out of shopping.
            Add several at once with commas.
          </p>
          {keywords.length > 10 ? (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search excluded keywords"
                placeholder="Search excluded keywords..."
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="pl-9 text-base md:text-sm"
              />
            </div>
          ) : null}
          {feedback ? (
            <p
              className={cn(
                "mb-4 text-sm",
                feedback.tone === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
              role={feedback.tone === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          ) : null}

          {showLoading ? (
            <p className="py-4 text-center text-muted-foreground">
              Loading excluded keywords...
            </p>
          ) : keywords.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="No excluded keywords"
              description="Add exact-match keywords for ingredients you never want generated into shopping from recipes."
              action={{
                label: "Add excluded keywords",
                onClick: () => inputRef.current?.focus(),
              }}
            />
          ) : normalizedQuery && !hasMatches ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No excluded keywords match “{query.trim()}”.
            </p>
          ) : (
            <div className="relative">
              {isFetching && !isLoading ? (
                <div className="absolute right-0 top-0 z-10 p-2">
                  <div className="rounded-full border bg-background/80 p-1.5 shadow-sm backdrop-blur-sm">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                </div>
              ) : null}
              <ExactExclusionItems
                keywords={keywords}
                query={query}
                removingKeywords={removingKeywords}
                onRemove={onRemove}
              />
            </div>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

export function PantryList() {
  const [activeSection, setActiveSection] = useState<"pantry" | "excluded">(
    "pantry"
  )
  const [newItem, setNewItem] = useState("")
  const [newKeyword, setNewKeyword] = useState("")
  const [pantryQuery, setPantryQuery] = useState("")
  const [keywordQuery, setKeywordQuery] = useState("")
  const [pantryFeedback, setPantryFeedback] =
    useState<InlineFeedback | null>(null)
  const [keywordFeedback, setKeywordFeedback] =
    useState<InlineFeedback | null>(null)
  const [removingPantryIds, setRemovingPantryIds] = useState<Set<string>>(
    new Set()
  )
  const [removingKeywordIds, setRemovingKeywordIds] = useState<Set<string>>(
    new Set()
  )
  const pantryInputRef = useRef<HTMLInputElement>(null)
  const keywordInputRef = useRef<HTMLInputElement>(null)
  const {
    data: pantryItems,
    isLoading: pantryLoading,
    isFetching: pantryFetching,
  } = usePantryItems()
  const {
    data: excludedKeywords,
    isLoading: keywordsLoading,
    isFetching: keywordsFetching,
    addKeywords,
    removeKeyword,
  } = usePantryExcludedKeywords()

  const addPantryItems = useAddPantryItems()
  const removePantryItem = useRemovePantryItem()
  const restorePantryItem = useRestorePantryItem()
  const undoToast = useUndoToast()
  const userConfig = useShoppingConfig()
  const updateIngredientExclusion = useUpdateIngredientExclusionSetting()

  const handleIngredientExclusionChange = useCallback(
    (setting: IngredientExclusionSetting, enabled: boolean) => {
      updateIngredientExclusion.mutate(
        { setting, enabled },
        {
          onError: () => {
            undoToast.show({
              message: "Could not save the shopping exclusion setting. Try again.",
              duration: 4000,
            })
          },
        }
      )
    },
    [undoToast, updateIngredientExclusion]
  )

  const handleRemovePantryItem = useCallback(
    (item: PantryItem) => {
      if (removingPantryIds.has(item.id)) return

      setRemovingPantryIds((previous) => new Set(previous).add(item.id))
      removePantryItem.mutate(item, {
        onSuccess: () => {
          setPantryFeedback(null)
          undoToast.show({
            message: `"${item.item}" removed from pantry`,
            queueBehavior: "enqueue",
            onUndo: () => {
              restorePantryItem.mutate(item)
            },
          })
        },
        onError: () => {
          setPantryFeedback({
            message: `Could not remove "${item.item}" from pantry. Try again.`,
            tone: "error",
          })
        },
        onSettled: () => {
          setRemovingPantryIds((previous) => {
            const next = new Set(previous)
            next.delete(item.id)
            return next
          })
        },
      })
    },
    [
      removingPantryIds,
      removePantryItem,
      restorePantryItem,
      undoToast,
    ]
  )

  const handleRemoveKeyword = useCallback(
    (keyword: string) => {
      if (removingKeywordIds.has(keyword)) return

      setRemovingKeywordIds((previous) => new Set(previous).add(keyword))
      void removeKeyword
        .mutateAsync(keyword)
        .then(() => {
          setKeywordFeedback(null)
          undoToast.show({
            message: `"${keyword}" removed from excluded keywords`,
            queueBehavior: "enqueue",
            onUndo: () => {
              addKeywords.mutate(keyword)
            },
          })
        })
        .catch(() => {
          setKeywordFeedback({
            message: `Could not remove "${keyword}" from excluded keywords. Try again.`,
            tone: "error",
          })
        })
        .finally(() => {
          setRemovingKeywordIds((previous) => {
            const next = new Set(previous)
            next.delete(keyword)
            return next
          })
        })
    },
    [addKeywords, removeKeyword, removingKeywordIds, undoToast]
  )

  const displayedPantryItems = pantryItems || []
  const displayedKeywords = excludedKeywords || []

  const handleAddPantryItem = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newItem.trim()) return

    try {
      const result = await addPantryItems.mutateAsync(newItem)
      setNewItem(result.unresolvedInput)
      const message = summarizeOutcomes("Pantry items", result.outcomes)
      setPantryFeedback(message ? { message, tone: "neutral" } : null)
    } catch (error) {
      console.error("Failed to add pantry items:", error)
      setPantryFeedback({
        message: "Pantry items: failed to update.",
        tone: "error",
      })
    }
  }

  const handleAddKeyword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!newKeyword.trim()) return

    try {
      const result = await addKeywords.mutateAsync(newKeyword)
      setNewKeyword(result.unresolvedInput)
      const message = summarizeOutcomes("Excluded keywords", result.outcomes)
      setKeywordFeedback(message ? { message, tone: "neutral" } : null)
    } catch (error) {
      console.error("Failed to add keywords:", error)
      setKeywordFeedback({
        message: "Excluded keywords: failed to update.",
        tone: "error",
      })
    }
  }

  const pantryCount = displayedPantryItems.length
  const keywordCount = displayedKeywords.length

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">
              Pantry
            </h1>
            <p className="text-sm text-muted-foreground">
              Keep ingredients you already have and the exclusions that should
              stay out of shopping.
            </p>
          </div>
          <div className="hidden flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground md:flex">
            <span className="rounded-full bg-sage-100 px-3 py-1 text-sage-700">
              {pantryCount} pantry item{pantryCount === 1 ? "" : "s"}
            </span>
            <span className="rounded-full bg-terracotta-100 px-3 py-1 text-terracotta-700">
              {keywordCount} excluded keyword{keywordCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>
      </div>

      <nav
        className="grid grid-cols-2 rounded-2xl border border-border-muted/80 bg-stone-50/70 p-1 md:hidden"
        aria-label="Pantry sections"
      >
        <button
          type="button"
          onClick={() => setActiveSection("pantry")}
          aria-label={`Pantry ${pantryCount}`}
          aria-pressed={activeSection === "pantry"}
          className={cn(
            "min-h-11 rounded-xl px-3 text-sm font-semibold transition-all",
            activeSection === "pantry"
              ? "bg-white text-primary shadow-sm"
              : "text-primary/60"
          )}
        >
          Pantry <span className="ml-1 text-xs">{pantryCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("excluded")}
          aria-label={`Excluded ${keywordCount}`}
          aria-pressed={activeSection === "excluded"}
          className={cn(
            "min-h-11 rounded-xl px-3 text-sm font-semibold transition-all",
            activeSection === "excluded"
              ? "bg-white text-primary shadow-sm"
              : "text-primary/60"
          )}
        >
          Excluded <span className="ml-1 text-xs">{keywordCount}</span>
        </button>
      </nav>

      <div className="grid gap-6 md:grid-cols-2">
        <PantryPanel
          isActive={activeSection === "pantry"}
          items={displayedPantryItems}
          isLoading={pantryLoading}
          isFetching={pantryFetching}
          newItem={newItem}
          query={pantryQuery}
          feedback={pantryFeedback}
          isAdding={addPantryItems.isPending}
          removingIds={removingPantryIds}
          inputRef={pantryInputRef}
          onNewItemChange={(value) => {
            setNewItem(value)
            setPantryFeedback(null)
          }}
          onQueryChange={setPantryQuery}
          onSubmit={handleAddPantryItem}
          onRemove={handleRemovePantryItem}
        />
        <ExcludedIngredientsPanel
          isActive={activeSection === "excluded"}
          keywords={displayedKeywords}
          isLoading={keywordsLoading}
          isFetching={keywordsFetching}
          newKeyword={newKeyword}
          query={keywordQuery}
          feedback={keywordFeedback}
          isAdding={addKeywords.isPending}
          removingKeywords={removingKeywordIds}
          inputRef={keywordInputRef}
          familySettingsLoading={userConfig.isLoading}
          familySettingsError={userConfig.isError}
          excludeSaltVariants={
            userConfig.data?.exclude_salt_variants ?? false
          }
          excludeBlackPepperVariants={
            userConfig.data?.exclude_black_pepper_variants ?? false
          }
          familySettingsPending={updateIngredientExclusion.isPending}
          onNewKeywordChange={(value) => {
            setNewKeyword(value)
            setKeywordFeedback(null)
          }}
          onQueryChange={setKeywordQuery}
          onSubmit={handleAddKeyword}
          onRemove={handleRemoveKeyword}
          onFamilySettingChange={handleIngredientExclusionChange}
        />
      </div>
    </div>
  )
}
