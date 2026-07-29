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
import type {
  PantryItem,
  RationalV1,
  Recipe,
  ShoppingList,
} from "@/types/database"
import {
  isRecipeUuid,
  mapRecipeRows,
  mapShoppingItems,
  mapShoppingListRow,
  type RecipeRow,
} from "@/lib/recipe-identity"
import {
  normalizeScaleRatioV1,
  rationalToNumber,
} from "@/lib/recipe-quantity"
import {
  RECIPE_DATA_LIMITS,
  normalizeShoppingItems,
} from "@/lib/recipe-data-validation"

const MAX_COMMAND_RETRIES = 4
const MAX_RECIPES_PER_COMMAND = 100

type StoredContribution = {
  recipe_uuid: string
  servings: number
  scale: number
  normalization_version: number
  snapshot: {
    recipeName: string
    items: ShoppingContributionItem[]
    exactScaleV1?: RationalV1
  }
}

type StoredContributionState = {
  shopping_list: ShoppingList
  contributions: StoredContribution[]
}

function userCorrelation(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12)
}

function identifierCorrelation(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function parseBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid request body")
  }
  const command = body as Record<string, unknown>
  if (
    command.recipeIds !== undefined &&
    (!Array.isArray(command.recipeIds) ||
      command.recipeIds.some((id) => typeof id !== "string"))
  ) {
    throw new Error("Recipe IDs must be an array of UUIDs")
  }
  const recipeIds = [...new Set(
    ((command.recipeIds as string[] | undefined) || [])
      .map((id) => id.trim())
  )]
    .filter(Boolean)
    .sort()
  const scaleV1 =
    command.scaleV1 === undefined
      ? undefined
      : normalizeScaleRatioV1(command.scaleV1) || undefined
  const exactScale = scaleV1
    ? rationalToNumber(scaleV1)
    : null
  if (command.scaleV1 !== undefined && exactScale == null) {
    throw new Error("Exact scale must be a valid positive rational")
  }
  if (
    command.scale !== undefined &&
    typeof command.scale !== "number"
  ) {
    throw new Error("Scale must be a number")
  }
  const scale = exactScale ?? command.scale ?? 1
  if (
    command.idempotencyKey !== undefined &&
    typeof command.idempotencyKey !== "string"
  ) {
    throw new Error("A valid idempotency key is required")
  }
  const idempotencyKey =
    (command.idempotencyKey as string | undefined)?.trim() || ""
  if (
    command.clearAll !== undefined &&
    typeof command.clearAll !== "boolean"
  ) {
    throw new Error("clearAll must be a boolean")
  }

  if (recipeIds.length > MAX_RECIPES_PER_COMMAND) {
    throw new Error("Too many recipes in one shopping command")
  }
  if (recipeIds.some((id) => !isRecipeUuid(id))) {
    throw new Error("Recipe IDs must be UUIDs")
  }
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
    throw new Error("Scale must be greater than zero")
  }
  if (
    exactScale != null &&
    command.scale != null &&
    Math.abs(exactScale - Number(command.scale)) > 1e-12
  ) {
    throw new Error("Numeric and exact scales must agree")
  }
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error("A valid idempotency key is required")
  }

  return {
    recipeIds,
    scale,
    scaleV1,
    idempotencyKey,
    clearAll: Boolean(command.clearAll),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function storedToDomain(
  value: unknown
): RecipeShoppingContribution | null {
  if (!isRecord(value) || !isRecord(value.snapshot)) return null
  const row = value as unknown as StoredContribution
  const items = normalizeShoppingItems(row.snapshot.items, "hydrate")
  const exactScale =
    row.snapshot.exactScaleV1 === undefined
      ? undefined
      : normalizeScaleRatioV1(row.snapshot.exactScaleV1)
  if (
    typeof row.recipe_uuid !== "string" ||
    !isRecipeUuid(row.recipe_uuid) ||
    !Number.isSafeInteger(row.servings) ||
    row.servings <= 0 ||
    row.servings > RECIPE_DATA_LIMITS.numericAmount ||
    !Number.isFinite(row.scale) ||
    row.scale <= 0 ||
    row.scale > 100 ||
    !Number.isSafeInteger(row.normalization_version) ||
    row.normalization_version <= 0 ||
    typeof row.snapshot.recipeName !== "string" ||
    row.snapshot.recipeName.length === 0 ||
    row.snapshot.recipeName.length > RECIPE_DATA_LIMITS.recipeNameLength ||
    !items ||
    (row.snapshot.exactScaleV1 !== undefined && !exactScale)
  ) {
    return null
  }
  const contributionItems: ShoppingContributionItem[] = []
  for (const item of items) {
    const bucket = (item as ShoppingContributionItem).bucket
    if (!["items", "already_have", "excluded"].includes(bucket)) return null
    contributionItems.push({ ...item, bucket })
  }
  return {
    recipeId: row.recipe_uuid,
    recipeName: row.snapshot.recipeName,
    servings: row.servings,
    scale: row.scale,
    scaleV1: exactScale || undefined,
    normalizationVersion: row.normalization_version,
    items: mapShoppingItems(contributionItems),
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
  scale: number,
  scaleV1?: RationalV1
): RecipeShoppingContribution {
  const result = generateShoppingList(
    [recipe],
    pantryItems,
    config.excluded_keywords || [],
    scale,
    config.category_overrides || null,
    normalizeShoppingItemOrderPreferences(config.shopping_item_order),
    scaleV1
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
    scaleV1,
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
    input = parseBody(await request.json())
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
    !input.clearAll
  ) {
    return NextResponse.json({ error: "At least one recipe is required" }, { status: 400 })
  }

  const correlation = userCorrelation(user.id)

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
    if (
      !isRecord(state) ||
      !isRecord(state.shopping_list) ||
      !Array.isArray(state.contributions)
    ) {
      return NextResponse.json(
        { error: "Stored shopping state is invalid" },
        { status: 409 }
      )
    }
    const currentList = mapShoppingListRow(state.shopping_list as never)
    const normalizedContributions = state.contributions.map(storedToDomain)
    if (normalizedContributions.some((contribution) => !contribution)) {
      return NextResponse.json(
        { error: "Stored shopping contribution data is invalid" },
        { status: 409 }
      )
    }
    const previousContributions =
      normalizedContributions as RecipeShoppingContribution[]
    const pantryItems = (pantryResult.data || []) as PantryItem[]
    const config = (configResult.data || {}) as {
      excluded_keywords?: string[] | null
      category_overrides?: Record<string, string> | null
      shopping_item_order?: unknown
    }
    let nextContributions = [...previousContributions]
    let contributionPayload: Array<{
      recipe_uuid: string
      servings: number
      scale: number
      normalization_version: number
      snapshot: StoredContribution["snapshot"]
    }> = []

    if (commandType === "add_or_replace") {
      const { data: recipes, error: recipeError } = await supabase
        .from("recipes")
        .select("*")
        .in("recipe_uuid", input.recipeIds)
        .eq("user_id", user.id)

      if (recipeError) throw recipeError
      if ((recipes || []).length !== input.recipeIds.length) {
        return NextResponse.json({ error: "Recipe not found" }, { status: 404 })
      }

      const replacements = mapRecipeRows(recipes as RecipeRow[] | null)
        .map((recipe) =>
          buildContribution(
            recipe,
            pantryItems,
            config,
            input.scale,
            input.scaleV1
          )
        )
        .sort((left, right) => left.recipeId.localeCompare(right.recipeId))
      const replacementIds = new Set(replacements.map((item) => item.recipeId))
      nextContributions = [
        ...previousContributions.filter(
          (contribution) => !replacementIds.has(contribution.recipeId)
        ),
        ...replacements,
      ]
      contributionPayload = replacements.map((contribution) => {
        const safeItems = normalizeShoppingItems(
          contribution.items,
          "persist"
        )
        if (!safeItems) {
          throw new Error("Generated shopping contribution is invalid")
        }
        return {
          recipe_uuid: contribution.recipeId,
          servings: contribution.servings,
          scale: contribution.scale,
          normalization_version: contribution.normalizationVersion,
          snapshot: {
            recipeName: contribution.recipeName,
            items: safeItems as ShoppingContributionItem[],
            exactScaleV1: contribution.scaleV1,
          },
        }
      })
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
    const safeProjectionItems = normalizeShoppingItems(
      projection.shoppingList.items,
      "persist"
    )
    const safeProjectionAlreadyHave = normalizeShoppingItems(
      projection.shoppingList.already_have,
      "persist"
    )
    const safeProjectionExcluded = normalizeShoppingItems(
      projection.shoppingList.excluded,
      "persist"
    )
    if (
      !safeProjectionItems ||
      !safeProjectionAlreadyHave ||
      !safeProjectionExcluded
    ) {
      return NextResponse.json(
        { error: "Generated shopping projection is invalid" },
        { status: 500 }
      )
    }
    const recipeCorrelations = input.recipeIds.map(identifierCorrelation)
    const idempotencyCorrelation = identifierCorrelation(input.idempotencyKey)

    const uuidCommandClient = supabase as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{
        data: unknown
        error: { code?: string; message: string } | null
      }>
    }
    const { data, error } = await uuidCommandClient.rpc(
      "apply_recipe_shopping_contribution_uuid_command",
      {
        p_expected_revision: currentList.contribution_revision || 0,
        p_contributions: contributionPayload,
        p_remove_recipe_uuids:
          commandType === "remove" ? input.recipeIds : [],
        p_projection: {
          ...projection.shoppingList,
          items: safeProjectionItems,
          already_have: safeProjectionAlreadyHave,
          excluded: safeProjectionExcluded,
          source_recipe_uuids: projection.shoppingList.source_recipes,
        },
        p_contribution_overrides: projection.overrides,
        p_idempotency_key: input.idempotencyKey,
        p_command_type: commandType,
      }
    )

    if (isRevisionConflict(error)) {
      console.info("shopping_contribution_command", {
        commandType,
        user: correlation,
        recipeCount: input.recipeIds.length,
        recipeCorrelations,
        idempotencyCorrelation,
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
        recipeCount: input.recipeIds.length,
        recipeCorrelations,
        idempotencyCorrelation,
        normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
        failureCategory: error.code || "database_error",
      })
      throw error
    }

    const result = data as unknown as {
      outcome: "applied" | "deduplicated"
      shopping_list: ShoppingList
    }
    const applicationShoppingList = mapShoppingListRow(
      result.shopping_list as never
    )
    console.info("shopping_contribution_command", {
      commandType,
      user: correlation,
      recipeCount: input.recipeIds.length,
      recipeCorrelations,
      idempotencyCorrelation,
      normalizationVersion: SHOPPING_NORMALIZATION_VERSION,
      result: result.outcome,
      affectedAggregateItemCount:
        applicationShoppingList.items.length +
        applicationShoppingList.already_have.length +
        applicationShoppingList.excluded.length,
    })

    const previousKeys = new Set(
      currentList.items.map((item) => item.contributionKey || item.rowId || item.item)
    )
    const nextKeys = applicationShoppingList.items.map(
      (item) => item.contributionKey || item.rowId || item.item
    )
    const added = result.outcome === "deduplicated"
      ? 0
      : nextKeys.filter((key) => !previousKeys.has(key)).length
    const merged = result.outcome === "deduplicated"
      ? 0
      : nextKeys.filter((key) => previousKeys.has(key)).length

    return NextResponse.json({
      ...result,
      shopping_list: applicationShoppingList,
      added,
      merged,
    })
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
