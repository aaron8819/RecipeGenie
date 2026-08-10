export type ShoppingQuantityKind =
  | 'continuous'
  | 'discrete'
  | 'package'
  | 'range'
  | 'qualitative'

export interface ShoppingIngredientSemantics {
  purchaseKey: string
  purchaseName: string
  familyKey: string
  preparation: string[]
  purchaseUnit: string
  quantityKind: ShoppingQuantityKind
  defaultCategoryKey: string
  pantryMatchKeys: string[]
  familyMatchPolicy: {
    pantryFromGeneric?: boolean
    exclusionEquivalent?: boolean
  }
}

export interface ShoppingIngredientSemanticsInput {
  item: string
  unit?: string | null
  modifier?: string | null
  quantityKind?: ShoppingQuantityKind
  fallbackCategoryKey?: string
}

const SIMPLE_UNIT_MAP: Record<string, string> = {
  milliliter: 'ml',
  milliliters: 'ml',
  liter: 'l',
  liters: 'l',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  pint: 'pint',
  pints: 'pint',
  pt: 'pint',
  quart: 'quart',
  quarts: 'quart',
  qt: 'quart',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  whole: 'count',
  wholes: 'count',
  'whole/count': 'count',
  'whole item': 'count',
  'whole items': 'count',
  count: 'count',
  counts: 'count',
  clove: 'clove',
  cloves: 'clove',
  slice: 'slice',
  slices: 'slice',
  can: 'can',
  cans: 'can',
  bunch: 'bunch',
  bunches: 'bunch',
  head: 'head',
  heads: 'head',
  stalk: 'stalk',
  stalks: 'stalk',
  sprig: 'sprig',
  sprigs: 'sprig',
  package: 'package',
  packages: 'package',
  pkg: 'package',
  pkgs: 'package',
  bag: 'bag',
  bags: 'bag',
  box: 'box',
  boxes: 'box',
  jar: 'jar',
  jars: 'jar',
  bottle: 'bottle',
  bottles: 'bottle',
  large: 'large',
  medium: 'medium',
  small: 'small',
  'extra large': 'extra large',
}

const SIZED_PACKAGE_PATTERN =
  /^(can|cans|jar|jars|bottle|bottles|package|packages|pkg|pkgs|bag|bags|box|boxes)\s*\(([^)]+)\)$/

const CONTROLLED_NOUN_ALIASES: Record<string, string> = {
  apples: 'apple',
  bananas: 'banana',
  carrots: 'carrot',
  eggs: 'egg',
  lemons: 'lemon',
  limes: 'lime',
  mushrooms: 'mushroom',
  onions: 'onion',
  peppers: 'pepper',
  potatoes: 'potato',
  tomatoes: 'tomato',
}

const CONTROLLED_PHRASE_ALIASES: Record<string, string> = {
  'chicken breasts': 'chicken breast',
  'chicken thighs': 'chicken thigh',
  'egg whites': 'egg white',
  evoo: 'extra virgin olive oil',
}

const PREPARATION_WORDS = new Set([
  'chopped',
  'crushed',
  'cubed',
  'diced',
  'grated',
  'halved',
  'juiced',
  'mashed',
  'minced',
  'peeled',
  'quartered',
  'shredded',
  'sliced',
  'zested',
])

const STRUCTURED_PREPARATION_MODIFIERS = new Set([
  ...PREPARATION_WORDS,
  'as needed',
  'divided',
  'drained',
  'finely grated',
  'finely minced',
  'for garnish',
  'for serving',
  'for topping',
  'or to taste',
  'plus more',
  'rinsed',
  'softened',
  'thinly sliced',
  'to taste',
])

const ITEM_PREPARATION_PREFIXES = [
  'finely grated',
  'finely minced',
  'sliced or diced',
  'thinly sliced',
]

const ITEM_QUALIFIER_PREFIXES = [
  'as needed',
  'or to taste',
]

const ITEM_QUALIFIER_SUFFIXES = [
  'as needed',
  'divided',
  'for garnish',
  'for serving',
  'for topping',
  'optional',
  'or to taste',
  'plus more',
  'to taste',
]

const ONION_PURCHASE_ALIASES = new Map<string, string>([
  ['onion', 'onion'],
  ['white onion', 'onion'],
  ['yellow onion', 'onion'],
])

const ONION_SIZE_PREPARATIONS = [
  'extra large',
  'small',
  'medium',
  'large',
] as const

const ONION_PURCHASE_NAMES = new Set([
  'onion',
  'white onion',
  'yellow onion',
  'red onion',
  'green onion',
  'pearl onion',
  'pickled onion',
  'pickled red onion',
])

const DISPLAY_PLURALS: Record<string, string> = {
  apple: 'apples',
  banana: 'bananas',
  breast: 'breasts',
  carrot: 'carrots',
  egg: 'eggs',
  lemon: 'lemons',
  lime: 'limes',
  mushroom: 'mushrooms',
  onion: 'onions',
  pepper: 'peppers',
  potato: 'potatoes',
  thigh: 'thighs',
  tomato: 'tomatoes',
}

const DISCRETE_UNITS = new Set([
  'bunch',
  'clove',
  'count',
  'head',
  'piece',
  'slice',
  'sprig',
  'stalk',
])

const PACKAGE_UNITS = new Set([
  'bag',
  'bottle',
  'box',
  'can',
  'jar',
  'package',
])

const DEFAULT_CATEGORY_BY_PURCHASE = new Map<string, string>([
  ['black pepper', 'pantry'],
  ['cilantro', 'produce'],
  ['coriander', 'pantry'],
  ['coriander seed', 'pantry'],
  ['cumin', 'pantry'],
  ['cumin seed', 'pantry'],
  ['dried oregano', 'pantry'],
  ['garlic', 'produce'],
  ['garlic powder', 'pantry'],
  ['ground black pepper', 'pantry'],
  ['freshly ground black pepper', 'pantry'],
  ['cracked black pepper', 'pantry'],
  ['kosher salt', 'pantry'],
  ['maldon salt', 'pantry'],
  ['oregano', 'produce'],
  ['rice', 'pantry'],
  ['salt', 'pantry'],
  ['sea salt', 'pantry'],
  ['table salt', 'pantry'],
])

const SALT_PURCHASE_KEYS = new Set([
  'salt',
  'kosher salt',
  'maldon salt',
  'sea salt',
  'table salt',
])

const BLACK_PEPPER_PURCHASE_KEYS = new Set([
  'black pepper',
  'ground black pepper',
  'freshly ground black pepper',
  'cracked black pepper',
])

const RICE_PURCHASE_KEYS = new Set([
  'rice',
  'arborio rice',
  'basmati rice',
  'brown rice',
  'jasmine rice',
  'long grain rice',
  'white rice',
])

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/([a-z])-([a-z])/g, '$1 $2')
    .replace(/[;,]+/g, ' ')
    .replace(/^[\s.:]+|[\s.:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSizedPackageUnit(unit: string): string | null {
  const match = unit.match(SIZED_PACKAGE_PATTERN)
  if (!match) return null

  const packageUnit = SIMPLE_UNIT_MAP[match[1]] || match[1]
  const size = match[2]
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\bounces?\b/g, 'oz')
    .replace(/\bpounds?\b/g, 'lb')
    .replace(/\bgrams?\b/g, 'g')
    .replace(/\bkilograms?\b/g, 'kg')
    .replace(/\bmilliliters?\b/g, 'ml')
    .replace(/\bliters?\b/g, 'l')

  return `${packageUnit} (${size})`
}

export function normalizeShoppingUnit(unit: string): string {
  if (!unit) return ''
  const normalized = normalizeText(unit)
  return normalizeSizedPackageUnit(normalized) ||
    SIMPLE_UNIT_MAP[normalized] || normalized
}

function canonicalizeControlledNoun(value: string): string {
  const phrase = CONTROLLED_PHRASE_ALIASES[value]
  if (phrase) return phrase

  const words = value.split(' ')
  const last = words.at(-1) || ''
  if (CONTROLLED_NOUN_ALIASES[last]) {
    words[words.length - 1] = CONTROLLED_NOUN_ALIASES[last]
  }
  return words.join(' ')
}

export function normalizeShoppingLiteralIdentity(value: string): string {
  return canonicalizeControlledNoun(normalizeText(value))
}

function collectModifierPreparation(
  modifier: string | null | undefined,
  preparation: Set<string>
): string[] {
  if (!modifier) return []
  const identityModifiers: string[] = []
  for (const part of modifier.split(',').map(normalizeText).filter(Boolean)) {
    if (part === 'optional') continue
    if (STRUCTURED_PREPARATION_MODIFIERS.has(part)) {
      preparation.add(part)
    } else {
      identityModifiers.push(part)
    }
  }
  return identityModifiers
}

function stripGenericPreparation(
  value: string,
  preparation: Set<string>
): string {
  let remaining = value
  let changed = true
  while (changed) {
    changed = false
    for (const phrase of [
      ...ITEM_QUALIFIER_PREFIXES,
      ...ITEM_PREPARATION_PREFIXES,
    ]) {
      if (remaining === phrase || remaining.startsWith(`${phrase} `)) {
        remaining = remaining.slice(phrase.length).trim()
        preparation.add(phrase)
        changed = true
        break
      }
    }
  }

  changed = true
  while (changed) {
    changed = false
    for (const phrase of ITEM_QUALIFIER_SUFFIXES) {
      if (remaining === phrase || remaining.endsWith(` ${phrase}`)) {
        remaining = remaining.slice(0, -phrase.length).trim()
        preparation.add(phrase === 'or to taste' ? 'to taste' : phrase)
        changed = true
        break
      }
    }
  }

  if (/\bor\b/.test(remaining)) return remaining

  const words = remaining.split(' ').filter(Boolean)
  while (words.length > 0 &&
    (PREPARATION_WORDS.has(words[0]) || words[0] === 'optional')) {
    const word = words.shift()!
    if (word !== 'optional') preparation.add(word)
  }
  while (words.length > 0 &&
    (PREPARATION_WORDS.has(words.at(-1)!) || words.at(-1) === 'optional')) {
    const word = words.pop()!
    if (word !== 'optional') preparation.add(word)
  }
  return words.join(' ')
}

function stripOnionSizePreparation(
  value: string,
  preparation: Set<string>
): string {
  let remaining = value
  const removed: string[] = []
  let changed = true

  while (changed) {
    changed = false
    for (const phrase of [...ONION_SIZE_PREPARATIONS, ...PREPARATION_WORDS]
      .sort((left, right) => right.length - left.length)) {
      if (remaining.startsWith(`${phrase} `)) {
        removed.push(phrase)
        remaining = remaining.slice(phrase.length).trim()
        changed = true
        break
      }
    }
  }

  if (!ONION_PURCHASE_NAMES.has(remaining) ||
      !removed.some((phrase) => ONION_SIZE_PREPARATIONS.includes(
        phrase as typeof ONION_SIZE_PREPARATIONS[number]
      ))) {
    return value
  }

  addPreparation(preparation, ...removed)
  return remaining
}

function inferQuantityKind(
  unit: string,
  requested: ShoppingQuantityKind | undefined
): ShoppingQuantityKind {
  if (requested) return requested
  const baseUnit = unit.replace(/\s*\(.+\)$/, '')
  if (PACKAGE_UNITS.has(baseUnit)) return 'package'
  if (DISCRETE_UNITS.has(baseUnit)) return 'discrete'
  return unit ? 'continuous' : 'qualitative'
}

function addPreparation(preparation: Set<string>, ...values: string[]): void {
  for (const value of values) {
    if (value) preparation.add(value)
  }
}

export function resolveShoppingIngredientSemantics(
  input: ShoppingIngredientSemanticsInput
): ShoppingIngredientSemantics {
  const preparation = new Set<string>()
  const identityModifiers = collectModifierPreparation(
    input.modifier,
    preparation
  )

  let purchaseUnit = normalizeShoppingUnit(input.unit || '')
  let purchaseName = stripGenericPreparation(
    normalizeShoppingLiteralIdentity(input.item),
    preparation
  )

  const remainingIdentityModifiers = identityModifiers.filter((modifier) => {
    if (modifier === 'fresh' && purchaseName === 'cilantro') {
      preparation.add('fresh')
      return false
    }
    if (modifier === 'ground' &&
        (purchaseName === 'cumin' || purchaseName === 'coriander')) {
      preparation.add('ground')
      return false
    }
    if ((modifier === 'cooked' || modifier === 'day old') &&
        RICE_PURCHASE_KEYS.has(purchaseName)) {
      preparation.add(modifier === 'day old' ? 'day-old' : modifier)
      return false
    }
    if (modifier === 'to taste' &&
        (SALT_PURCHASE_KEYS.has(purchaseName) ||
          BLACK_PEPPER_PURCHASE_KEYS.has(purchaseName))) {
      preparation.add('to taste')
      return false
    }
    return true
  })
  if (remainingIdentityModifiers.length > 0) {
    purchaseName = `${remainingIdentityModifiers.join(' ')} ${purchaseName}`
  }

  const legacyEggSize = /^(?:extra )?large$|^medium$|^small$/.test(purchaseUnit)
    ? purchaseUnit
    : null
  if (legacyEggSize && /^eggs?$/.test(purchaseName)) {
    purchaseName = `${legacyEggSize} egg`
    purchaseUnit = 'count'
  }

  const garlicMatch = purchaseName.match(
    /^(?:(small|medium|large|extra large) )?garlic cloves?$/
  )
  if (garlicMatch) {
    addPreparation(preparation, garlicMatch[1] || '')
    purchaseName = 'garlic'
    purchaseUnit = 'clove'
  } else if (purchaseName === 'garlic' && purchaseUnit === 'clove') {
    purchaseName = 'garlic'
  }

  if (/^(?:fresh )?cilantro$/.test(purchaseName)) {
    if (purchaseName.startsWith('fresh ')) preparation.add('fresh')
    purchaseName = 'cilantro'
  }

  const originalRiceName = purchaseName
  const ricePreparation = purchaseName.match(
    /^(?:(?:warm|cooked|day old) )+/
  )?.[0].trim() || ''
  const riceCandidate = ricePreparation
    ? purchaseName.slice(ricePreparation.length).trim()
    : purchaseName
  if (RICE_PURCHASE_KEYS.has(riceCandidate)) {
    purchaseName = riceCandidate
    if (/\bcooked\b/.test(originalRiceName)) preparation.add('cooked')
    if (/\bday[ -]old\b/.test(originalRiceName)) preparation.add('day-old')
    if (/\bwarm\b/.test(originalRiceName)) preparation.add('warm')
  }

  if (/^ground (?:cumin|coriander)$/.test(purchaseName)) {
    preparation.add('ground')
    purchaseName = purchaseName.replace(/^ground /, '')
  }

  const saltForm = purchaseName.match(/^pinch of (salt)$/)
  if (saltForm) {
    purchaseName = saltForm[1]
    if (!purchaseUnit) purchaseUnit = 'pinch'
  }
  if (purchaseName.endsWith(' to taste')) {
    const withoutTaste = purchaseName.slice(0, -' to taste'.length)
    if (SALT_PURCHASE_KEYS.has(withoutTaste) ||
        BLACK_PEPPER_PURCHASE_KEYS.has(withoutTaste)) {
      purchaseName = withoutTaste
      preparation.add('to taste')
    }
  }

  purchaseName = stripOnionSizePreparation(purchaseName, preparation)
  purchaseName = ONION_PURCHASE_ALIASES.get(purchaseName) || purchaseName

  purchaseName = canonicalizeControlledNoun(purchaseName)
  const purchaseKey = purchaseName

  let familyKey = purchaseKey
  const familyMatchPolicy: ShoppingIngredientSemantics['familyMatchPolicy'] = {}
  if (SALT_PURCHASE_KEYS.has(purchaseKey)) {
    familyKey = 'salt'
    familyMatchPolicy.pantryFromGeneric = true
  } else if (BLACK_PEPPER_PURCHASE_KEYS.has(purchaseKey)) {
    familyKey = 'black-pepper'
    familyMatchPolicy.pantryFromGeneric = true
  } else if (purchaseKey === 'oregano' || purchaseKey === 'dried oregano') {
    familyKey = 'oregano'
    familyMatchPolicy.exclusionEquivalent = true
  } else if (purchaseKey === 'cumin') {
    familyKey = 'cumin'
    familyMatchPolicy.exclusionEquivalent = true
  } else if (RICE_PURCHASE_KEYS.has(purchaseKey)) {
    familyKey = 'rice'
    if (purchaseKey === 'rice') familyMatchPolicy.pantryFromGeneric = true
  }

  return {
    purchaseKey,
    purchaseName,
    familyKey,
    preparation: [...preparation].sort(),
    purchaseUnit,
    quantityKind: inferQuantityKind(purchaseUnit, input.quantityKind),
    defaultCategoryKey: DEFAULT_CATEGORY_BY_PURCHASE.get(purchaseKey) ||
      input.fallbackCategoryKey || 'pantry',
    pantryMatchKeys: purchaseKey ? [purchaseKey] : [],
    familyMatchPolicy,
  }
}

export function pantrySemanticsSatisfy(
  pantry: ShoppingIngredientSemantics,
  needed: ShoppingIngredientSemantics
): boolean {
  if (pantry.purchaseKey === needed.purchaseKey) return true
  return pantry.familyMatchPolicy.pantryFromGeneric === true &&
    pantry.familyKey === needed.familyKey
}

export function exclusionSemanticsMatch(
  excluded: ShoppingIngredientSemantics,
  needed: ShoppingIngredientSemantics
): boolean {
  if (excluded.purchaseKey === needed.purchaseKey) return true
  return excluded.familyMatchPolicy.exclusionEquivalent === true &&
    needed.familyMatchPolicy.exclusionEquivalent === true &&
    excluded.familyKey === needed.familyKey
}

export function pluralizeShoppingPurchaseName(itemName: string): string {
  const words = itemName.split(' ')
  const finalWord = words.at(-1) || ''
  const plural = DISPLAY_PLURALS[finalWord]
  if (plural) {
    words[words.length - 1] = plural
    return words.join(' ')
  }
  if (finalWord.endsWith('y')) {
    words[words.length - 1] = `${finalWord.slice(0, -1)}ies`
    return words.join(' ')
  }
  if (finalWord.endsWith('s')) return itemName
  return `${itemName}s`
}

export function shoppingIdentityCompatibilityKeys(itemName: string): string[] {
  const semantics = resolveShoppingIngredientSemantics({ item: itemName })
  const keys = new Set([normalizeText(itemName), semantics.purchaseKey])
  const plural = pluralizeShoppingPurchaseName(semantics.purchaseName)
  if (plural !== semantics.purchaseName) keys.add(plural)
  return [...keys].filter(Boolean)
}

export function shoppingExclusionFamily(
  semantics: ShoppingIngredientSemantics
): 'salt' | 'black-pepper' | null {
  return semantics.familyKey === 'salt' || semantics.familyKey === 'black-pepper'
    ? semantics.familyKey
    : null
}
