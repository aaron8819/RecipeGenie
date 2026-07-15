"use client"

import type { ShoppingList } from "@/types/database"

export type RecipeContributionCommandResult = {
  outcome: "applied" | "deduplicated"
  shopping_list: ShoppingList
  added?: number
  merged?: number
}

export async function runRecipeContributionCommand(
  method: "POST" | "DELETE",
  body: {
    recipeIds: string[]
    recipeNames?: string[]
    scale?: number
    clearAll?: boolean
    idempotencyKey: string
  }
): Promise<RecipeContributionCommandResult> {
  const response = await fetch("/api/shopping/recipe-contributions", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const result = (await response.json()) as
    | RecipeContributionCommandResult
    | { error?: string }

  if (!response.ok || !("shopping_list" in result)) {
    throw new Error(
      "error" in result && result.error
        ? result.error
        : "Failed to update shopping contributions"
    )
  }

  return result
}
