"use client"

import { useState } from "react"
import { Plus, Trash2, Package, Ban, Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  useShoppingList,
  useAddShoppingItem,
  useRemoveShoppingItem,
  useClearShoppingList,
  useCheckOffItem,
} from "@/hooks/use-shopping"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import type { ShoppingItem } from "@/types/database"
import { toFraction } from "@/lib/utils"

export function ShoppingListView() {
  const [newItem, setNewItem] = useState("")

  const { data: shoppingList, isLoading } = useShoppingList()

  const addItem = useAddShoppingItem()
  const removeItem = useRemoveShoppingItem()
  const clearList = useClearShoppingList()
  const checkOffItem = useCheckOffItem()

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    try {
      await addItem.mutateAsync({ itemName: newItem })
      setNewItem("")
    } catch (error) {
      console.error("Failed to add item:", error)
    }
  }

  const handleClearList = async () => {
    if (confirm("Clear the entire shopping list?")) {
      await clearList.mutateAsync()
    }
  }

  const handleCopyList = async () => {
    if (!shoppingList?.items?.length) return

    // Format the list as plain text grouped by category
    const lines: string[] = []
    
    Object.entries(SHOPPING_CATEGORIES)
      .sort(([, a], [, b]) => a.order - b.order)
      .forEach(([categoryKey, categoryData]) => {
        const items = (shoppingList.items || []).filter(
          (item) => (item.categoryKey || "misc") === categoryKey
        )
        if (items.length === 0) return

        lines.push(`${categoryData.name}:`)
        items.forEach((item) => {
          const amount = item.amount ? toFraction(item.amount) : ""
          const unit = item.unit || ""
          const prefix = amount ? `${amount}${unit ? " " + unit : ""} ` : ""
          lines.push(`  - ${prefix}${item.item}`)
        })
        lines.push("")
      })

    const text = lines.join("\n").trim()
    
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.error("Failed to copy:", error)
    }
  }

  // Group items by category
  const groupedItems = (shoppingList?.items || []).reduce(
    (acc, item) => {
      const category = item.categoryKey || "misc"
      if (!acc[category]) acc[category] = []
      acc[category].push(item)
      return acc
    },
    {} as Record<string, ShoppingItem[]>
  )

  const formatAmount = (item: ShoppingItem) => {
    if (!item.amount) return ""
    const amt = toFraction(item.amount)
    return `${amt}${item.unit ? " " + item.unit : ""}`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Shopping List</h1>

      {/* Add Item */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleAddItem} className="flex gap-2">
            <Input
              placeholder="Add item to list..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={addItem.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Shopping List */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : !shoppingList?.items?.length ? (
        <p className="text-center text-muted-foreground py-8">
          Shopping list is empty. Add items above to get started!
        </p>
      ) : (
        <div className="space-y-4">
          {/* Main shopping items grouped by category */}
          {Object.entries(SHOPPING_CATEGORIES)
            .sort(([, a], [, b]) => a.order - b.order)
            .map(([categoryKey, categoryData]) => {
              const items = groupedItems[categoryKey]
              if (!items || items.length === 0) return null

              return (
                <Card key={categoryKey} className="animate-fade-in">
                  <CardHeader className="py-3 bg-sage-50 rounded-t-xl">
                    <CardTitle className="text-sm font-semibold text-sage-700 flex items-center gap-2">
                      <Package className="h-4 w-4" />
                      {categoryData.name}
                      <span className="text-xs font-normal text-sage-500">({items.length})</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-3">
                    <ul className="space-y-2">
                      {items.map((item, index) => (
                        <li
                          key={item.item}
                          className="flex items-center justify-between py-1 animate-fade-in"
                          style={{ animationDelay: `${index * 30}ms` }}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => checkOffItem.mutate(item)}
                              disabled={checkOffItem.isPending}
                              className="w-5 h-5 rounded border-2 border-sage-300 flex items-center justify-center transition-colors hover:border-sage-500 hover:bg-sage-100"
                            >
                              <Check className="h-3 w-3 text-transparent hover:text-sage-500" />
                            </button>
                            <span className="text-foreground">
                              {formatAmount(item) && (
                                <span className="text-muted-foreground mr-1.5 font-medium">
                                  {formatAmount(item)}
                                </span>
                              )}
                              {item.item}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeItem.mutate(item.item)}
                            disabled={removeItem.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )
            })}

          {/* Already Have Section */}
          {shoppingList.already_have && shoppingList.already_have.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="py-3 bg-sage-50 rounded-t-xl">
                <CardTitle className="text-sm font-semibold text-sage-700 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Already Have
                  <span className="text-xs font-normal text-sage-500">({shoppingList.already_have.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="flex flex-wrap gap-2">
                  {shoppingList.already_have.map((item, index) => (
                    <span
                      key={item.item}
                      className="px-2.5 py-1 bg-sage-100 text-sage-700 rounded-full text-sm font-medium animate-fade-in"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {item.item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Excluded Section */}
          {shoppingList.excluded && shoppingList.excluded.length > 0 && (
            <Card className="animate-fade-in">
              <CardHeader className="py-3 bg-terracotta-50 rounded-t-xl">
                <CardTitle className="text-sm font-semibold text-terracotta-700 flex items-center gap-2">
                  <Ban className="h-4 w-4" />
                  Excluded
                  <span className="text-xs font-normal text-terracotta-500">({shoppingList.excluded.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-3">
                <div className="flex flex-wrap gap-2">
                  {shoppingList.excluded.map((item, index) => (
                    <span
                      key={item.item}
                      className="px-2.5 py-1 bg-terracotta-100 text-terracotta-700 rounded-full text-sm font-medium animate-fade-in"
                      style={{ animationDelay: `${index * 20}ms` }}
                    >
                      {item.item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCopyList}
              className="flex-1"
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={handleClearList}
              disabled={clearList.isPending}
              className="flex-1"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
