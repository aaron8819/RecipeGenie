"use client"

import { useId, useMemo, useState } from "react"
import { ChevronDown, Loader2, MoreVertical, Trash2 } from "lucide-react"
import type { PantryItem } from "@/types/database"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { groupPantryItems, sortExactExclusions } from "@/lib/pantry"
import { cn } from "@/lib/utils"

interface IngredientRowProps {
  ingredient: string
  isPending: boolean
  onRemove: () => void
  pantryItemId?: string
}

function IngredientRow({
  ingredient,
  isPending,
  onRemove,
  pantryItemId,
}: IngredientRowProps) {
  return (
    <li
      className="flex min-h-11 items-center justify-between gap-2 border-b border-border-muted/70 py-1 pl-1 text-sm last:border-b-0"
      data-pantry-item={pantryItemId}
    >
      <span className="min-w-0 break-words text-foreground/90">{ingredient}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${ingredient}`}
            disabled={isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-stone-100 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 md:h-8 md:w-8"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={isPending}
            onSelect={onRemove}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

interface CategorizedPantryItemsProps {
  items: PantryItem[]
  query: string
  removingIds: Set<string>
  onRemove: (item: PantryItem) => void
}

export function CategorizedPantryItems({
  items,
  query,
  removingIds,
  onRemove,
}: CategorizedPantryItemsProps) {
  const accordionId = useId()
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set()
  )
  const normalizedQuery = query.trim().toLowerCase()
  const groups = useMemo(() => {
    return groupPantryItems(items)
      .map((group) => ({
        ...group,
        items: normalizedQuery
          ? group.items.filter((item) =>
              item.item.toLowerCase().includes(normalizedQuery)
            )
          : group.items,
      }))
      .filter((group) => group.items.length > 0)
  }, [items, normalizedQuery])

  return (
    <div className="space-y-2" data-testid="categorized-pantry-items">
      {groups.map((group) => {
        const panelId = `${accordionId}-${group.key}`
        const isExpanded = normalizedQuery
          ? true
          : !collapsedCategories.has(group.key)

        return (
          <section
            key={group.key}
            className="overflow-hidden rounded-xl border border-border-muted/80 bg-stone-50/35"
          >
            <h3>
              <button
                type="button"
                aria-label={`${group.name} ${group.items.length}`}
                aria-controls={panelId}
                aria-expanded={isExpanded}
                onClick={() => {
                  if (normalizedQuery) return
                  setCollapsedCategories((current) => {
                    const next = new Set(current)
                    if (next.has(group.key)) {
                      next.delete(group.key)
                    } else {
                      next.add(group.key)
                    }
                    return next
                  })
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-semibold text-foreground transition-colors hover:bg-sage-50/70"
              >
                <span>{group.name}</span>
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {group.items.length}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 transition-transform",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                </span>
              </button>
            </h3>
            <div id={panelId} hidden={!isExpanded}>
              <ul className="grid grid-cols-1 border-t border-border-muted/80 px-3 xl:grid-cols-2 xl:gap-x-6">
                {group.items.map((item) => (
                  <IngredientRow
                    key={item.id}
                    ingredient={item.item}
                    pantryItemId={item.id}
                    isPending={removingIds.has(item.id)}
                    onRemove={() => onRemove(item)}
                  />
                ))}
              </ul>
            </div>
          </section>
        )
      })}
    </div>
  )
}

interface ExactExclusionItemsProps {
  keywords: string[]
  query: string
  removingKeywords: Set<string>
  onRemove: (keyword: string) => void
}

export function ExactExclusionItems({
  keywords,
  query,
  removingKeywords,
  onRemove,
}: ExactExclusionItemsProps) {
  const normalizedQuery = query.trim().toLowerCase()
  const visibleKeywords = sortExactExclusions(keywords).filter((keyword) =>
    normalizedQuery ? keyword.toLowerCase().includes(normalizedQuery) : true
  )

  return (
    <ul className="border-y border-border-muted/80" data-testid="exact-exclusion-items">
      {visibleKeywords.map((keyword) => (
        <IngredientRow
          key={keyword}
          ingredient={keyword}
          isPending={removingKeywords.has(keyword)}
          onRemove={() => onRemove(keyword)}
        />
      ))}
    </ul>
  )
}
