export type IngredientModifierDefinition = {
  evidence: readonly string[]
  structured?: true
  leading?: true
  trailing?: true
  trailingBeforeAlternative?: true
}

function modifier(
  evidence: readonly string[],
  positions: Omit<IngredientModifierDefinition, 'evidence'> = {}
): IngredientModifierDefinition {
  return { evidence, ...positions }
}

const INGREDIENT_MODIFIER_DEFINITIONS = new Map<
  string,
  IngredientModifierDefinition
>([
  ...[
    'chopped', 'crushed', 'cubed', 'diced', 'grated', 'halved',
    'juiced', 'mashed', 'minced', 'peeled', 'quartered', 'shredded',
    'sliced', 'zested',
  ].map((phrase): [string, IngredientModifierDefinition] => [
    phrase,
    modifier([phrase], { structured: true, leading: true, trailing: true }),
  ]),
  ['as needed', modifier(['as needed'], {
    structured: true, leading: true, trailing: true,
    trailingBeforeAlternative: true,
  })],
  ['divided', modifier(['divided'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ['drained', modifier(['drained'], { structured: true })],
  ['finely chopped', modifier(['finely chopped'], {
    structured: true, trailing: true,
  })],
  ['finely diced', modifier(['finely diced'], {
    structured: true, trailing: true,
  })],
  ['finely grated', modifier(['finely grated'], {
    structured: true, leading: true, trailing: true,
  })],
  ['finely minced', modifier(['finely minced'], {
    structured: true, leading: true, trailing: true,
  })],
  ['for garnish', modifier(['for garnish'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ['for serving', modifier(['for serving'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ['for topping', modifier(['for topping'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ['juice and zest', modifier(['juiced', 'zested'], { structured: true })],
  ['juiced and zested', modifier(['juiced', 'zested'], { structured: true })],
  ['optional', modifier([], {
    structured: true, leading: true, trailing: true,
    trailingBeforeAlternative: true,
  })],
  ['or to taste', modifier(['to taste'], {
    structured: true, leading: true, trailing: true,
    trailingBeforeAlternative: true,
  })],
  ['plus more', modifier(['plus more'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ['rinsed', modifier(['rinsed'], { structured: true })],
  ['roughly chopped', modifier(['roughly chopped'], {
    structured: true, trailing: true,
  })],
  ['sliced or diced', modifier(['diced', 'sliced'], {
    structured: true, leading: true,
  })],
  ['zest and juice', modifier(['juiced', 'zested'], { structured: true })],
  ['zested and juiced', modifier(['juiced', 'zested'], { structured: true })],
  ['softened', modifier(['softened'], { structured: true })],
  ['thinly sliced', modifier(['thinly sliced'], {
    structured: true, leading: true, trailing: true,
  })],
  ['to taste', modifier(['to taste'], {
    structured: true, trailing: true, trailingBeforeAlternative: true,
  })],
  ...[
    'browned', 'cooked', 'dried', 'extra large', 'fresh', 'frozen',
    'large', 'medium', 'melted', 'or unpeeled', 'peeled or', 'raw',
    'roasted', 'small', 'thawed', 'to be', 'toasted', 'uncooked', 'whole',
  ].map((phrase): [string, IngredientModifierDefinition] => [
    phrase,
    modifier([]),
  ]),
])

const MODIFIER_PHRASES = [...INGREDIENT_MODIFIER_DEFINITIONS.keys()]
  .sort((left, right) => right.length - left.length)

export function normalizeIngredientModifierText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/([a-z])-([a-z])/g, '$1 $2')
    .replace(/[;]+/g, ' ')
    .replace(/^[\s.:]+|[\s.:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ingredientModifierDefinition(
  value: string
): IngredientModifierDefinition | undefined {
  return INGREDIENT_MODIFIER_DEFINITIONS.get(
    normalizeIngredientModifierText(value)
  )
}

export function ingredientModifierPhrasesAt(
  position: 'leading' | 'trailing'
): string[] {
  return MODIFIER_PHRASES.filter((phrase) =>
    INGREDIENT_MODIFIER_DEFINITIONS.get(phrase)?.[position]
  )
}

export function isIngredientModifierLike(value: string): boolean {
  const normalized = normalizeIngredientModifierText(value)
  return Boolean(normalized) && MODIFIER_PHRASES.some((phrase) =>
    normalized === phrase || normalized.endsWith(` ${phrase}`)
  )
}

export function startsWithIngredientModifier(value: string): boolean {
  const normalized = normalizeIngredientModifierText(value)
  return MODIFIER_PHRASES.some((phrase) =>
    normalized === phrase || normalized.startsWith(`${phrase} `)
  )
}

export function ingredientModifierAllowsMissingAmount(
  value: string,
  allowOptionalWithoutAmount: boolean
): boolean {
  const normalized = normalizeIngredientModifierText(value)
  if (normalized === 'to taste' || normalized === 'as needed') return true
  return allowOptionalWithoutAmount && (
    normalized === 'optional' || normalized === 'for serving' ||
    normalized === 'for garnish'
  )
}

export function ingredientModifierSharesAlternativeNoun(value: string): boolean {
  const normalized = normalizeIngredientModifierText(value)
  return normalized === 'sliced' || normalized === 'diced'
}

export function normalizeIngredientCommaDelimiters(value: string): string {
  return value
    .replace(/[ \t]*[,\uFF0C][ \t]*/g, ',')
    .replace(/,(?!,|$)/g, ', ')
}

interface CommaSegment {
  start: number
  text: string
}

function topLevelCommaSegments(value: string): CommaSegment[] {
  const segments: CommaSegment[] = []
  let start = 0
  let parenthesisDepth = 0

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') parenthesisDepth += 1
    else if (value[index] === ')') parenthesisDepth -= 1
    else if (value[index] === ',' && parenthesisDepth === 0) {
      segments.push({ start, text: value.slice(start, index).trim() })
      start = index + 1
    }
  }

  segments.push({ start, text: value.slice(start).trim() })
  return segments
}

export interface IngredientCommaSuffixClassification {
  normalizedValue: string
  item: string
  expression: string
  exactRecognized: boolean
  semanticSupported: boolean
  segmentCount: number
}

export function classifyIngredientCommaSuffix(
  value: string
): IngredientCommaSuffixClassification | null {
  const normalizedValue = normalizeIngredientCommaDelimiters(value)
  const segments = topLevelCommaSegments(normalizedValue)
  if (segments.length < 2) return null

  let candidateIndex = segments.findIndex((segment, index) =>
    index > 0 && isIngredientModifierLike(segment.text)
  )
  if (candidateIndex < 1) return null

  while (candidateIndex > 1 && !segments[candidateIndex - 1].text) {
    candidateIndex -= 1
  }

  const suffixSegments = segments.slice(candidateIndex)
  const expression = normalizedValue.slice(segments[candidateIndex].start).trim()
  const definition = ingredientModifierDefinition(expression)

  return {
    normalizedValue,
    item: normalizedValue.slice(0, segments[candidateIndex].start - 1).trim(),
    expression,
    exactRecognized: Boolean(definition),
    semanticSupported: suffixSegments.length === 1 &&
      Boolean(definition?.structured),
    segmentCount: suffixSegments.length,
  }
}
