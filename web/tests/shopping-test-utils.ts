import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { TEST_USER } from './fixtures'
import type { ShoppingItem } from '@/types/database'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type ShoppingListRow = {
  user_id: string
  items: ShoppingItem[]
  already_have: ShoppingItem[]
  excluded: ShoppingItem[]
  source_recipes: string[]
  scale: number
  total_servings: number
  custom_order: boolean
  generated_at: string
}

type UserConfigRow = {
  user_id: string
  excluded_keywords: string[]
}

type PantryRow = {
  id: string
  user_id: string
  item: string
  created_at: string
}

type ShoppingSeedState = {
  items?: ShoppingItem[]
  alreadyHave?: ShoppingItem[]
  excluded?: ShoppingItem[]
  pantryItems?: string[]
  excludedKeywords?: string[]
}

const LOCK_PATH = path.resolve(process.cwd(), '.playwright', 'shopping-spec.lock')

let supabasePromise: Promise<SupabaseClient> | null = null

function readEnvValue(key: string): string {
  if (process.env[key]) return process.env[key] as string

  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.resolve(process.cwd(), fileName)
    if (!fs.existsSync(filePath)) continue

    const contents = fs.readFileSync(filePath, 'utf8')
    const match = contents.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)\\s*$`, 'm'))
    if (match?.[1]) {
      return match[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }

  throw new Error(`Missing required env var: ${key}`)
}

async function getAuthedSupabase(): Promise<SupabaseClient> {
  if (supabasePromise) return supabasePromise

  supabasePromise = (async () => {
    const url = readEnvValue('NEXT_PUBLIC_SUPABASE_URL')
    const anonKey = readEnvValue('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { error } = await client.auth.signInWithPassword({
      email: TEST_USER.email,
      password: TEST_USER.password,
    })

    if (error) {
      throw error
    }

    return client
  })()

  return supabasePromise
}

async function getUserId(supabase: SupabaseClient): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw error || new Error('Failed to resolve authenticated shopping test user')
  }

  return user.id
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function normalizeShoppingListRow(userId: string, row: Partial<ShoppingListRow> | null | undefined): ShoppingListRow {
  return {
    user_id: userId,
    items: (row?.items || []) as ShoppingItem[],
    already_have: (row?.already_have || []) as ShoppingItem[],
    excluded: (row?.excluded || []) as ShoppingItem[],
    source_recipes: (row?.source_recipes || []) as string[],
    scale: row?.scale ?? 1,
    total_servings: row?.total_servings ?? 0,
    custom_order: row?.custom_order ?? false,
    generated_at: row?.generated_at || new Date().toISOString(),
  }
}

async function writeShoppingListRow(
  supabase: SupabaseClient,
  userId: string,
  row: ShoppingListRow,
  exists: boolean
) {
  const payload = {
    user_id: userId,
    items: row.items as unknown as Json,
    already_have: row.already_have as unknown as Json,
    excluded: row.excluded as unknown as Json,
    source_recipes: row.source_recipes,
    scale: row.scale,
    total_servings: row.total_servings,
    custom_order: row.custom_order,
    generated_at: row.generated_at,
  }

  const result = exists
    ? await supabase.from('shopping_list').update(payload).eq('user_id', userId)
    : await supabase.from('shopping_list').insert(payload)

  if (result.error) {
    throw result.error
  }
}

async function writeUserConfigRow(
  supabase: SupabaseClient,
  userId: string,
  excludedKeywords: string[],
  exists: boolean
) {
  const payload = {
    user_id: userId,
    excluded_keywords: excludedKeywords,
  }

  const result = exists
    ? await supabase.from('user_config').update(payload).eq('user_id', userId)
    : await supabase.from('user_config').insert(payload)

  if (result.error) {
    throw result.error
  }
}

export async function acquireShoppingSpecLock(): Promise<() => void> {
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true })

  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx')
      fs.writeFileSync(fd, String(process.pid))
      fs.closeSync(fd)

      return () => {
        if (fs.existsSync(LOCK_PATH)) {
          fs.unlinkSync(LOCK_PATH)
        }
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error('Timed out waiting for shopping spec lock')
}

export async function seedShoppingState(state: ShoppingSeedState): Promise<() => Promise<void>> {
  const supabase = await getAuthedSupabase()
  const userId = await getUserId(supabase)

  const [{ data: existingList }, { data: existingConfig }] = await Promise.all([
    supabase.from('shopping_list').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('user_config').select('user_id, excluded_keywords').eq('user_id', userId).maybeSingle(),
  ])

  const previousList = normalizeShoppingListRow(userId, existingList as Partial<ShoppingListRow> | null)
  const previousExcludedKeywords = ((existingConfig as Partial<UserConfigRow> | null)?.excluded_keywords || []) as string[]
  const shoppingListExists = !!existingList
  const userConfigExists = !!existingConfig
  const pantryItems = state.pantryItems || []

  const nextList: ShoppingListRow = {
    ...previousList,
    items: dedupeBy([...(previousList.items || []), ...(state.items || [])], (item) => item.rowId || `${item.item}-${item.unit || ''}`),
    already_have: dedupeBy(
      [...(previousList.already_have || []), ...(state.alreadyHave || [])],
      (item) => item.rowId || `${item.item}-${item.unit || ''}`
    ),
    excluded: dedupeBy(
      [...(previousList.excluded || []), ...(state.excluded || [])],
      (item) => item.rowId || `${item.item}-${item.unit || ''}`
    ),
    source_recipes: dedupeBy(
      [
        ...(previousList.source_recipes || []),
        ...(state.items || []).flatMap((item) => item.sources || []).map((source) => source.recipeName),
        ...(state.alreadyHave || []).flatMap((item) => item.sources || []).map((source) => source.recipeName),
        ...(state.excluded || []).flatMap((item) => item.sources || []).map((source) => source.recipeName),
      ]
        .filter((name) => name && name !== 'Manual'),
      (name) => name
    ),
    generated_at: new Date().toISOString(),
  }

  const nextExcludedKeywords = dedupeBy(
    [...previousExcludedKeywords, ...(state.excludedKeywords || [])],
    (keyword) => keyword.toLowerCase()
  )

  await writeShoppingListRow(supabase, userId, nextList, shoppingListExists)
  await writeUserConfigRow(supabase, userId, nextExcludedKeywords, userConfigExists)

  if (pantryItems.length > 0) {
    const now = new Date().toISOString()
    const pantryInsert = await supabase.from('pantry_items').insert(
      pantryItems.map((item) => ({
        user_id: userId,
        item,
        created_at: now,
      }))
    )
    if (pantryInsert.error) {
      throw pantryInsert.error
    }
  }

  return async () => {
    await writeShoppingListRow(supabase, userId, previousList, shoppingListExists)
    await writeUserConfigRow(supabase, userId, previousExcludedKeywords, userConfigExists)

    if (pantryItems.length > 0) {
      const pantryDelete = await supabase.from('pantry_items').delete().eq('user_id', userId).in('item', pantryItems)
      if (pantryDelete.error) {
        throw pantryDelete.error
      }
    }
  }
}

export function buildShoppingItem(input: {
  rowId: string
  item: string
  amount?: number | null
  unit?: string
  categoryKey?: string
  categoryOrder?: number
  checked?: boolean
  excludedBy?: string
  sources?: Array<{ recipeId?: string; recipeName: string }>
}): ShoppingItem {
  return {
    rowId: input.rowId,
    item: input.item,
    amount: input.amount ?? null,
    unit: input.unit || '',
    categoryKey: input.categoryKey || 'misc',
    categoryOrder: input.categoryOrder ?? 8,
    checked: input.checked ?? false,
    excludedBy: input.excludedBy,
    sources: (input.sources || [{ recipeId: '', recipeName: 'Manual' }]).map((source) => ({
      recipeId: source.recipeId || '',
      recipeName: source.recipeName,
    })),
  }
}

export async function revealMobileSwipeActions(
  page: import('@playwright/test').Page,
  row: import('@playwright/test').Locator
) {
  const box = await row.boundingBox()
  if (!box) throw new Error('Shopping row is not visible for swipe validation')

  const startX = Math.round(box.x + box.width - 12)
  const endX = Math.round(box.x + Math.max(24, box.width * 0.45))
  const y = Math.round(box.y + box.height / 2)

  const client = await page.context().newCDPSession(page)
  const dispatch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, touchY?: number) => {
    await client.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              {
                x: x ?? startX,
                y: touchY ?? y,
                radiusX: 2,
                radiusY: 2,
                force: 1,
                id: 1,
              },
            ],
    })
  }

  await dispatch('touchStart', startX, y)
  await page.waitForTimeout(16)
  await dispatch('touchMove', startX - 48, y)
  await page.waitForTimeout(16)
  await dispatch('touchMove', endX, y)
  await page.waitForTimeout(16)
  await dispatch('touchEnd')
}
