/**
 * Migration script to import data from local JSON files to Supabase
 *
 * Usage:
 *   npx ts-node scripts/migrate.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"
import * as fs from "fs"
import * as path from "path"
import { config } from "dotenv"
import { fileURLToPath } from "url"

// Load environment variables
config({ path: ".env.local" })

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing required environment variables:")
  console.error("  NEXT_PUBLIC_SUPABASE_URL")
  console.error("  SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Path to data directory (relative to web folder)
const DATA_DIR = path.join(__dirname, "../../data")

interface JsonRecipe {
  id: string
  name: string
  category: string
  servings: number
  favorite?: boolean
  tags?: string[]
  ingredients: Array<{
    item: string
    amount?: number
    unit?: string
    shoppingCategory?: string
  }>
  instructions: string[]
}

interface JsonPantryItem {
  item: string
}

interface JsonConfig {
  categories: string[]
  default_selection: Record<string, number>
  excluded_keywords: string[]
  historyExclusionDays: number
  weekStartDay?: number
}

interface JsonHistoryEntry {
  recipe_id: string
  date_made: string
}

interface JsonWeeklyPlan {
  recipes: string[]
  scale?: number
  generated_at?: string
}

interface JsonShoppingList {
  items: Array<{
    item: string
    amount?: number
    unit?: string
    categoryKey?: string
    categoryOrder?: number
    sources?: Array<{ recipeName: string }>
    shoppingCategory?: string
  }>
  already_have?: any[]
  excluded?: any[]
  source_recipes?: string[]
  scale?: number
  total_servings?: number
  customOrder?: boolean
  generated_at?: string
}

function loadJson<T>(filename: string, defaultValue: T): T {
  const filepath = path.join(DATA_DIR, filename)
  if (!fs.existsSync(filepath)) {
    console.log(`  ${filename} not found, using default`)
    return defaultValue
  }
  const content = fs.readFileSync(filepath, "utf-8")
  return JSON.parse(content)
}

async function migrateRecipes(): Promise<void> {
  console.log("\n📚 Migrating recipes...")
  const recipes = loadJson<JsonRecipe[]>("recipes.json", [])

  if (recipes.length === 0) {
    console.log("  No recipes to migrate")
    return
  }

  // Transform to database format
  const dbRecipes = recipes.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    servings: r.servings || 4,
    favorite: r.favorite || false,
    tags: r.tags || [],
    ingredients: r.ingredients || [],
    instructions: r.instructions || [],
  }))

  // Batch insert (100 at a time)
  const batchSize = 100
  for (let i = 0; i < dbRecipes.length; i += batchSize) {
    const batch = dbRecipes.slice(i, i + batchSize)
    const { error } = await supabase
      .from("recipes")
      .upsert(batch, { onConflict: "id" })

    if (error) {
      console.error(`  Error inserting batch ${i / batchSize + 1}:`, error.message)
    } else {
      console.log(`  Inserted batch ${i / batchSize + 1} (${batch.length} recipes)`)
    }
  }

  console.log(`  ✅ Migrated ${recipes.length} recipes`)
}

async function migratePantry(): Promise<void> {
  console.log("\n🥫 Migrating pantry items...")
  const pantry = loadJson<JsonPantryItem[]>("pantry.json", [])

  if (pantry.length === 0) {
    console.log("  No pantry items to migrate")
    return
  }

  const dbPantry = pantry.map((p) => ({
    item: p.item.toLowerCase().trim(),
  }))

  const { error } = await supabase
    .from("pantry_items")
    .upsert(dbPantry, { onConflict: "item" })

  if (error) {
    console.error("  Error:", error.message)
  } else {
    console.log(`  ✅ Migrated ${pantry.length} pantry items`)
  }
}

async function migrateConfig(): Promise<void> {
  console.log("\n⚙️ Migrating config...")
  const config = loadJson<JsonConfig>("config.json", {
    categories: ["chicken", "turkey", "steak"],
    default_selection: { chicken: 2, turkey: 1, steak: 1 },
    excluded_keywords: [],
    historyExclusionDays: 7,
    weekStartDay: 1,
  })

  const dbConfig = {
    id: 1,
    categories: config.categories,
    default_selection: config.default_selection,
    excluded_keywords: config.excluded_keywords || [],
    history_exclusion_days: config.historyExclusionDays || 7,
    week_start_day: config.weekStartDay || 1,
  }

  const { error } = await supabase
    .from("user_config")
    .upsert(dbConfig, { onConflict: "id" })

  if (error) {
    console.error("  Error:", error.message)
  } else {
    console.log("  ✅ Migrated config")
  }
}

async function migrateHistory(): Promise<void> {
  console.log("\n📅 Migrating recipe history...")
  const history = loadJson<JsonHistoryEntry[]>("history.json", [])

  if (history.length === 0) {
    console.log("  No history to migrate")
    return
  }

  const dbHistory = history.map((h) => ({
    recipe_id: h.recipe_id,
    date_made: h.date_made,
  }))

  // Clear existing history first (to avoid duplicates)
  await supabase.from("recipe_history").delete().neq("id", 0)

  const { error } = await supabase.from("recipe_history").insert(dbHistory)

  if (error) {
    console.error("  Error:", error.message)
  } else {
    console.log(`  ✅ Migrated ${history.length} history entries`)
  }
}

async function migrateWeeklyPlans(): Promise<void> {
  console.log("\n📆 Migrating weekly plans...")
  const plans = loadJson<Record<string, JsonWeeklyPlan>>("weekly-plans.json", {})

  const entries = Object.entries(plans)
  if (entries.length === 0) {
    console.log("  No weekly plans to migrate")
    return
  }

  const dbPlans = entries.map(([weekDate, plan]) => ({
    week_date: weekDate,
    recipe_ids: plan.recipes || [],
    scale: plan.scale || 1.0,
    generated_at: plan.generated_at || new Date().toISOString(),
  }))

  const { error } = await supabase
    .from("weekly_plans")
    .upsert(dbPlans, { onConflict: "week_date" })

  if (error) {
    console.error("  Error:", error.message)
  } else {
    console.log(`  ✅ Migrated ${entries.length} weekly plans`)
  }
}

async function migrateShoppingList(): Promise<void> {
  console.log("\n🛒 Migrating shopping list...")
  const list = loadJson<JsonShoppingList>("shopping-list.json", {
    items: [],
  })

  const dbList = {
    id: 1,
    items: list.items || [],
    already_have: list.already_have || [],
    excluded: list.excluded || [],
    source_recipes: list.source_recipes || [],
    scale: list.scale || 1.0,
    total_servings: list.total_servings || 0,
    custom_order: list.customOrder || false,
    generated_at: list.generated_at || new Date().toISOString(),
  }

  const { error } = await supabase
    .from("shopping_list")
    .upsert(dbList, { onConflict: "id" })

  if (error) {
    console.error("  Error:", error.message)
  } else {
    console.log("  ✅ Migrated shopping list")
  }
}

async function main(): Promise<void> {
  console.log("🚀 Starting migration from local JSON to Supabase...")
  console.log(`   Data directory: ${DATA_DIR}`)
  console.log(`   Supabase URL: ${SUPABASE_URL}`)

  try {
    // Migration order (respects FK constraints)
    await migrateConfig() // user_config first (no dependencies)
    await migrateRecipes() // recipes before history (FK from history)
    await migratePantry() // pantry_items (no dependencies)
    await migrateHistory() // recipe_history (depends on recipes)
    await migrateWeeklyPlans() // weekly_plans (no FK but references recipe IDs)
    await migrateShoppingList() // shopping_list (no FK)

    console.log("\n✅ Migration complete!")
  } catch (error) {
    console.error("\n❌ Migration failed:", error)
    process.exit(1)
  }
}

main()
