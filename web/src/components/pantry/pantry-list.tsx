"use client"

import React, { useState, useCallback, useRef } from "react"
import { Plus, X, Package, Ban, Loader2, Search } from "lucide-react"
import type { PantryItem } from "@/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  usePantryItems,
  useAddPantryItems,
  useRemovePantryItem,
  useRestorePantryItem,
} from "@/hooks/use-pantry"
import { usePantryExcludedKeywords } from "@/hooks/use-pantry-excluded-keywords"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { cn } from "@/lib/utils"
import { useIsDesktop } from "@/hooks/use-is-desktop"

type InlineFeedback = {
  message: string
  tone: "neutral" | "error"
}

function formatOutcomeGroup(
  label: string,
  items: string[]
) {
  if (items.length === 0) return null
  return `${label}: ${items.join(", ")}`
}

function summarizeOutcomes(
  subject: string,
  outcomes: Array<{ input: string; normalizedItem?: string; normalizedKeyword?: string; status: "success" | "duplicate" | "failure" }>
) {
  const successItems = outcomes
    .filter((outcome) => outcome.status === "success")
    .map((outcome) => outcome.normalizedItem ?? outcome.normalizedKeyword ?? outcome.input)
  const duplicateItems = outcomes
    .filter((outcome) => outcome.status === "duplicate")
    .map((outcome) => outcome.normalizedItem ?? outcome.normalizedKeyword ?? outcome.input)
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

export function PantryList() {
  const isDesktop = useIsDesktop()
  const [activeSection, setActiveSection] = useState<"pantry" | "excluded">("pantry")
  const [newItem, setNewItem] = useState("")
  const [newKeyword, setNewKeyword] = useState("")
  const [pantryQuery, setPantryQuery] = useState("")
  const [keywordQuery, setKeywordQuery] = useState("")
  const [showAllPantryItems, setShowAllPantryItems] = useState(false)
  const [showAllKeywords, setShowAllKeywords] = useState(false)
  const [pantryFeedback, setPantryFeedback] = useState<InlineFeedback | null>(null)
  const [keywordFeedback, setKeywordFeedback] = useState<InlineFeedback | null>(null)
  const [removingPantryIds, setRemovingPantryIds] = useState<Set<string>>(new Set())
  const [removingKeywordIds, setRemovingKeywordIds] = useState<Set<string>>(new Set())
  const pantryInputRef = useRef<HTMLInputElement>(null)
  const keywordInputRef = useRef<HTMLInputElement>(null)
  const { data: pantryItems, isLoading: pantryLoading, isFetching: pantryFetching } = usePantryItems()
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

  const handleRemovePantryItem = useCallback((item: PantryItem) => {
    if (removingPantryIds.has(item.id)) return

    setRemovingPantryIds((prev) => new Set(prev).add(item.id))
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
        setRemovingPantryIds((prev) => {
          const next = new Set(prev)
          next.delete(item.id)
          return next
        })
      },
    })
  }, [removingPantryIds, removePantryItem, restorePantryItem, undoToast])

  const handleRemoveKeyword = useCallback((keyword: string) => {
    if (removingKeywordIds.has(keyword)) return

    setRemovingKeywordIds((prev) => new Set(prev).add(keyword))
    void removeKeyword.mutateAsync(keyword)
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
        setRemovingKeywordIds((prev) => {
          const next = new Set(prev)
          next.delete(keyword)
          return next
        })
      })
  }, [addKeywords, removeKeyword, removingKeywordIds, undoToast])

  const displayedPantryItems = pantryItems || []
  const displayedKeywords = excludedKeywords || []

  const showPantryLoading = pantryLoading && displayedPantryItems.length === 0
  const showKeywordsLoading = keywordsLoading && displayedKeywords.length === 0
  const pantryCount = displayedPantryItems.length
  const keywordCount = displayedKeywords.length
  const normalizedPantryQuery = pantryQuery.trim().toLowerCase()
  const normalizedKeywordQuery = keywordQuery.trim().toLowerCase()
  const filteredPantryItems = normalizedPantryQuery
    ? displayedPantryItems.filter((item) => item.item.toLowerCase().includes(normalizedPantryQuery))
    : displayedPantryItems
  const filteredKeywords = normalizedKeywordQuery
    ? displayedKeywords.filter((keyword) => keyword.toLowerCase().includes(normalizedKeywordQuery))
    : displayedKeywords
  const visiblePantryItems = isDesktop || normalizedPantryQuery || showAllPantryItems
    ? filteredPantryItems
    : filteredPantryItems.slice(0, 24)
  const visibleKeywords = isDesktop || normalizedKeywordQuery || showAllKeywords
    ? filteredKeywords
    : filteredKeywords.slice(0, 24)
  const handleAddPantryItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    try {
      const result = await addPantryItems.mutateAsync(newItem)
      setShowAllPantryItems(true)
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

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyword.trim()) return

    try {
      const result = await addKeywords.mutateAsync(newKeyword)
      setShowAllKeywords(true)
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

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Pantry</h1>
            <p className="text-sm text-muted-foreground">
              Keep ingredients you already have and the exclusions that should stay out of shopping.
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
      <nav className="grid grid-cols-2 rounded-2xl border border-border-muted/80 bg-stone-50/70 p-1 md:hidden" aria-label="Pantry sections">
        <button
          type="button"
          onClick={() => setActiveSection("pantry")}
          aria-current={activeSection === "pantry" ? "page" : undefined}
          className={cn(
            "min-h-11 rounded-xl px-3 text-sm font-semibold transition-all",
            activeSection === "pantry" ? "bg-white text-primary shadow-sm" : "text-primary/60"
          )}
        >
          Pantry <span className="ml-1 text-xs">{pantryCount}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSection("excluded")}
          aria-current={activeSection === "excluded" ? "page" : undefined}
          className={cn(
            "min-h-11 rounded-xl px-3 text-sm font-semibold transition-all",
            activeSection === "excluded" ? "bg-white text-primary shadow-sm" : "text-primary/60"
          )}
        >
          Excluded <span className="ml-1 text-xs">{keywordCount}</span>
        </button>
      </nav>
      <div className="grid gap-6 md:grid-cols-2">
      {/* Pantry Items */}
        <Card className={cn(activeSection !== "pantry" && "hidden md:block")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pantry Items
            <span className="rounded-full bg-sage-100 px-2 py-0.5 text-xs font-medium text-sage-700">
              {pantryCount}
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Items you already have at home. These will be excluded from shopping lists.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddPantryItem} className="flex gap-2 mb-4">
            <Input
              ref={pantryInputRef}
              placeholder="Add pantry item (comma-separated)..."
              value={newItem}
              onChange={(e) => {
                setNewItem(e.target.value)
                setPantryFeedback(null)
              }}
              className="text-base sm:text-sm"
            />
            <Button type="submit" size="icon" disabled={addPantryItems.isPending} className="h-11 w-11 shrink-0" aria-label="Submit pantry items">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <p className="mb-4 text-xs text-muted-foreground">
            Add one or several ingredients separated by commas. Duplicates are skipped and anything that fails stays in the field for retry.
          </p>
          {pantryCount > 10 ? (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search pantry items"
                placeholder="Search pantry items..."
                value={pantryQuery}
                onChange={(event) => setPantryQuery(event.target.value)}
                className="pl-9 text-base md:text-sm"
              />
            </div>
          ) : null}
          {pantryFeedback && (
            <p
              className={
                pantryFeedback.tone === "error"
                  ? "mb-4 text-sm text-destructive"
                  : "mb-4 text-sm text-muted-foreground"
              }
              role={pantryFeedback.tone === "error" ? "alert" : "status"}
            >
              {pantryFeedback.message}
            </p>
          )}

          {showPantryLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading pantry items...</p>
          ) : displayedPantryItems.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No pantry items yet"
              description="Add staples you already have so shopping lists can separate what is covered at home."
              action={{
                label: "Add pantry items",
                onClick: () => pantryInputRef.current?.focus(),
              }}
            />
          ) : filteredPantryItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No pantry items match “{pantryQuery.trim()}”.</p>
          ) : (
            <div className="relative">
              {/* Subtle loading indicator for background refetch */}
              {pantryFetching && !pantryLoading && (
                <div className="absolute top-0 right-0 z-10 p-2">
                  <div className="bg-background/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {visiblePantryItems.map((item) => (
                  <div
                    key={item.id}
                    data-pantry-item={item.id}
                    className="flex items-center gap-1.5 rounded-full bg-sage-100 px-3 py-1.5 text-sm font-medium text-sage-700 transition-colors duration-200 hover:bg-sage-200"
                  >
                    <span>{item.item}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.item}`}
                      onClick={() => handleRemovePantryItem(item)}
                      disabled={removingPantryIds.has(item.id)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5 hover:text-destructive active:bg-black/10 md:min-h-8 md:min-w-8"
                    >
                      {removingPantryIds.has(item.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {!isDesktop && !normalizedPantryQuery && filteredPantryItems.length > visiblePantryItems.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAllPantryItems(true)}
                  className="mt-4 h-11 w-full"
                >
                  Show all {filteredPantryItems.length} pantry items
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Excluded Keywords */}
      <Card className={cn(activeSection !== "excluded" && "hidden md:block")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            Excluded Keywords
            <span className="rounded-full bg-terracotta-100 px-2 py-0.5 text-xs font-medium text-terracotta-700">
              {keywordCount}
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Keywords that exclude matching ingredients. Only exact matches are excluded (e.g., &quot;pepper&quot; matches &quot;pepper&quot; but not &quot;poblano pepper&quot;).
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddKeyword} className="flex gap-2 mb-4">
            <Input
              ref={keywordInputRef}
              placeholder="Add excluded keyword (comma-separated)..."
              value={newKeyword}
              onChange={(e) => {
                setNewKeyword(e.target.value)
                setKeywordFeedback(null)
              }}
              className="text-base sm:text-sm"
            />
            <Button type="submit" size="icon" disabled={addKeywords.isPending} className="h-11 w-11 shrink-0" aria-label="Submit excluded keywords">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
          <p className="mb-4 text-xs text-muted-foreground">
            Use exact keywords for ingredients that should stay out of shopping. Add several at once with commas.
          </p>
          {keywordCount > 10 ? (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search excluded keywords"
                placeholder="Search excluded keywords..."
                value={keywordQuery}
                onChange={(event) => setKeywordQuery(event.target.value)}
                className="pl-9 text-base md:text-sm"
              />
            </div>
          ) : null}
          {keywordFeedback && (
            <p
              className={
                keywordFeedback.tone === "error"
                  ? "mb-4 text-sm text-destructive"
                  : "mb-4 text-sm text-muted-foreground"
              }
              role={keywordFeedback.tone === "error" ? "alert" : "status"}
            >
              {keywordFeedback.message}
            </p>
          )}

          {showKeywordsLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading excluded keywords...</p>
          ) : displayedKeywords.length === 0 ? (
            <EmptyState
              icon={Ban}
              title="No excluded keywords"
              description="Add exact-match keywords for ingredients you never want generated into shopping from recipes."
              action={{
                label: "Add excluded keywords",
                onClick: () => keywordInputRef.current?.focus(),
              }}
            />
          ) : filteredKeywords.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No excluded keywords match “{keywordQuery.trim()}”.</p>
          ) : (
            <div className="relative">
              {/* Subtle loading indicator for background refetch */}
              {keywordsFetching && !keywordsLoading && (
                <div className="absolute top-0 right-0 z-10 p-2">
                  <div className="bg-background/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {visibleKeywords.map((keyword: string) => (
                  <div
                    key={keyword}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium transition-colors duration-200 hover:bg-terracotta-200"
                  >
                    <span>{keyword}</span>
                    <button
                      type="button"
                      aria-label={`Remove excluded keyword ${keyword}`}
                      onClick={() => handleRemoveKeyword(keyword)}
                      disabled={removingKeywordIds.has(keyword)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-black/5 hover:text-terracotta-900 active:bg-black/10 md:min-h-8 md:min-w-8"
                    >
                      {removingKeywordIds.has(keyword) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {!isDesktop && !normalizedKeywordQuery && filteredKeywords.length > visibleKeywords.length ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAllKeywords(true)}
                  className="mt-4 h-11 w-full"
                >
                  Show all {filteredKeywords.length} excluded keywords
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

    </div>
  )
}
