/**
 * Script to check for recipes with unusually long names
 * Run with: npx tsx scripts/check-long-recipe-names.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkLongRecipeNames() {
  console.log('Checking for recipes with long names...\n')

  const { data: recipes, error } = await supabase
    .from('recipes')
    .select('id, name, category, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching recipes:', error)
    return
  }

  if (!recipes || recipes.length === 0) {
    console.log('No recipes found in database')
    return
  }

  console.log(`Total recipes: ${recipes.length}\n`)

  // Find recipes with long names
  const longNameThreshold = 80
  const veryLongNameThreshold = 150

  const longNameRecipes = recipes.filter((r) => r.name.length > longNameThreshold)
  const veryLongNameRecipes = recipes.filter((r) => r.name.length > veryLongNameThreshold)

  console.log(`Recipes with names > ${longNameThreshold} chars: ${longNameRecipes.length}`)
  console.log(`Recipes with names > ${veryLongNameThreshold} chars: ${veryLongNameRecipes.length}\n`)

  // Show stats
  const nameLengths = recipes.map((r) => r.name.length)
  const avgLength = nameLengths.reduce((a, b) => a + b, 0) / nameLengths.length
  const maxLength = Math.max(...nameLengths)
  const minLength = Math.min(...nameLengths)

  console.log('Name length statistics:')
  console.log(`  Average: ${avgLength.toFixed(1)} chars`)
  console.log(`  Min: ${minLength} chars`)
  console.log(`  Max: ${maxLength} chars\n`)

  // Show the longest recipe names
  if (longNameRecipes.length > 0) {
    console.log('='.repeat(80))
    console.log('RECIPES WITH LONG NAMES:')
    console.log('='.repeat(80))

    const sorted = [...longNameRecipes].sort((a, b) => b.name.length - a.name.length)

    sorted.slice(0, 10).forEach((recipe, idx) => {
      console.log(`\n${idx + 1}. [${recipe.name.length} chars] ${recipe.category}`)
      console.log(`   ID: ${recipe.id}`)
      console.log(`   Name: ${recipe.name.substring(0, 150)}${recipe.name.length > 150 ? '...' : ''}`)
      console.log(`   Created: ${new Date(recipe.created_at).toLocaleDateString()}`)
    })

    console.log('\n' + '='.repeat(80))
  }

  // Check for the specific pretzel recipe pattern
  const pretzelPattern = /bavarian.*pretzel|laugenbrezeln/i
  const pretzelRecipes = recipes.filter((r) => pretzelPattern.test(r.name))

  if (pretzelRecipes.length > 0) {
    console.log('\n🥨 PRETZEL RECIPES FOUND:')
    console.log('='.repeat(80))
    pretzelRecipes.forEach((recipe) => {
      console.log(`\n[${recipe.name.length} chars]`)
      console.log(`Name: ${recipe.name}`)
      console.log(`ID: ${recipe.id}`)
    })
    console.log('='.repeat(80))
  }
}

checkLongRecipeNames()
  .then(() => {
    console.log('\n✅ Done')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
