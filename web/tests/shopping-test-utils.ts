import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { TEST_USER } from './fixtures'
import type { ShoppingItem } from '@/types/database'
import {
  createEmptyShoppingDocument,
  type ShoppingDocumentV3,
  type ShoppingManualItemV1,
  type ShoppingRecipeEntryV2,
} from '@/lib/shopping-document'
import { resolveRecipeShoppingIngredients } from '@/lib/shopping-ingredient-resolution'
import { createShoppingPurchaseKey } from '@/lib/shopping-list-normalization'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type ShoppingListRow = {
  document: ShoppingDocumentV3
  content_revision: number
}

type ShoppingSeedState = {
  items?: ShoppingItem[]
  derivedItems?: ShoppingItem[]
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

function toManualItem(item: ShoppingItem, bucket: ShoppingManualItemV1['bucket']): ShoppingManualItemV1 {
  if (!item.rowId) throw new Error('Seeded Shopping rows require a rowId')
  return {
    id: item.rowId.replace(/^manual:/, ''),
    displayName: item.item,
    quantity: item.amount === null ? null : { amount: item.amount, unit: item.unit },
    categoryKey: item.categoryKey,
    bucket,
    checked: item.checked ?? false,
  }
}

function toRecipeEntry(item: ShoppingItem): ShoppingRecipeEntryV2 {
  const source = item.sources?.find((candidate) => candidate.recipeId)
  if (!source?.recipeId) {
    throw new Error('Seeded derived Shopping rows require recipe provenance')
  }

  const scaleV1 = { numerator: '1', denominator: '1' }
  const ingredients = resolveRecipeShoppingIngredients(
    [{
      label: null,
      ingredients: [{
        item: item.item,
        amount: item.amount,
        unit: item.unit,
      }],
    }],
    { scale: 1, exactScaleV1: scaleV1, recipeId: source.recipeId }
  ).map(({
    runtime: _runtime,
    sourceOrdinal: _sourceOrdinal,
    defaultCategoryOrder: _defaultCategoryOrder,
    ...ingredient
  }) => ingredient)

  return {
    recipeId: source.recipeId,
    recipeName: source.recipeName,
    selectedServings: 1,
    scaleV1,
    ingredients,
  }
}

async function writeShoppingDocument(
  supabase: SupabaseClient,
  userId: string,
  document: ShoppingDocumentV3
) {
  const { data: current, error: readError } = await supabase
    .from('shopping_list')
    .select('content_revision')
    .eq('user_id', userId)
    .single()
  if (readError) throw readError

  const { data, error } = await supabase
    .from('shopping_list')
    .update({
      document: document as unknown as Json,
      content_revision: current.content_revision + 1,
    })
    .eq('user_id', userId)
    .eq('content_revision', current.content_revision)
    .select('content_revision')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Shopping test fixture lost its CAS race')
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

  const { data: existingList, error: listError } = await supabase
    .from('shopping_list')
    .select('document,content_revision')
    .eq('user_id', userId)
    .maybeSingle()
  if (listError) throw listError
  if (!existingList) throw new Error('Authenticated Shopping test user has no document')

  const previousDocument = structuredClone(
    (existingList as unknown as ShoppingListRow).document
  )
  const pantryItems = state.pantryItems || []
  const nextDocument = createEmptyShoppingDocument()
  nextDocument.recipeEntries = Object.fromEntries(
    (state.derivedItems || []).map((item) => {
      const entry = toRecipeEntry(item)
      return [entry.recipeId, entry]
    })
  )
  nextDocument.manualItems = [
    ...(state.items || []).map((item) => toManualItem(item, 'items')),
    ...(state.alreadyHave || []).map((item) => toManualItem(item, 'already_have')),
    ...(state.excluded || []).map((item) => toManualItem(item, 'excluded')),
  ]
  nextDocument.preferences.excludedIngredientKeys = [...new Set(
    (state.excludedKeywords || [])
      .map((keyword) => createShoppingPurchaseKey(keyword))
      .filter(Boolean)
  )]

  await writeShoppingDocument(supabase, userId, nextDocument)

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
    await writeShoppingDocument(supabase, userId, previousDocument)

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
