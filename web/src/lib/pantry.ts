"use client"

import type { PantryItem } from "@/types/database"
import {
  getMatchedShoppingCategory,
  getShoppingCategories,
} from "./shopping-categories"

export interface PantryDisplayGroup {
  key: string
  name: string
  order: number
  items: PantryItem[]
}

const OTHER_CATEGORY = {
  key: "other",
  name: "Other",
  order: Number.MAX_SAFE_INTEGER,
}

export function normalizePantryItemName(item: string): string {
  return item.toLowerCase().trim()
}

export function parsePantryCandidates(rawInput: string): string[] {
  return rawInput
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
}

export function getPantryFailureInput(
  outcomes: { input: string; status: string }[]
): string {
  return outcomes
    .filter((outcome) => outcome.status === "failure")
    .map((outcome) => outcome.input)
    .join(", ")
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" })
}

export function groupPantryItems(items: PantryItem[]): PantryDisplayGroup[] {
  const categoryDefinitions = getShoppingCategories().map((category) => ({
    ...category,
    name: category.key === "pantry" ? "Pantry Staples" : category.name,
  }))
  const categoryByKey = new Map(
    categoryDefinitions.map((category) => [category.key, category])
  )
  const groups = new Map<string, PantryItem[]>()

  for (const item of items) {
    const matchedCategory = getMatchedShoppingCategory(item.item)
    const categoryKey = matchedCategory?.[0] ?? OTHER_CATEGORY.key
    const existingItems = groups.get(categoryKey) ?? []
    existingItems.push(item)
    groups.set(categoryKey, existingItems)
  }

  return [...groups.entries()]
    .map(([key, groupedItems]) => {
      const category = categoryByKey.get(key) ?? OTHER_CATEGORY
      return {
        key,
        name: category.name,
        order: category.order,
        items: [...groupedItems].sort((a, b) => compareNames(a.item, b.item)),
      }
    })
    .sort((a, b) => a.order - b.order)
}

export function sortExactExclusions(keywords: string[]): string[] {
  return [...keywords].sort(compareNames)
}
