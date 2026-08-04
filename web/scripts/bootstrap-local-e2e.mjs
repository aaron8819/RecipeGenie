import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  LOCAL_APP_ORIGIN,
  PRODUCTION_PROJECT_REF,
  assertLocalSupabaseUrl,
} from './local-e2e-runtime.mjs'

const RECIPES = [
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000001',
    name: 'Weeknight Lemon Chicken',
    category: 'chicken',
    servings: 4,
    favorite: true,
    tags: ['quick', 'fixture'],
    fixtureIngredients: [
      { amount: 1.5, unit: 'lb', item: 'chicken breasts' },
      { amount: 2, unit: 'count', item: 'lemons' },
      { amount: 3, unit: 'cloves', item: 'garlic' },
    ],
    fixtureInstructions: ['Season the chicken.', 'Sear until golden.', 'Add lemon and finish in the oven.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000002',
    name: 'Colorful Vegetable Curry',
    category: 'vegetarian',
    servings: 6,
    favorite: false,
    tags: ['vegetarian', 'fixture'],
    fixtureIngredients: [
      { amount: 1, unit: 'count', item: 'cauliflower' },
      { amount: 2, unit: 'cups', item: 'chickpeas' },
      { amount: 1, unit: 'can', item: 'coconut milk' },
    ],
    fixtureInstructions: ['Toast the spices.', 'Simmer the vegetables.', 'Fold in chickpeas and coconut milk.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000003',
    name: 'Sheet Pan Salmon',
    category: 'seafood',
    servings: 4,
    favorite: true,
    tags: ['sheet-pan', 'fixture'],
    fixtureIngredients: [
      { amount: 4, unit: 'count', item: 'salmon fillets' },
      { amount: 1, unit: 'lb', item: 'asparagus' },
    ],
    fixtureInstructions: ['Heat the oven.', 'Arrange salmon and asparagus.', 'Roast until flaky.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000004',
    name: 'Slow Cooker Black Bean Chili',
    category: 'beef',
    servings: 8,
    favorite: false,
    tags: ['batch', 'fixture'],
    fixtureIngredients: [
      { amount: 1, unit: 'lb', item: 'ground beef' },
      { amount: 2, unit: 'cans', item: 'black beans' },
      { amount: 1, unit: 'can', item: 'diced tomatoes' },
    ],
    fixtureInstructions: ['Brown the beef.', 'Add all ingredients to the slow cooker.', 'Cook on low for 6 hours.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000005',
    name: 'Summer Pasta Salad',
    category: 'vegetarian',
    servings: 6,
    favorite: false,
    tags: ['lunch', 'fixture'],
    fixtureIngredients: [
      { amount: 12, unit: 'oz', item: 'rotini' },
      { amount: 2, unit: 'cups', item: 'cherry tomatoes' },
      { amount: 1, unit: 'count', item: 'cucumber' },
    ],
    fixtureInstructions: ['Cook and cool the pasta.', 'Chop the vegetables.', 'Toss with dressing.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000006',
    name: 'Long Sunday Lasagna',
    category: 'beef',
    servings: 10,
    favorite: true,
    tags: ['weekend', 'long-form', 'fixture'],
    fixtureIngredients: [
      { amount: 1, unit: 'lb', item: 'ground beef' },
      { amount: 1, unit: 'lb', item: 'italian sausage' },
      { amount: 2, unit: 'cans', item: 'crushed tomatoes' },
      { amount: 16, unit: 'oz', item: 'ricotta cheese' },
      { amount: 3, unit: 'cups', item: 'mozzarella cheese' },
      { amount: 1, unit: 'cup', item: 'parmesan cheese' },
      { amount: 12, unit: 'count', item: 'lasagna noodles' },
      { amount: 1, unit: 'bunch', item: 'fresh basil' },
    ],
    fixtureInstructions: [
      'Brown the beef and sausage in a heavy pot.',
      'Drain excess fat and add the tomatoes.',
      'Simmer the sauce gently for 45 minutes.',
      'Boil the noodles until just flexible.',
      'Mix ricotta with half of the parmesan.',
      'Spread a thin layer of sauce in the baking dish.',
      'Layer noodles, ricotta, sauce, and mozzarella.',
      'Repeat the layers until the dish is full.',
      'Cover and bake for 35 minutes.',
      'Uncover and bake until browned.',
      'Rest for 20 minutes before slicing.',
      'Finish with basil and remaining parmesan.',
    ],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000007',
    name: 'Breakfast Tacos',
    category: 'breakfast',
    servings: 4,
    favorite: false,
    tags: ['breakfast', 'fixture'],
    fixtureIngredients: [
      { amount: 8, unit: 'count', item: 'eggs' },
      { amount: 8, unit: 'count', item: 'corn tortillas' },
    ],
    fixtureInstructions: ['Scramble the eggs.', 'Warm the tortillas.', 'Assemble and serve.'],
  },
  {
    recipe_uuid: '10000000-0000-4000-8000-000000000008',
    name: 'Mushroom Risotto',
    category: 'vegetarian',
    servings: 4,
    favorite: false,
    tags: ['comfort', 'fixture'],
    fixtureIngredients: [
      { amount: 1.5, unit: 'cups', item: 'arborio rice' },
      { amount: 12, unit: 'oz', item: 'mushrooms' },
    ],
    fixtureInstructions: ['Sauté the mushrooms.', 'Toast the rice.', 'Add stock gradually while stirring.'],
  },
]

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function localSupabaseOrigin(value) {
  if (value.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Production Supabase project is forbidden for local E2E bootstrap')
  }
  return assertLocalSupabaseUrl(value)
}

function currentMonday() {
  const date = new Date()
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
    .join('-')
}

function shoppingItem({ rowId, item, amount, unit, categoryKey, categoryOrder, checked }) {
  return {
    rowId,
    item,
    amount,
    unit,
    categoryKey,
    categoryOrder,
    checked,
    sources: [{
      recipeId: RECIPES[0].recipe_uuid,
      legacyRecipeId: RECIPES[0].recipe_uuid,
      recipeName: RECIPES[0].name,
    }],
  }
}

async function checked(error, operation) {
  if (error) throw new Error(`${operation} failed: ${error.message}`)
}

async function seedRepresentativeData(client, userId) {
  const recipeRows = RECIPES.map(({
    fixtureIngredients,
    fixtureInstructions,
    ...recipe
  }) => ({
    ...recipe,
    id: recipe.recipe_uuid,
    user_id: userId,
    ingredient_sections: [{ label: null, ingredients: fixtureIngredients }],
    instruction_sections: [{ label: null, steps: fixtureInstructions }],
    notes: [],
  }))
  const { error: recipeError } = await client.from('recipes').insert(recipeRows)
  await checked(recipeError, 'Representative recipe seed')

  const { error: configError } = await client.from('user_config').update({
    onboarding_completed_at: new Date().toISOString(),
    excluded_keywords: ['cilantro'],
    custom_categories: [{ id: 'empty-local-fixture', name: 'Empty Local Fixture', order: 9 }],
    shopping_item_order: {},
    week_start_day: 1,
  }).eq('user_id', userId)
  await checked(configError, 'Local user configuration seed')

  const items = [
    shoppingItem({ rowId: 'fixture-lemons', item: 'lemons', amount: 2, unit: 'count', categoryKey: 'produce', categoryOrder: 1, checked: false }),
    shoppingItem({ rowId: 'fixture-chicken', item: 'chicken breasts', amount: 1.5, unit: 'lb', categoryKey: 'protein', categoryOrder: 4, checked: false }),
    shoppingItem({ rowId: 'fixture-yogurt', item: 'greek yogurt', amount: 1, unit: 'cup', categoryKey: 'dairy', categoryOrder: 5, checked: false }),
    shoppingItem({ rowId: 'fixture-tortillas', item: 'corn tortillas', amount: 8, unit: 'count', categoryKey: 'bakery', categoryOrder: 3, checked: true }),
    shoppingItem({ rowId: 'fixture-beans', item: 'black beans', amount: 2, unit: 'cans', categoryKey: 'pantry', categoryOrder: 6, checked: true }),
  ]
  const { error: shoppingError } = await client.from('shopping_list').update({
    items,
    already_have: [
      shoppingItem({ rowId: 'fixture-oats', item: 'rolled oats', amount: 2, unit: 'cups', categoryKey: 'pantry', categoryOrder: 6, checked: false }),
    ],
    excluded: [
      { ...shoppingItem({ rowId: 'fixture-cilantro', item: 'cilantro', amount: 1, unit: 'bunch', categoryKey: 'produce', categoryOrder: 1, checked: false }), excludedBy: 'cilantro' },
    ],
    custom_order: false,
    generated_at: new Date().toISOString(),
    scale: 1,
    source_recipe_uuids: [],
    source_recipes: [],
    total_servings: 4,
  }).eq('user_id', userId)
  await checked(shoppingError, 'Representative shopping seed')

  const { error: pantryDeleteError } = await client.from('pantry_items').delete().eq('user_id', userId)
  await checked(pantryDeleteError, 'Pantry reset')
  const { error: pantryError } = await client.from('pantry_items').insert(
    ['garlic', 'olive oil', 'jasmine rice'].map((item) => ({ item, user_id: userId }))
  )
  await checked(pantryError, 'Representative pantry seed')

  const planned = RECIPES.slice(0, 4).map((recipe) => recipe.recipe_uuid)
  const assignments = {
    [planned[0]]: 1,
    [planned[1]]: 3,
    [planned[2]]: 5,
  }
  const { error: plannerError } = await client.from('weekly_plans').upsert({
    user_id: userId,
    week_date: currentMonday(),
    recipe_uuids: planned,
    day_assignment_recipe_uuids: assignments,
    made_recipe_uuids: [planned[3]],
    scale: 1,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,week_date' })
  await checked(plannerError, 'Representative planner seed')
}

async function main() {
  const supabaseUrl = localSupabaseOrigin(required('NEXT_PUBLIC_SUPABASE_URL'))
  const anonKey = required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const email = required('RECIPE_GENIE_E2E_EMAIL')
  const password = required('RECIPE_GENIE_E2E_PASSWORD')
  if (password.length < 8) throw new Error('Local E2E password must be at least 8 characters')

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  let existingUserId
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase())
    if (user) {
      existingUserId = user.id
      break
    }
    if (data.users.length < 100) break
    if (page === 20) throw new Error('Local E2E user lookup exceeded the safe pagination limit')
  }
  if (existingUserId) {
    const { error } = await admin.auth.admin.deleteUser(existingUserId)
    if (error) throw error

    for (const table of [
      'recipes',
      'shopping_recipe_contributions',
      'shopping_contribution_commands',
    ]) {
      const { count, error: residueError } = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', existingUserId)
      if (residueError) throw residueError
      if (count !== 0) throw new Error(`Local E2E user reset left residue in ${table}`)
    }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError) throw createError
  if (!created.user) throw new Error('Local E2E user creation returned no user')

  const localClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: signedIn, error: signInError } = await localClient.auth.signInWithPassword({
    email,
    password,
  })
  if (signInError || !signedIn.user) throw new Error('Local E2E sign-in verification failed')
  await seedRepresentativeData(localClient, created.user.id)
  await localClient.auth.signOut()

  const { count: recipeCount, error: countError } = await admin
    .from('recipes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', created.user.id)
  if (countError || recipeCount !== RECIPES.length + 3) {
    throw new Error('Local E2E fixture verification failed')
  }

  const envPath = path.resolve(process.cwd(), '.env.e2e.local')
  const values = [
    'RECIPE_GENIE_E2E_TARGET=local',
    'RECIPE_GENIE_E2E_LOCAL_ONLY=true',
    `RECIPE_GENIE_E2E_BASE_URL=${LOCAL_APP_ORIGIN}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `RECIPE_GENIE_E2E_EMAIL=${email}`,
    `RECIPE_GENIE_E2E_PASSWORD=${password}`,
    '',
  ]
  fs.writeFileSync(envPath, values.join('\n'), { encoding: 'utf8', mode: 0o600 })
  console.log('Local E2E user reset and ignored configuration written.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Local E2E bootstrap failed')
  process.exitCode = 1
})
