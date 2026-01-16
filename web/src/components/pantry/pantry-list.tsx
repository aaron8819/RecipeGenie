"use client"

import { useState } from "react"
import { Plus, X, Package, Ban } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  usePantryItems,
  useAddPantryItem,
  useRemovePantryItem,
  useExcludedKeywords,
  useAddExcludedKeyword,
  useRemoveExcludedKeyword,
} from "@/hooks/use-pantry"

export function PantryList() {
  const [newItem, setNewItem] = useState("")
  const [newKeyword, setNewKeyword] = useState("")

  const { data: pantryItems, isLoading: pantryLoading } = usePantryItems()
  const { data: excludedKeywords, isLoading: keywordsLoading } = useExcludedKeywords()

  const addPantryItem = useAddPantryItem()
  const removePantryItem = useRemovePantryItem()
  const addKeyword = useAddExcludedKeyword()
  const removeKeyword = useRemoveExcludedKeyword()

  const handleAddPantryItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    try {
      await addPantryItem.mutateAsync(newItem)
      setNewItem("")
    } catch (error) {
      console.error("Failed to add pantry item:", error)
    }
  }

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newKeyword.trim()) return

    try {
      await addKeyword.mutateAsync(newKeyword)
      setNewKeyword("")
    } catch (error) {
      console.error("Failed to add keyword:", error)
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
              placeholder="Add pantry item..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
            />
            <Button type="submit" size="icon" disabled={addPantryItem.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          {pantryLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading...</p>
          ) : pantryItems?.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No pantry items yet
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pantryItems?.map((item, index) => (
                <div
                  key={item.item}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sage-100 text-sage-700 rounded-full text-sm font-medium animate-fade-in transition-all duration-200 hover:bg-sage-200"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <span>{item.item}</span>
                  <button
                    onClick={() => removePantryItem.mutate(item.item)}
                    className="hover:text-destructive transition-colors"
                    disabled={removePantryItem.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
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
              placeholder="Add excluded keyword..."
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
            />
            <Button type="submit" size="icon" disabled={addKeyword.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </form>

          {keywordsLoading ? (
            <p className="text-muted-foreground text-center py-4">Loading...</p>
          ) : excludedKeywords?.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              No excluded keywords
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {excludedKeywords?.map((keyword: string, index: number) => (
                <div
                  key={keyword}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in transition-all duration-200 hover:bg-terracotta-200"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <span>{keyword}</span>
                  <button
                    onClick={() => removeKeyword.mutate(keyword)}
                    className="hover:text-terracotta-900 transition-colors"
                    disabled={removeKeyword.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
