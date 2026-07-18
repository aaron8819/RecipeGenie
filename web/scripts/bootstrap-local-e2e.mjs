import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const PRODUCTION_PROJECT_REF = 'eyaoahwzixqetjgfghsh'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function localSupabaseOrigin(value) {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.href.includes(PRODUCTION_PROJECT_REF)
  ) {
    throw new Error('Local E2E bootstrap requires a credential-free loopback Supabase URL')
  }
  return url.origin
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

  const { error: onboardingError } = await admin
    .from('user_config')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('user_id', created.user.id)
  if (onboardingError) throw onboardingError

  const envPath = path.resolve(process.cwd(), '.env.e2e.local')
  const values = [
    'RECIPE_GENIE_E2E_TARGET=local',
    'RECIPE_GENIE_E2E_LOCAL_ONLY=true',
    'RECIPE_GENIE_E2E_BASE_URL=http://127.0.0.1:3107',
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
