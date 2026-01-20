"use client"

import React, { useState, useCallback } from "react"
import { Plus, X, Package, Ban, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import {
  usePantryItems,
  useAddPantryItem,
  useRemovePantryItem,
  useExcludedKeywords,
  useAddExcludedKeyword,
  useRemoveExcludedKeyword,
} from "@/hooks/use-pantry"
import { useUndoToast } from "@/hooks/use-undo-toast"

export function PantryList() {
  const [newItem, setNewItem] = useState("")
  const [newKeyword, setNewKeyword] = useState("")
  const [pendingPantryDeletion, setPendingPantryDeletion] = useState<string | null>(null)
  const [pendingKeywordDeletion, setPendingKeywordDeletion] = useState<string | null>(null)

  const { data: pantryItems, isLoading: pantryLoading, isFetching: pantryFetching } = usePantryItems()
  const { data: excludedKeywords, isLoading: keywordsLoading, isFetching: keywordsFetching } = useExcludedKeywords()

  const addPantryItem = useAddPantryItem()
  const removePantryItem = useRemovePantryItem()
  const addKeyword = useAddExcludedKeyword()
  const removeKeyword = useRemoveExcludedKeyword()
  const undoToast = useUndoToast()

  // Handle pantry item deletion with undo
  const handleRemovePantryItem = useCallback((item: string) => {
    setPendingPantryDeletion(item)
    undoToast.show({
      message: `"${item}" removed from pantry`,
      onUndo: () => {
        setPendingPantryDeletion(null)
      },
      onExpire: () => {
        removePantryItem.mutate(item)
        setPendingPantryDeletion(null)
      },
    })
  }, [undoToast, removePantryItem])

  // Handle keyword deletion with undo
  const handleRemoveKeyword = useCallback((keyword: string) => {
    setPendingKeywordDeletion(keyword)
    undoToast.show({
      message: `"${keyword}" removed from excluded keywords`,
      onUndo: () => {
        setPendingKeywordDeletion(null)
      },
      onExpire: () => {
        removeKeyword.mutate(keyword)
        setPendingKeywordDeletion(null)
      },
    })
  }, [undoToast, removeKeyword])

  // Show cached data immediately even while fetching (stale-while-revalidate)
  const displayPantryItems = pantryItems || []
  const displayKeywords = excludedKeywords || []
  
  // Only show loading on initial load with no cached data
  const showPantryLoading = pantryLoading && displayPantryItems.length === 0
  const showKeywordsLoading = keywordsLoading && displayKeywords.length === 0

  // Filter out pending deletions from display
  const displayedPantryItems = displayPantryItems.filter(item => item.item !== pendingPantryDeletion)
  const displayedKeywords = displayKeywords.filter((kw: string) => kw !== pendingKeywordDeletion)

  const handleAddPantryItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    // Split by comma and filter empty strings
    const items = newItem
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)

    if (items.length === 0) return

    try {
      // Add each item
      for (const item of items) {
        try {
          await addPantryItem.mutateAsync(item)
        } catch (error) {
          // Skip duplicates or errors for individual items
          console.warn(`Skipped pantry item "${item}":`, error)
        }
      }
      setNewItem("")
    } catch (error) {
      console.error("Failed to add pantry items:", error)
    }
  }

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyword.trim()) return

    // Split by comma and filter empty strings
    const keywords = newKeyword
      .split(",")
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0)

    if (keywords.length === 0) return

    try {
      // Add each keyword
      for (const keyword of keywords) {
        try {
          await addKeyword.mutateAsync(keyword)
        } catch (error) {
          // Skip duplicates or errors for individual keywords
          console.warn(`Skipped keyword "${keyword}":`, error)
        }
      }
      setNewKeyword("")
    } catch (error) {
      console.error("Failed to add keywords:", error)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Pantry Items */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pantry Items
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Items you already have at home. These will be excluded from shopping lists.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddPantryItem} className="flex gap-2 mb-4">
            <Input
              placeholder="Add pantry item (comma-separated)..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="text-base sm:text-sm"
            />
            <Button type="submit" size="icon" disabled={addPantryItem.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          {showPantryLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading...</p>
          ) : displayedPantryItems.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No pantry items yet
            </p>
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
                {displayedPantryItems.map((item, index) => (
                  <div
                    key={item.item}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-sage-100 text-sage-700 rounded-full text-sm font-medium animate-fade-in transition-all duration-200 hover:bg-sage-200"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <span>{item.item}</span>
                    <button
                      onClick={() => handleRemovePantryItem(item.item)}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Excluded Keywords */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            Excluded Keywords
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Ingredients containing these keywords will be auto-excluded from shopping lists.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddKeyword} className="flex gap-2 mb-4">
            <Input
              placeholder="Add excluded keyword (comma-separated)..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              className="text-base sm:text-sm"
            />
            <Button type="submit" size="icon" disabled={addKeyword.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          {showKeywordsLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading...</p>
          ) : displayedKeywords.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No excluded keywords
            </p>
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
                {displayedKeywords.map((keyword: string, index: number) => (
                  <div
                    key={keyword}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in transition-all duration-200 hover:bg-terracotta-200"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <span>{keyword}</span>
                    <button
                      onClick={() => handleRemoveKeyword(keyword)}
                      className="hover:text-terracotta-900 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
