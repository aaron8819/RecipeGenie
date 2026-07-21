const PREPARATION_MODIFIERS = new Set([
  "chopped",
  "diced",
  "grated",
  "minced",
  "sliced",
])

const OPTIONAL_MODIFIERS = new Set(["optional"])

const IDENTITY_MODIFIER_PHRASES = [
  "extra large",
  "extra virgin",
  "sun dried",
] as const

const IDENTITY_MODIFIERS = new Set([
  "boneless",
  "canned",
  "dried",
  "evaporated",
  "fresh",
  "frozen",
  "green",
  "kosher",
  "large",
  "medium",
  "pickled",
  "powdered",
  "quail",
  "red",
  "skinless",
  "small",
  "smoked",
  "white",
  "whole",
  "yellow",
])

const PHRASE_ALIASES: Record<string, string> = {
  "chicken breasts": "chicken breast",
  "chicken thighs": "chicken thigh",
  "egg whites": "egg white",
  evoo: "extra virgin olive oil",
  "garlic cloves": "garlic",
}

const NOUN_ALIASES: Record<string, string> = {
  apples: "apple",
  bananas: "banana",
  carrots: "carrot",
  eggs: "egg",
  lemons: "lemon",
  limes: "lime",
  mushrooms: "mushroom",
  onions: "onion",
  peppers: "pepper",
  potatoes: "potato",
  tomatoes: "tomato",
}

const BASE_NAMES = [
  "chicken breast",
  "chicken thigh",
  "egg white",
  "garlic powder",
  "olive oil",
  "tomato paste",
  "tomato sauce",
  "apple",
  "banana",
  "carrot",
  "egg",
  "flour",
  "garlic",
  "lemon",
  "lime",
  "milk",
  "mushroom",
  "onion",
  "parsley",
  "pepper",
  "potato",
  "salt",
  "sugar",
  "tomato",
] as const

const DISPLAY_PLURALS: Record<string, string> = {
  apple: "apples",
  banana: "bananas",
  breast: "breasts",
  carrot: "carrots",
  egg: "eggs",
  lemon: "lemons",
  lime: "limes",
  mushroom: "mushrooms",
  onion: "onions",
  pepper: "peppers",
  potato: "potatoes",
  thigh: "thighs",
  tomato: "tomatoes",
}

export type CanonicalShoppingIngredient = {
  baseName: string
  identityModifiers: string[]
  preparationModifiers: string[]
  optional: boolean
  displayName: string
  mergeKey: string
}

export type CanonicalShoppingIngredientInput = {
  item: string
  modifier?: string | null
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/([a-z])-([a-z])/g, "$1 $2")
    .replace(/[;,]+/g, " ")
    .replace(/^[\s.:]+|[\s.:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function canonicalizeKnownNoun(value: string): string {
  const phraseAlias = PHRASE_ALIASES[value]
  if (phraseAlias) return phraseAlias

  const words = value.split(" ")
  const finalWord = words.at(-1) || ""
  const canonicalNoun = NOUN_ALIASES[finalWord]
  if (canonicalNoun) {
    words[words.length - 1] = canonicalNoun
  }
  return words.join(" ")
}

function takeEdgeModifiers(
  words: string[],
  preparationModifiers: Set<string>,
  identityModifiers: Set<string>
): string[] {
  const remaining = [...words]

  let consumed = true
  while (remaining.length > 0 && consumed) {
    consumed = false
    const first = remaining[0]
    const last = remaining.at(-1) || ""

    if (PREPARATION_MODIFIERS.has(first)) {
      preparationModifiers.add(first)
      remaining.shift()
      consumed = true
    } else if (OPTIONAL_MODIFIERS.has(first)) {
      remaining.shift()
      consumed = true
    } else {
      const identityPhrase = IDENTITY_MODIFIER_PHRASES.find((phrase) => {
        const phraseWords = phrase.split(" ")
        return phraseWords.every((word, index) => remaining[index] === word)
      })
      if (identityPhrase) {
        identityModifiers.add(identityPhrase)
        remaining.splice(0, identityPhrase.split(" ").length)
        consumed = true
      } else if (IDENTITY_MODIFIERS.has(first)) {
        identityModifiers.add(first)
        remaining.shift()
        consumed = true
      }
    }

    if (PREPARATION_MODIFIERS.has(last)) {
      preparationModifiers.add(last)
      remaining.pop()
      consumed = true
    } else if (OPTIONAL_MODIFIERS.has(last)) {
      remaining.pop()
      consumed = true
    }
  }

  return remaining
}

function parseExplicitModifier(
  modifier: string | null | undefined,
  preparationModifiers: Set<string>,
  identityModifiers: Set<string>
): boolean {
  let optional = false
  if (!modifier) return optional

  for (const part of modifier.split(",").map(normalizeText).filter(Boolean)) {
    if (OPTIONAL_MODIFIERS.has(part)) {
      optional = true
    } else if (PREPARATION_MODIFIERS.has(part)) {
      preparationModifiers.add(part)
    } else if (
      IDENTITY_MODIFIERS.has(part) ||
      IDENTITY_MODIFIER_PHRASES.some((phrase) => phrase === part)
    ) {
      identityModifiers.add(part)
    }
  }

  return optional
}

/**
 * Produces the deliberately narrow purchase identity used by shopping-list
 * aggregation. Unknown words remain part of the identity, so uncertain names
 * stay separate instead of being guessed into a broader ingredient class.
 */
export function canonicalizeShoppingIngredient(
  input: CanonicalShoppingIngredientInput
): CanonicalShoppingIngredient {
  const preparationModifiers = new Set<string>()
  const identityModifiers = new Set<string>()
  let optional = parseExplicitModifier(
    input.modifier,
    preparationModifiers,
    identityModifiers
  )

  let normalized = canonicalizeKnownNoun(normalizeText(input.item))
  const normalizedWords = normalized.split(" ").filter(Boolean)
  if (OPTIONAL_MODIFIERS.has(normalizedWords[0])) optional = true
  if (OPTIONAL_MODIFIERS.has(normalizedWords.at(-1) || "")) optional = true

  const remainingWords = takeEdgeModifiers(
    normalizedWords,
    preparationModifiers,
    identityModifiers
  )
  normalized = canonicalizeKnownNoun(remainingWords.join(" "))

  let baseName = normalized
  let unknownPrefix = ""
  const knownBase = BASE_NAMES.find(
    (candidate) => normalized === candidate || normalized.endsWith(` ${candidate}`)
  )

  if (knownBase) {
    baseName = knownBase
    unknownPrefix = normalized.slice(0, normalized.length - knownBase.length).trim()
  }

  if (unknownPrefix) {
    // Unknown qualifiers remain an opaque base name. This is deliberately
    // conservative and also avoids reordering prose-like legacy ingredients.
    baseName = normalized
  }

  const sortedIdentityModifiers = [...identityModifiers].sort()
  const sortedPreparationModifiers = [...preparationModifiers].sort()
  const displayName = [...sortedIdentityModifiers, baseName]
    .filter(Boolean)
    .join(" ")
  const mergeKey = displayName

  return {
    baseName,
    identityModifiers: sortedIdentityModifiers,
    preparationModifiers: sortedPreparationModifiers,
    optional,
    displayName,
    mergeKey,
  }
}

export function pluralizeCanonicalShoppingName(itemName: string): string {
  const words = itemName.split(" ")
  const finalWord = words.at(-1) || ""
  const plural = DISPLAY_PLURALS[finalWord]
  if (plural) {
    words[words.length - 1] = plural
    return words.join(" ")
  }
  // Preserve the component's established display fallback for uncatalogued
  // names; this affects presentation only, never purchase identity.
  if (finalWord.endsWith("y")) {
    words[words.length - 1] = `${finalWord.slice(0, -1)}ies`
    return words.join(" ")
  }
  if (finalWord.endsWith("s")) return itemName
  return `${itemName}s`
}

export function shoppingIdentityCompatibilityKeys(itemName: string): string[] {
  const canonical = canonicalizeShoppingIngredient({ item: itemName })
  const keys = new Set([normalizeText(itemName), canonical.mergeKey])
  const words = canonical.displayName.split(" ")
  const finalWord = words.at(-1) || ""
  const controlledPlural = DISPLAY_PLURALS[finalWord]
  if (controlledPlural) {
    words[words.length - 1] = controlledPlural
    keys.add(words.join(" "))
  }
  return [...keys].filter(Boolean)
}
