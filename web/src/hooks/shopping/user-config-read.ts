"use client"

import { getSupabase } from "@/lib/supabase/client"

export type ShoppingUserConfig = {
  excluded_keywords?: string[]
  category_overrides?: Record<string, string>
  shopping_item_order?: unknown
}

function isMissingShoppingItemOrderColumn(error: unknown): boolean {
  if (!error) return false
  const serialized = JSON.stringify(error).toLowerCase()
  return (
    serialized.includes("shopping_item_order") ||
    serialized.includes("pgrst204")
  )
}

async function fetchConfigWithOptionalShoppingItemOrder(
  selectWithOrder: string,
  selectWithoutOrder: string,
  options: { maybeSingle?: boolean } = {}
): Promise<ShoppingUserConfig> {
  const supabase = getSupabase()
  const withOrderQuery = supabase.from("user_config").select(selectWithOrder)
  const withOrderRes = options.maybeSingle
    ? await withOrderQuery.maybeSingle()
    : await withOrderQuery.single()

  if (!withOrderRes.error) {
    return (withOrderRes.data as ShoppingUserConfig | null) || {}
  }

  if (!isMissingShoppingItemOrderColumn(withOrderRes.error)) {
    throw withOrderRes.error
  }

  if (!selectWithoutOrder) return {}

  const fallbackQuery = supabase.from("user_config").select(selectWithoutOrder)
  const fallbackRes = options.maybeSingle
    ? await fallbackQuery.maybeSingle()
    : await fallbackQuery.single()

  if (fallbackRes.error) throw fallbackRes.error
  return (fallbackRes.data as ShoppingUserConfig | null) || {}
}

export function fetchShoppingGenerationConfig(): Promise<ShoppingUserConfig> {
  return fetchConfigWithOptionalShoppingItemOrder(
    "excluded_keywords, category_overrides, shopping_item_order",
    "excluded_keywords, category_overrides"
  )
}

export function fetchShoppingItemConfig(): Promise<ShoppingUserConfig> {
  return fetchConfigWithOptionalShoppingItemOrder(
    "category_overrides, shopping_item_order",
    "category_overrides"
  )
}

export function fetchShoppingItemOrderConfig(): Promise<ShoppingUserConfig> {
  return fetchConfigWithOptionalShoppingItemOrder(
    "shopping_item_order",
    "",
    { maybeSingle: true }
  )
}

export async function saveShoppingItemOrderPreference(
  userId: string,
  shoppingItemOrder: Record<string, string[]>
): Promise<void> {
  const { error } = await getSupabase()
    .from("user_config")
    .upsert(
      { user_id: userId, shopping_item_order: shoppingItemOrder },
      { onConflict: "user_id" }
    )

  if (error && !isMissingShoppingItemOrderColumn(error)) {
    throw error
  }
}
