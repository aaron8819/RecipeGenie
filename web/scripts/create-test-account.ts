/**
 * Script to create a test account in Supabase
 *
 * Usage:
 *   npm run create-test-account
 *   or
 *   npx tsx scripts/create-test-account.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js"
import { config } from "dotenv"
import * as readline from "readline"

// Load environment variables
config({ path: ".env.local" })

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

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve)
  })
}

async function createTestAccount(): Promise<void> {
  console.log("🧪 Recipe Genie - Test Account Creator\n")

  // Get user input from command line args or prompt
  let email = process.argv[2]
  let password = process.argv[3]

  if (!email) {
    email = await question("Enter email for test account: ")
  }
  if (!email || !email.includes("@")) {
    console.error("❌ Invalid email address")
    rl.close()
    process.exit(1)
  }

  if (!password) {
    password = await question("Enter password (min 6 characters): ")
  }
  if (!password || password.length < 6) {
    console.error("❌ Password must be at least 6 characters")
    rl.close()
    process.exit(1)
  }

  console.log("\n📝 Creating test account...")

  try {
    // Create the user account
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email so no verification needed
    })

    if (authError) {
      console.error("❌ Error creating user:", authError.message)
      rl.close()
      process.exit(1)
    }

    if (!authData.user) {
      console.error("❌ User creation returned no user data")
      rl.close()
      process.exit(1)
    }

    const userId = authData.user.id
    console.log(`✅ User account created successfully!`)
    console.log(`   User ID: ${userId}`)
    console.log(`   Email: ${email}`)

    // Wait a moment for the trigger to run
    console.log("\n⏳ Waiting for default recipes to be created...")
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Check if default recipes were created
    const { data: recipes, error: recipesError } = await supabase
      .from("recipes")
      .select("id, name, category")
      .eq("user_id", userId)

    if (recipesError) {
      console.warn("⚠️  Warning: Could not verify recipes:", recipesError.message)
    } else if (recipes && recipes.length > 0) {
      console.log(`✅ Default recipes created: ${recipes.length} recipes`)
      console.log("   Sample recipes:")
      recipes.slice(0, 3).forEach((recipe) => {
        console.log(`   - ${recipe.name} (${recipe.category})`)
      })
    } else {
      console.warn("⚠️  Warning: No default recipes found. The trigger may not have run.")
    }

    // Check if user_config was created
    const { data: config, error: configError } = await supabase
      .from("user_config")
      .select("user_id, categories")
      .eq("user_id", userId)
      .single()

    if (configError) {
      console.warn("⚠️  Warning: Could not verify user config:", configError.message)
    } else if (config) {
      console.log(`✅ User config created with ${config.categories.length} categories`)
    } else {
      console.warn("⚠️  Warning: No user config found.")
    }

    // Check if shopping_list was created
    const { data: shoppingList, error: shoppingError } = await supabase
      .from("shopping_list")
      .select("user_id")
      .eq("user_id", userId)
      .single()

    if (shoppingError) {
      console.warn("⚠️  Warning: Could not verify shopping list:", shoppingError.message)
    } else if (shoppingList) {
      console.log(`✅ Shopping list created`)
    } else {
      console.warn("⚠️  Warning: No shopping list found.")
    }

    console.log("\n🎉 Test account setup complete!")
    console.log("\n📋 Login Credentials:")
    console.log(`   Email: ${email}`)
    console.log(`   Password: ${password}`)
    console.log("\n💡 You can now sign in to the app with these credentials.")

  } catch (error: any) {
    console.error("\n❌ Unexpected error:", error.message)
    console.error(error)
    rl.close()
    process.exit(1)
  }

  rl.close()
}

// Run the script
createTestAccount().catch((error) => {
  console.error("Fatal error:", error)
  rl.close()
  process.exit(1)
})
