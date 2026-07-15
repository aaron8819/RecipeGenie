import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { generateShoppingList } from "@/lib/shopping-list"
import {
  projectShoppingContributions,
  SHOPPING_NORMALIZATION_VERSION,
  type RecipeShoppingContribution,
  type ShoppingContributionItem,
  type ShoppingContributionOverrides,
} from "@/lib/shopping-contributions"
import { normalizeShoppingItemOrderPreferences } from "@/lib/shopping-item-order"
import type { PantryItem, Recipe, ShoppingList } from "@/types/database"

const MAX_COMMAND_RETRIES = 4
const MAX_RECIPES_PER_COMMAND = 100

type CommandBody = {
  recipeIds?: string[]
  recipeNames?: string[]
  scale?: number
  idempotencyKey?: string
  clearAll?: boolean
}

type StoredContribution = {
  recipe_id: string
  servings: number
  scale: number
  normalization_version: number
  snapshot: {
    recipeName: string
    items: ShoppingContributionItem[]
  }
}

type StoredContributionState = {
  shopping_list: ShoppingList
  contributions: StoredContribution[]
}

function userCorrelation(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12)
}

function parseBody(body: CommandBody) {
  const recipeIds = [...new Set((body.recipeIds || []).map((id) => id.trim()))]
    .filter(Boolean)
    .sort()
  const recipeNames = [
    ...new Set((body.recipeNames || []).map((name) => name.trim())),
  ].filter(Boolean)
  const scale = body.scale ?? 1
  const idempotencyKey = body.idempotencyKey?.trim() || ""

  if (recipeIds.length + recipeNames.length > MAX_RECIPES_PER_COMMAND) {
    throw new Error("Too many recipes in one shopping command")
  }
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
    throw new Error("Scale must be greater than zero")
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error("A valid idempotency key is required")
  }

  return {
    recipeIds,
    recipeNames,
    scale,
    idempotencyKey,
    clearAll: Boolean(body.clearAll),
  }
}

function storedToDomain(row: StoredContribution): RecipeShoppingContribution {
  return {
    recipeId: row.recipe_id,
    recipeName: row.snapshot.recipeName,
    servings: row.servings,
    scale: row.scale,
    normalizationVersion: row.normalization_version,
    items: row.snapshot.items,
  }
}

function buildContribution(
  recipe: Recipe,
  pantryItems: PantryItem[],
  config: {
    excluded_keywords?: string[] | null
    category_overrides?: Record<string, string> | null
    shopping_item_order?: unknown
  },
  scale: number
): RecipeShoppingContribution {
  const result = generateShoppingList(
    [recipe],
    pantryItems,
    config.excluded_keywords || [],
    scale,
    config.category_overrides || null,
    normalizeShoppingItemOrderPreferences(config.shopping_item_order)
  )
  const withBucket = (
    bucket: ShoppingContributionItem["bucket"],
    items: ShoppingContributionItem[] | typeof result.items
  ): ShoppingContributionItem[] =>
    items.map((item) => ({ ...item, bucket }))

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    servings: result.totalServings,
    scale,
    normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
    items: [
      ...withBucket("items", result.items),
      ...withBucket("already_have", result.alreadyHave),
      ...withBucket("excluded", result.excluded),
    ],
  }
}

function isRevisionConflict(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "40001" ||
    error?.message?.includes("shopping contribution revision conflict")
  )
}

async function executeCommand(request: Request, commandType: "add_or_replace" | "remove") {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let input: ReturnType<typeof parseBody>
  try {
    input = parseBody((await request.json()) as CommandBody)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request body" },
      { status: 400 }
    )
  }

  if (commandType === "add_or_replace" && input.recipeIds.length === 0) {
    return NextResponse.json({ error: "At least one recipe is required" }, { status: 400 })
  }
  if (
    commandType === "remove" &&
    input.recipeIds.length === 0 &&
    input.recipeNames.length === 0 &&
    !input.clearAll
  ) {
    return NextResponse.json({ error: "At least one recipe is required" }, { status: 400 })
  }

  const correlation = userCorrelation(user.id)

  if (commandType === "remove" && input.recipeNames.length > 0) {
    const { data: namedRecipes, error: namedRecipeError } = await supabase
      .from("recipes")
      .select("id, name")
      .in("name", input.recipeNames)
      .eq("user_id", user.id)
    if (namedRecipeError) throw namedRecipeError

    for (const recipeName of input.recipeNames) {
      const matches = (namedRecipes || []).filter(
        (recipe) => recipe.name === recipeName
      )
      if (matches.length !== 1) {
        return NextResponse.json(
          { error: "Legacy recipe source could not be resolved uniquely" },
          { status: 409 }
        )
      }
      input.recipeIds.push(matches[0].id)
    }
    input.recipeIds = [...new Set(input.recipeIds)].sort()
  }

  for (let attempt = 0; attempt < MAX_COMMAND_RETRIES; attempt++) {
    const [stateResult, pantryResult, configResult] =
      await Promise.all([
        supabase.rpc("get_recipe_shopping_contribution_state"),
        supabase.from("pantry_items").select("*"),
        supabase
          .from("user_config")
          .select("excluded_keywords, category_overrides, shopping_item_order")
          .maybeSingle(),
      ])

    if (stateResult.error) throw stateResult.error
    if (pantryResult.error) throw pantryResult.error
    if (configResult.error) throw configResult.error

    const state = stateResult.data as unknown as StoredContributionState
    const currentList = state.shopping_list
    const previousContributions = (state.contributions || []).map(storedToDomain)
    const pantryItems = (pantryResult.data || []) as PantryItem[]
    const config = (configResult.data || {}) as {
      excluded_keywords?: string[] | null
      category_overrides?: Record<string, string> | null
      shopping_item_order?: unknown
    }
    let nextContributions = [...previousContributions]
    let contributionPayload: Array<{
      recipe_id: string
      servings: number
      scale: number
      normalization_version: number
      snapshot: StoredContribution["snapshot"]
    }> = []

    if (commandType === "add_or_replace") {
      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("*")
        .in("id", input.recipeIds)
        .eq("user_id", user.id)

      if (recipeError) throw recipeError
      if ((recipes || []).length !== input.recipeIds.length) {
        return NextResponse.json({ error: "Recipe not found" }, { status: 404 })
      }

      const replacements = (recipes as Recipe[])
        .map((recipe) => buildContribution(recipe, pantryItems, config, input.scale))
        .sort((left, right) => left.recipeId.localeCompare(right.recipeId))
      const replacementIds = new Set(replacements.map((item) => item.recipeId))
      nextContributions = [
        ...previousContributions.filter(
          (contribution) => !replacementIds.has(contribution.recipeId)
        ),
        ...replacements,
      ]
      contributionPayload = replacements.map((contribution) => ({
        recipe_id: contribution.recipeId,
        servings: contribution.servings,
        scale: contribution.scale,
        normalization_version: contribution.normalizationVersion,
        snapshot: {
          recipeName: contribution.recipeName,
          items: contribution.items,
        },
      }))
    } else {
      const removeIds = input.clearAll
        ? previousContributions.map((contribution) => contribution.recipeId)
        : input.recipeIds
      const removeSet = new Set(removeIds)
      nextContributions = previousContributions.filter(
        (contribution) => !removeSet.has(contribution.recipeId)
      )
      input.recipeIds = removeIds
    }

    const projection = projectShoppingContributions({
      currentList,
      previousContributions,
      nextContributions,
      existingOverrides:
        (currentList.contribution_overrides as ShoppingContributionOverrides) || {},
      replacingRecipeIds:
        commandType === "add_or_replace" ? input.recipeIds : [],
      clearAll: input.clearAll,
      shoppingItemOrder: normalizeShoppingItemOrderPreferences(
        config.shopping_item_order
      ),
    })

    const { data, error } = await supabase.rpc(
      "apply_recipe_shopping_contribution_command",
      {
        p_expected_revision: currentList.contribution_revision || 0,
        p_contributions: contributionPayload,
        p_remove_recipe_ids:
          commandType === "remove" ? input.recipeIds : [],
        p_projection: projection.shoppingList,
        p_contribution_overrides: projection.overrides,
        p_idempotency_key: input.idempotencyKey,
        p_command_type: commandType,
      }
    )

    if (isRevisionConflict(error)) {
      console.info("shopping_contribution_command", {
        commandType,
        user: correlation,
        recipeIds: input.recipeIds,
        idempotencyKey: input.idempotencyKey,
        normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
        result: "revision_retry",
        attempt: attempt + 1,
      })
      continue
    }
    if (error) {
      console.error("shopping_contribution_command", {
        commandType,
        user: correlation,
        recipeIds: input.recipeIds,
        idempotencyKey: input.idempotencyKey,
        normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
        failureCategory: error.code || "database_error",
      })
      throw error
    }

    const result = data as unknown as {
      outcome: "applied" | "deduplicated"
      shopping_list: ShoppingList
    }
    console.info("shopping_contribution_command", {
      commandType,
      user: correlation,
      recipeIds: input.recipeIds,
      idempotencyKey: input.idempotencyKey,
      normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
      result: result.outcome,
      affectedAggregateItemCount:
        result.shopping_list.items.length +
        result.shopping_list.already_have.length +
        result.shopping_list.excluded.length,
    })

    const previousKeys = new Set(
      currentList.items.map((item) => item.contributionKey || item.rowId || item.item)
    )
    const nextKeys = result.shopping_list.items.map(
      (item) => item.contributionKey || item.rowId || item.item
    )
    const added = result.outcome === "deduplicated"
      ? 0
      : nextKeys.filter((key) => !previousKeys.has(key)).length
    const merged = result.outcome === "deduplicated"
      ? 0
      : nextKeys.filter((key) => previousKeys.has(key)).length

    return NextResponse.json({ ...result, added, merged })
  }

  return NextResponse.json(
    { error: "Shopping list changed concurrently. Please retry." },
    { status: 409 }
  )
}

export function POST(request: Request) {
  return executeCommand(request, "add_or_replace")
}

export function DELETE(request: Request) {
  return executeCommand(request, "remove")
}
