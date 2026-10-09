import type {
  CanonicalIngredient,
  Ingredient,
  IngredientSection,
  InstructionSection,
} from "@/types/database"
import {
  WHOLE_COUNT_UNIT,
  normalizeWholeCountUnit,
} from "@/lib/ingredient-units"
import {
  parseIngredientQuantityPrefix,
  RECIPE_QUANTITY_LIMITS,
  parseQuantityV1,
  parseYieldMetadata,
  quantityToLegacyAmount,
} from "@/lib/recipe-quantity"
import type { YieldMetadataV1 } from "@/types/database"
import {
  classifyIngredientCommaSuffix,
  ingredientModifierAllowsMissingAmount,
  ingredientModifierSharesAlternativeNoun,
  isIngredientModifierLike,
  normalizeIngredientCommaDelimiters,
  startsWithIngredientModifier,
} from '@/lib/ingredient-modifier-classification'

type SectionKind = "ingredients" | "instructions" | "notes"

interface RecipeLine {
  raw: string
  trimmed: string
}

interface SectionBlock {
  kind: SectionKind
  header: string
  headingLevel?: number
  lines: RecipeLine[]
}

interface MarkdownHeading {
  level: number
  label: string
}

export interface ParsedRecipeMetadata {
  servingsText?: string
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
}

export interface ParsedIngredientGroup {
  label?: string
  ingredients: Ingredient[]
}

export interface ParsedInstructionGroup {
  label?: string
  steps: string[]
}

export interface ParsedRecipe {
  name: string
  category?: string
  ingredientSections: IngredientSection[]
  instructionSections: InstructionSection[]
  servings?: number
  yieldMetadata?: YieldMetadataV1
  notes?: string[]
  metadata?: ParsedRecipeMetadata
  warnings: string[]
  unparsedContent?: string[]
}

/**
 * Parse a recipe from plain text.
 *
 * The parser is intentionally staged:
 * 1. Normalize lines
 * 2. Extract top-of-file metadata
 * 3. Detect top-level sections
 * 4. Detect subgroup labels inside sections
 * 5. Parse ingredients, instructions, and notes
 * 6. Return canonical ordered sections
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const warnings: string[] = []
  const lines = toRecipeLines(text)

  if (lines.every((line) => !line.trimmed)) {
    return {
      name: "",
      ingredientSections: [],
      instructionSections: [],
      warnings: ["No text to parse - paste recipe text above"],
    }
  }

  const {
    prelude,
    sections,
    ignoredMarkdownSections,
    ignoredContent,
    hasMarkdownSections,
  } = splitIntoSections(lines)
  const preludeMetadata = extractPreludeMetadata(prelude)

  let name = inferRecipeName(preludeMetadata.titleLine, preludeMetadata.remainingLines)
  const category = preludeMetadata.category
  let servings = preludeMetadata.servings
  const metadata = buildRecipeMetadata(preludeMetadata)

  for (const section of ignoredMarkdownSections) {
    warnings.push(`Unsupported Markdown section "${section}" was not imported.`)
  }

  if (!servings) {
    const servingsFromName = extractServingsFromText(name)
    if (servingsFromName) {
      servings = servingsFromName
      name = stripServingsFromTitle(name)
    }
  }

  const ingredientsSections = sections.filter((section) => section.kind === "ingredients")
  const instructionsSections = sections.filter((section) => section.kind === "instructions")
  const notesSections = sections.filter((section) => section.kind === "notes")

  let ingredientGroups: ParsedIngredientGroup[] = []
  let instructionGroups: ParsedInstructionGroup[] = []
  let notes: string[] = []

  if (sections.length === 0) {
    const fallback = parseLegacyRecipeText(
      preludeMetadata.remainingLines,
      name,
      servings
    )

    name = fallback.name
    servings = fallback.servings
    ingredientGroups = fallback.ingredientGroups
    instructionGroups = fallback.instructionGroups
    notes = fallback.notes
  } else {
    ingredientGroups = ingredientsSections.length > 0
      ? ingredientsSections.flatMap((section) =>
          parseIngredientSection(section.lines)
        )
      : hasMarkdownSections
        ? []
        : parseIngredientSection(
            inferPreludeIngredientLines(preludeMetadata.remainingLines, name)
          )

    instructionGroups = instructionsSections.flatMap((section) =>
      parseInstructionSection(section.lines)
    )

    notes = notesSections.flatMap((section) => parseNotesSection(section.lines))
  }

  // The recipe model has only prep/cook/total fields. Keep other authored timing
  // attributes verbatim in Notes instead of inventing a persisted field.
  const preservedTiming = preludeMetadata.remainingLines
    .filter(line => sections.length > 0 && isUnsupportedTimingLine(line.trimmed))
    .map(line => line.trimmed)
  notes = [...preservedTiming, ...notes]
  for (const timing of preservedTiming) {
    warnings.push(`"${timing}" was preserved in Notes; no dedicated timing field exists.`)
  }

  const unparsedContent = [...ignoredContent, ...preludeMetadata.unparsedContent]
  if (sections.length === 0) {
    // Heuristic legacy inference cannot establish complete source coverage for a replacement.
    unparsedContent.push('Use Ingredients and Instructions headings so every section can be reviewed.')
  } else {
    const title = preludeMetadata.titleLine || name
    for (const line of preludeMetadata.remainingLines) {
      if (!line.trimmed || cleanDetectedTitle(line.trimmed) === title ||
          preservedTiming.includes(line.trimmed)) continue
      if (ingredientsSections.length === 0 && !hasMarkdownSections) continue
      unparsedContent.push(line.trimmed)
    }
    for (const section of sections) {
      const parsedLabels = (section.kind === 'ingredients'
        ? parseIngredientSection(section.lines)
        : parseInstructionSection(section.lines))
        .flatMap(group => group.label ? [group.label] : [])
      for (const [index, line] of section.lines.entries()) {
        const label = parseMarkdownHeading(line.trimmed)?.label ||
          (isSubsectionLabel(line.trimmed) ? stripTrailingColon(line.trimmed) : null) ||
          (section.kind === 'ingredients' && isBareIngredientHeading(section.lines, index)
            ? line.trimmed : null) ||
          (section.kind === 'instructions' && isNumberedInstructionHeading(section.lines, index)
            ? stripInstructionMarker(line.trimmed) : null)
        if (label && section.kind !== 'notes') {
          const index = parsedLabels.indexOf(label)
          if (index < 0) unparsedContent.push(line.trimmed)
          else parsedLabels.splice(index, 1)
        }
        if (isRecipeMetadataLine(line.trimmed)) unparsedContent.push(line.trimmed)
        if (section.kind === 'notes' && parseMarkdownHeading(line.trimmed)) unparsedContent.push(line.trimmed)
        if (section.kind === 'ingredients' && line.trimmed &&
            !parseMarkdownHeading(line.trimmed) && !isSubsectionLabel(line.trimmed) &&
            !isRecipeMetadataLine(line.trimmed) && !parseIngredientLine(line.trimmed).item) {
          unparsedContent.push(line.trimmed)
        }
      }
    }
    for (const [text, minutes] of [
      [metadata?.prepTime, metadata?.prepTimeMinutes],
      [metadata?.cookTime, metadata?.cookTimeMinutes],
      [metadata?.totalTime, metadata?.totalTimeMinutes],
    ]) {
      if (text && (minutes === undefined || String(text)
        .replace(/\d+(?:\.\d+)?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/gi, '')
        .replace(/\band\b|[\s,]/gi, '').length > 0)) unparsedContent.push(String(text))
    }
    if (preludeMetadata.servingsText && !servings) unparsedContent.push(preludeMetadata.servingsText)
  }

  const ingredients = flattenIngredientGroups(ingredientGroups)
  const ingredientSections = ingredientGroups.map((group) => ({
    label: group.label?.trim() || null,
    ingredients: group.ingredients.map(stripIngredientGroupLabel),
  }))
  const instructionSections = instructionGroups.map((group) => ({
    label: group.label?.trim() || null,
    steps: [...group.steps],
  }))

  if (!name || name === "Untitled Recipe") {
    warnings.push('No recipe name found - using "Untitled Recipe"')
  }

  if (ingredients.length === 0) {
    warnings.push('No ingredients found - add an "Ingredients" section')
  } else {
    const noAmountIngredients = ingredients.filter((ingredient) =>
      shouldWarnMissingIngredientAmount(ingredient, hasMarkdownSections)
    )
    if (noAmountIngredients.length === 1) {
      warnings.push(`"${noAmountIngredients[0].item}" has no amount`)
    } else if (noAmountIngredients.length > 1 && noAmountIngredients.length <= 3) {
      warnings.push(
        `${noAmountIngredients.length} ingredients have no amounts: ${noAmountIngredients
          .map((ingredient) => ingredient.item)
          .join(", ")}`
      )
    } else if (noAmountIngredients.length > 3) {
      warnings.push(`${noAmountIngredients.length} ingredients have no amounts`)
    }
    const unparsedQuantities = ingredients.filter(
      (ingredient) => ingredient.quantityV1?.kind === "unparsed"
    )
    if (unparsedQuantities.length > 0) {
      warnings.push(
        `${unparsedQuantities.length} ingredient ${
          unparsedQuantities.length === 1 ? "quantity was" : "quantities were"
        } preserved unchanged because ${
          unparsedQuantities.length === 1 ? "it was" : "they were"
        } not fully understood.`
      )
    }
  }

  if (instructionGroups.length === 0) {
    warnings.push('No instructions found - add a "Directions" or "Instructions" section')
  }

  return {
    name: name || "Untitled Recipe",
    category,
    ingredientSections,
    instructionSections,
    servings,
    yieldMetadata:
      preludeMetadata.servingsText && servings
        ? parseYieldMetadata(preludeMetadata.servingsText, servings) ?? undefined
        : servings
          ? parseYieldMetadata(`${servings} servings`, servings) ?? undefined
          : undefined,
    notes: notes.length > 0 ? notes : undefined,
    metadata,
    warnings,
    unparsedContent: [...new Set(unparsedContent)],
  }
}

function stripIngredientGroupLabel(
  ingredient: Ingredient
): CanonicalIngredient {
  const { groupLabel: _groupLabel, ...canonical } = ingredient
  return canonical
}

function toRecipeLines(text: string): RecipeLine[] {
  const normalized = text
    .replace(/\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    // Clipboard Markdown can escape headings, bullets, and punctuation and
    // use a trailing backslash for a hard line break. Decode one layer before
    // section detection, while retaining backslashes before ordinary letters.
    .replace(
      /\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])|\\[ \t]*$/gm,
      (_match, escaped: string | undefined) => escaped ?? ""
    )

  return normalized.split("\n").map((raw) => ({
    raw,
    trimmed: raw.trim(),
  }))
}

function splitIntoSections(lines: RecipeLine[]): {
  prelude: RecipeLine[]
  sections: SectionBlock[]
  ignoredMarkdownSections: string[]
  ignoredContent: string[]
  hasMarkdownSections: boolean
} {
  const prelude: RecipeLine[] = []
  const sections: SectionBlock[] = []
  const ignoredMarkdownSections: string[] = []
  const ignoredContent: string[] = []
  let currentSection: SectionBlock | null = null
  let ignoringMarkdownSection = false
  let hasMarkdownSections = false

  for (const line of lines) {
    const heading = parseMarkdownHeading(line.trimmed)
    const kind = parseTopLevelSectionKind(line.trimmed)

    if (heading && kind) {
      if (currentSection) {
        sections.push(currentSection)
      }

      ignoringMarkdownSection = false
      hasMarkdownSections = true
      currentSection = {
        kind,
        header: line.trimmed,
        headingLevel: heading.level,
        lines: [],
      }
      continue
    }

    if (heading) {
      if (
        currentSection &&
        currentSection.headingLevel !== undefined &&
        heading.level > currentSection.headingLevel
      ) {
        currentSection.lines.push(line)
        continue
      }

      if (currentSection) {
        sections.push(currentSection)
        currentSection = null
      }

      if (sections.length === 0) {
        ignoringMarkdownSection = false
        prelude.push(line)
      } else {
        ignoringMarkdownSection = true
        ignoredMarkdownSections.push(heading.label)
        ignoredContent.push(line.trimmed)
      }
      continue
    }

    if (kind) {
      ignoringMarkdownSection = false
      if (currentSection) {
        sections.push(currentSection)
      }

      currentSection = {
        kind,
        header: line.trimmed,
        lines: [],
      }
      continue
    }

    if (currentSection) {
      currentSection.lines.push(line)
    } else if (!ignoringMarkdownSection) {
      prelude.push(line)
    } else if (line.trimmed) {
      ignoredContent.push(line.trimmed)
    }
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return {
    prelude,
    sections,
    ignoredMarkdownSections,
    ignoredContent,
    hasMarkdownSections,
  }
}

function parseTopLevelSectionKind(line: string): SectionKind | null {
  const heading = parseMarkdownHeading(line)
  const normalized = normalizeHeaderLabel(heading?.label || line)
  if (!normalized) return null

  if (/^(?:ingredients?|what (?:you(?:['’]?ll| will)? )?need)$/.test(normalized)) {
    return "ingredients"
  }

  if (/^(instructions?|directions?|method|steps?)$/.test(normalized)) {
    return "instructions"
  }

  if (/^(notes?|tips?)$/.test(normalized)) {
    return "notes"
  }

  return null
}

function normalizeHeaderLabel(line: string): string {
  return line
    .toLowerCase()
    .replace(/[:\-\u2013\u2014]+$/, "")
    .trim()
}

function parseMarkdownHeading(line: string): MarkdownHeading | null {
  const match = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/)
  if (!match) {
    return null
  }

  const label = stripMarkdownInlineSyntax(match[2]).trim()
  if (!label) {
    return null
  }

  return {
    level: match[1].length,
    label,
  }
}

function extractPreludeMetadata(lines: RecipeLine[]): {
  unparsedContent: string[]
  titleLine?: string
  remainingLines: RecipeLine[]
  category?: string
  servings?: number
  servingsText?: string
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
} {
  const remainingLines: RecipeLine[] = []
  const metadata: {
    titleLine?: string
    category?: string
    servings?: number
    servingsText?: string
    prepTime?: string
    prepTimeMinutes?: number
    cookTime?: string
    cookTimeMinutes?: number
    totalTime?: string
    totalTimeMinutes?: number
  } = {}

  const markdownTitle = lines
    .map((line) => parseMarkdownHeading(line.trimmed))
    .find((heading) => heading !== null)

  if (markdownTitle) {
    metadata.titleLine = markdownTitle.label
  }

  const unparsedContent: string[] = []
  const consumed = new Map<PreludeAttributeKey, { value: string; source: string }>()
  for (const line of lines) {
    const heading = parseMarkdownHeading(line.trimmed)
    const attribute = heading
      ? { key: 'title' as const, value: heading.label, bold: false }
      : parsePreludeAttribute(line.trimmed)
    if (!attribute) {
      remainingLines.push(line)
      continue
    }

    // Track the same tokens extraction consumes, including aliases and colonless
    // yield syntax. Report both values when one source occurrence hides another.
    const previous = consumed.get(attribute.key)
    if (previous && previous.value !== attribute.value) {
      unparsedContent.push(previous.source, line.trimmed)
    }
    consumed.set(attribute.key, { value: attribute.value, source: line.trimmed })

    switch (attribute.key) {
      case 'title':
        if (!markdownTitle) metadata.titleLine = attribute.value
        break
      case 'category':
        metadata.category = normalizeRecipeCategory(attribute.value)
        break
      case 'yield':
        metadata.servings = extractServingsFromText(attribute.value)
        metadata.servingsText = attribute.bold || isServingRange(attribute.value) || !/^\d+$/.test(attribute.value)
          ? attribute.value : undefined
        break
      case 'prep':
        metadata.prepTime = attribute.value
        metadata.prepTimeMinutes = parseDurationToMinutes(attribute.value)
        break
      case 'cook':
        metadata.cookTime = attribute.value
        metadata.cookTimeMinutes = parseDurationToMinutes(attribute.value)
        break
      case 'total':
        metadata.totalTime = attribute.value
        metadata.totalTimeMinutes = parseDurationToMinutes(attribute.value)
        break
    }
  }

  return {
    unparsedContent,
    titleLine: metadata.titleLine,
    remainingLines,
    category: metadata.category,
    servings: metadata.servings,
    servingsText: metadata.servingsText,
    prepTime: metadata.prepTime,
    prepTimeMinutes: metadata.prepTimeMinutes,
    cookTime: metadata.cookTime,
    cookTimeMinutes: metadata.cookTimeMinutes,
    totalTime: metadata.totalTime,
    totalTimeMinutes: metadata.totalTimeMinutes,
  }
}

function parseBoldAttributeLine(
  line: string
): { label: string; value: string } | null {
  const match =
    line.match(/^\*\*\s*([^*:\n]+?)\s*:\s*\*\*\s*(.+)$/) ||
    line.match(/^\*\*\s*([^*\n]+?)\s*\*\*\s*:\s*(.+)$/)

  if (!match) {
    return null
  }

  const label = match[1].trim()
  const value = stripMarkdownInlineSyntax(match[2]).trim()
  return label && value ? { label, value } : null
}

type PreludeAttributeKey = 'title' | 'category' | 'yield' | 'prep' | 'cook' | 'total'

function parsePreludeAttribute(line: string): {
  key: PreludeAttributeKey
  value: string
  bold: boolean
} | null {
  const bold = parseBoldAttributeLine(line)
  const plain = line.match(/^(title|recipe|name|category|prep(?:aration)?(?:\s*time)?|cook(?:ing)?(?:\s*time)?|total(?:\s*time)?)\s*:\s*(.+)$/i) ||
    line.match(/^(servings?|serves|yield|makes?)\s*:?\s*(.+)$/i)
  const label = (bold?.label ?? plain?.[1])?.toLowerCase().replace(/\s+/g, ' ').trim()
  const value = stripMarkdownInlineSyntax(bold?.value ?? plain?.[2] ?? '').trim()
  if (!label || !value) return null

  const key: PreludeAttributeKey | null = /^(title|recipe|name)$/.test(label) ? 'title'
    : label === 'category' ? 'category'
    : /^(servings?|serves|yield|makes?)$/.test(label) ? 'yield'
    : /^prep(?:aration)?(?:\s*time)?$/.test(label) ? 'prep'
    : /^cook(?:ing)?(?:\s*time)?$/.test(label) ? 'cook'
    : /^total(?:\s*time)?$/.test(label) ? 'total' : null
  return key ? { key, value, bold: !!bold } : null
}

function buildRecipeMetadata(metadata: {
  servingsText?: string
  prepTime?: string
  prepTimeMinutes?: number
  cookTime?: string
  cookTimeMinutes?: number
  totalTime?: string
  totalTimeMinutes?: number
}): ParsedRecipeMetadata | undefined {
  if (!hasRecipeMetadata(metadata)) {
    return undefined
  }

  return {
    ...(metadata.servingsText
      ? { servingsText: metadata.servingsText }
      : {}),
    prepTime: metadata.prepTime,
    prepTimeMinutes: metadata.prepTimeMinutes,
    cookTime: metadata.cookTime,
    cookTimeMinutes: metadata.cookTimeMinutes,
    totalTime: metadata.totalTime,
    totalTimeMinutes: metadata.totalTimeMinutes,
  }
}

function hasRecipeMetadata(metadata: {
  servingsText?: string
  prepTime?: string
  cookTime?: string
  totalTime?: string
}): boolean {
  return Boolean(
    metadata.servingsText ||
    metadata.prepTime ||
    metadata.cookTime ||
    metadata.totalTime
  )
}

function inferRecipeName(titleLine: string | undefined, remainingPreludeLines: RecipeLine[]): string {
  if (titleLine) {
    return cleanDetectedTitle(titleLine)
  }

  const firstContentLine = remainingPreludeLines.find((line) => line.trimmed)
  return cleanDetectedTitle(firstContentLine?.trimmed || "")
}

function cleanDetectedTitle(value: string): string {
  const heading = parseMarkdownHeading(value.trim())
  if (heading) {
    return heading.label
  }

  return stripMarkdownInlineSyntax(
    value.replace(/^(?:title|recipe|name)\s*:\s*/i, "")
  ).trim()
}

function stripServingsFromTitle(value: string): string {
  return value
    .replace(
      /\s*[\(\-–—,]?\s*(?:makes?|serves?)\s+\d+\s*(?:servings?|people|portions?)?\)?$/i,
      ""
    )
    .replace(/\s*[\(\-–—,]?\s*\d+\s*(?:servings?|people|portions?)\)?$/i, "")
    .replace(/\s*\(\s*serves?\s+\d+\s*\)$/i, "")
    .trim()
}

function extractServingsFromText(value: string): number | undefined {
  const directNumberMatch = value.match(/(\d+(?:\.\d+)?)/)
  if (!directNumberMatch) return undefined

  const servingsContextMatch = value.match(
    /\b(\d+(?:\.\d+)?)\b(?:\s*(?:servings?|people|portions?|cookies?))?/i
  )

  if (!servingsContextMatch) {
    return undefined
  }

  const servings = parseFloat(servingsContextMatch[1])
  return Number.isFinite(servings) ? Math.round(servings) : undefined
}

function isServingRange(value: string): boolean {
  return /\d+(?:\.\d+)?\s*[\u2013\u2014-]\s*\d+(?:\.\d+)?/.test(value)
}

function parseDurationToMinutes(value: string): number | undefined {
  const normalized = value.toLowerCase().replace(/\u2013|\u2014/g, "-")
  const unitPattern =
    /(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/g

  let totalMinutes = 0
  let match: RegExpExecArray | null

  while ((match = unitPattern.exec(normalized)) !== null) {
    const amount = parseFloat(match[1])
    const unit = match[2]

    if (!Number.isFinite(amount)) {
      continue
    }

    if (/^h(?:ours?|rs?)?$/.test(unit)) {
      totalMinutes += amount * 60
      continue
    }

    totalMinutes += amount
  }

  return totalMinutes > 0 ? Math.round(totalMinutes) : undefined
}

function inferPreludeIngredientLines(lines: RecipeLine[], name: string): RecipeLine[] {
  const contentLines = lines.filter((line) => line.trimmed)
  if (contentLines.length === 0) {
    return []
  }

  if (name && cleanDetectedTitle(contentLines[0].trimmed) === name) {
    return contentLines.slice(1)
  }

  return contentLines
}

function parseIngredientSection(lines: RecipeLine[]): ParsedIngredientGroup[] {
  const groups: ParsedIngredientGroup[] = []
  let currentGroup: ParsedIngredientGroup = { ingredients: [] }
  let pendingMarkdownItem: string | null = null

  const pushCurrentGroup = () => {
    if (currentGroup.ingredients.length === 0) {
      return
    }

    groups.push(currentGroup)
  }

  const addIngredient = (value: string) => {
    const ingredient = parseIngredientLine(value)
    if (!ingredient.item) {
      return
    }

    currentGroup.ingredients.push(
      currentGroup.label
        ? {
            ...ingredient,
            groupLabel: currentGroup.label,
          }
        : ingredient
    )
  }

  const flushPendingMarkdownItem = () => {
    if (!pendingMarkdownItem) {
      return
    }

    addIngredient(pendingMarkdownItem)
    pendingMarkdownItem = null
  }

  for (const [index, line] of lines.entries()) {
    if (!line.trimmed) {
      flushPendingMarkdownItem()
      continue
    }

    const heading = parseMarkdownHeading(line.trimmed)
    if (heading) {
      flushPendingMarkdownItem()
      pushCurrentGroup()
      currentGroup = {
        label: heading.label,
        ingredients: [],
      }
      continue
    }

    if (isRecipeMetadataLine(line.trimmed)) {
      flushPendingMarkdownItem()
      continue
    }

    if (isSubsectionLabel(line.trimmed) || isBareIngredientHeading(lines, index)) {
      flushPendingMarkdownItem()
      pushCurrentGroup()
      currentGroup = {
        label: stripTrailingColon(line.trimmed),
        ingredients: [],
      }
      continue
    }

    if (isBulletItem(line.trimmed)) {
      flushPendingMarkdownItem()
      pendingMarkdownItem = line.trimmed
      continue
    }

    if (pendingMarkdownItem && /^\s+/.test(line.raw)) {
      pendingMarkdownItem = `${pendingMarkdownItem} ${line.trimmed}`
      continue
    }

    flushPendingMarkdownItem()
    addIngredient(line.trimmed)
  }

  flushPendingMarkdownItem()
  pushCurrentGroup()
  return groups
}

function parseInstructionSection(lines: RecipeLine[]): ParsedInstructionGroup[] {
  const groups: ParsedInstructionGroup[] = []
  let currentGroup: ParsedInstructionGroup = { steps: [] }
  let pendingStep: string | null = null

  const flushPendingStep = () => {
    if (!pendingStep) {
      return
    }

    currentGroup.steps.push(pendingStep)
    pendingStep = null
  }

  const pushCurrentGroup = () => {
    flushPendingStep()

    if (currentGroup.steps.length === 0) {
      return
    }

    groups.push(currentGroup)
  }

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trimmed

    if (!trimmed) {
      flushPendingStep()
      continue
    }

    const heading = parseMarkdownHeading(trimmed)
    if (heading) {
      pushCurrentGroup()
      currentGroup = {
        label: heading.label,
        steps: [],
      }
      continue
    }

    if (isRecipeMetadataLine(trimmed)) {
      continue
    }

    if (isSubsectionLabel(trimmed) || isNumberedInstructionHeading(lines, index)) {
      pushCurrentGroup()
      currentGroup = {
        label: isSubsectionLabel(trimmed)
          ? stripTrailingColon(trimmed) : stripInstructionMarker(trimmed),
        steps: [],
      }
      continue
    }

    if (isInstructionStepStart(trimmed)) {
      flushPendingStep()
      pendingStep = stripInstructionMarker(trimmed)
      continue
    }

    const content = stripMarkdownInlineSyntax(trimmed)
    pendingStep = pendingStep ? `${pendingStep} ${content}` : content
  }

  pushCurrentGroup()
  return groups
}

function parseNotesSection(lines: RecipeLine[]): string[] {
  const notes: string[] = []
  let pendingParagraph: string | null = null

  const flushPendingParagraph = () => {
    if (!pendingParagraph) {
      return
    }

    notes.push(pendingParagraph)
    pendingParagraph = null
  }

  for (const line of lines) {
    if (!line.trimmed) {
      flushPendingParagraph()
      continue
    }

    if (parseMarkdownHeading(line.trimmed)) {
      flushPendingParagraph()
      continue
    }

    if (isRecipeMetadataLine(line.trimmed)) {
      flushPendingParagraph()
      continue
    }

    if (isBulletItem(line.trimmed)) {
      flushPendingParagraph()
      pendingParagraph = stripInstructionMarker(line.trimmed)
      continue
    }

    const content = stripMarkdownInlineSyntax(line.trimmed)
    pendingParagraph = pendingParagraph
      ? `${pendingParagraph} ${content}`
      : content
  }

  flushPendingParagraph()
  return notes
}

function flattenIngredientGroups(groups: ParsedIngredientGroup[]): Ingredient[] {
  return groups.flatMap((group) => group.ingredients)
}

function shouldWarnMissingIngredientAmount(
  ingredient: Ingredient,
  allowOptionalWithoutAmount = false
): boolean {
  if (!ingredient.item.trim()) {
    return false
  }

  if (ingredient.amount !== null) {
    return false
  }

  const modifier = ingredient.modifier?.trim()
  if (modifier && ingredientModifierAllowsMissingAmount(
    modifier,
    allowOptionalWithoutAmount
  )) {
    return false
  }

  return true
}

function isUnsupportedTimingLine(line: string): boolean {
  return !parsePreludeAttribute(line) &&
    /^(?:[A-Za-z][A-Za-z ]*\s+time|marinat(?:e|ion|ing))\s*:\s*\S/i.test(stripMarkdownInlineSyntax(line))
}

// Bare labels require layout evidence: an isolated title followed by a bullet
// list. Ordinary amountless lines within a list stay ingredients. Explicit
// Markdown/colon headings remain available for inherently ambiguous prose.
function isPlainTitle(line: string): boolean {
  const words = line.split(/\s+/)
  return words.length <= 8 && /^[A-Z]/.test(line) &&
    words.every(word => !/^[a-z]/.test(word) ||
      /^(?:and|or|for|the|of|with|to|in)$/.test(word))
}

function isBareIngredientHeading(lines: RecipeLine[], index: number): boolean {
  const line = lines[index].trimmed
  if (!line || (index > 0 && lines[index - 1].trimmed) ||
      lines[index + 1]?.trimmed || isBulletItem(line) ||
      parseIngredientQuantityPrefix(line) || isRecipeMetadataLine(line) ||
      /[.:!?(),\d]/.test(line) || line.length > 80) return false
  if (!isPlainTitle(line)) return false
  const next = lines.slice(index + 1).find(candidate => candidate.trimmed)
  return !!next && isBulletItem(next.trimmed)
}

// A numbered title separated from its prose is a section label; conventional
// numbered sentences and wrapped list items are still instruction steps.
function isNumberedInstructionHeading(lines: RecipeLine[], index: number): boolean {
  const line = lines[index].trimmed
  if (!/^\d+[.)]\s+[A-Z]/.test(line) ||
      (index > 0 && lines[index - 1].trimmed) || lines[index + 1]?.trimmed ||
      /[.!?:]$/.test(line) || line.length > 100 ||
      !isPlainTitle(stripInstructionMarker(line)) ||
      stripInstructionMarker(line).split(/\s+/).length < 2) return false
  const next = lines.slice(index + 1).find(candidate => candidate.trimmed)
  return !!next && !isInstructionStepStart(next.trimmed) &&
    !parseMarkdownHeading(next.trimmed) && !isSubsectionLabel(next.trimmed)
}

function isSubsectionLabel(line: string): boolean {
  if (!line.endsWith(":")) {
    return false
  }

  if (parseTopLevelSectionKind(line)) {
    return false
  }

  const normalized = stripTrailingColon(line)

  if (!normalized) return false
  if (/\d/.test(normalized)) return false
  if (/[.!?]/.test(normalized)) return false
  if (/[(),]/.test(normalized)) return false

  const words = normalized.split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 6
}

function stripTrailingColon(line: string): string {
  return line.replace(/:\s*$/, "").trim()
}

function isInstructionStepStart(line: string): boolean {
  return /^\s*(?:\d+[\.\)]|[-*+\u2022])\s+/.test(line)
}

function isBulletItem(line: string): boolean {
  return /^\s*[-*+\u2022]\s+/.test(line)
}

function isRecipeMetadataLine(line: string): boolean {
  const attribute = parsePreludeAttribute(line)
  // Short timing aliases are ambiguous with section titles and cooking prose.
  // In sections, only a duration value establishes that they are metadata.
  if (attribute && /^(?:prep(?:aration)?|cook(?:ing)?|total)\s*:/i.test(
    stripMarkdownInlineSyntax(line)
  )) return parseDurationToMinutes(attribute.value) !== undefined

  const boldAttribute = parseBoldAttributeLine(line)
  if (boldAttribute) {
    return isRecipeMetadataLabel(boldAttribute.label)
  }

  return (
    /^(?:category|servings?|prep(?:aration)?\s*time|cook(?:ing)?\s*time|total\s*time)\s*:/i.test(
      line
    ) ||
    /^(?:serves|yield|makes?)\s*:?\s*\d/i.test(line)
  )
}

function isRecipeMetadataLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim()
  return /^(?:category|servings?|serves|yield|makes?|prep(?:aration)? time|cook(?:ing)? time|total time)$/.test(
    normalized
  )
}

function normalizeRecipeCategory(value: string): string {
  return stripMarkdownInlineSyntax(value).replace(/\s+/g, " ").trim().toLowerCase()
}

function stripInstructionMarker(line: string): string {
  return stripMarkdownInlineSyntax(
    line.replace(/^\s*(?:\d+[\.\)]|[-*+\u2022])\s+/, "")
  ).trim()
}

function stripMarkdownInlineSyntax(value: string): string {
  return value
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
}

function parseLegacyRecipeText(
  lines: RecipeLine[],
  existingName: string,
  existingServings?: number
): {
  name: string
  servings?: number
  ingredientGroups: ParsedIngredientGroup[]
  instructionGroups: ParsedInstructionGroup[]
  notes: string[]
} {
  const contentLines = lines
    .map((line) => line.trimmed)
    .filter(Boolean)

  if (contentLines.length === 0) {
    return {
      name: existingName || "Untitled Recipe",
      servings: existingServings,
      ingredientGroups: [],
      instructionGroups: [],
      notes: [],
    }
  }

  let name = existingName
  let servings = existingServings

  if (!name) {
    name = cleanDetectedTitle(contentLines[0] || "")
  }

  if (!servings) {
    const servingsFromName = extractServingsFromText(name)
    if (servingsFromName) {
      servings = servingsFromName
      name = stripServingsFromTitle(name)
    }
  }

  const bodyLines =
    name && cleanDetectedTitle(contentLines[0] || "") === name
      ? contentLines.slice(1)
      : contentLines

  const ingredientsIndex = findSectionIndex(bodyLines, ["ingredients", "ingredient"])
  const instructionsIndex = findSectionIndex(bodyLines, [
    "instructions",
    "instruction",
    "directions",
    "direction",
    "method",
    "steps",
    "step",
  ])
  const notesIndex = findSectionIndex(bodyLines, ["notes", "note", "tips", "tip"])

  const ingredientsStart = ingredientsIndex >= 0 ? ingredientsIndex + 1 : 0
  let ingredientsEnd = instructionsIndex >= 0 ? instructionsIndex : bodyLines.length

  if (notesIndex >= 0 && (ingredientsEnd < 0 || notesIndex < ingredientsEnd)) {
    ingredientsEnd = notesIndex
  }

  const ingredientGroups =
    ingredientsStart < ingredientsEnd
      ? [
          {
            ingredients: bodyLines
              .slice(ingredientsStart, ingredientsEnd)
              .map((line) => parseIngredientLine(line))
              .filter((ingredient) => ingredient.item.length > 0),
          },
        ]
      : []

  let instructionLines: string[] = []
  if (instructionsIndex >= 0) {
    const instructionsEnd = notesIndex >= 0 ? notesIndex : bodyLines.length
    instructionLines = bodyLines.slice(instructionsIndex + 1, instructionsEnd)
  } else if (ingredientsIndex >= 0) {
    instructionLines = bodyLines.slice(ingredientsEnd)
  } else {
    instructionLines = bodyLines.filter(
      (line) => isInstructionStepStart(line) || line.length > 50
    )
  }

  const instructionGroups =
    instructionLines.length > 0
      ? [
          {
            steps: instructionLines
              .map((line) => stripInstructionMarker(line))
              .filter(Boolean),
          },
        ]
      : []

  const notes =
    notesIndex >= 0
      ? bodyLines.slice(notesIndex + 1).map((line) => stripInstructionMarker(line)).filter(Boolean)
      : []

  return {
    name: name || "Untitled Recipe",
    servings,
    ingredientGroups,
    instructionGroups,
    notes,
  }
}

function findSectionIndex(lines: string[], keywords: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const normalized = normalizeHeaderLabel(lines[index])
    if (keywords.some((keyword) => normalized === keyword)) {
      return index
    }
  }

  return -1
}

/**
 * Unicode fraction to decimal mapping.
 */
const UNICODE_FRACTIONS: Record<string, number> = {
  "\u00BD": 0.5,
  "\u2153": 1 / 3,
  "\u2154": 2 / 3,
  "\u00BC": 0.25,
  "\u00BE": 0.75,
  "\u2155": 0.2,
  "\u2156": 0.4,
  "\u2157": 0.6,
  "\u2158": 0.8,
  "\u2159": 1 / 6,
  "\u215A": 5 / 6,
  "\u215B": 0.125,
  "\u215C": 0.375,
  "\u215D": 0.625,
  "\u215E": 0.875,
}

/**
 * Common unit abbreviations.
 */
const UNIT_ABBREVIATIONS = [
  "tsp",
  "tbsp",
  "tablespoon",
  "teaspoon",
  "tablespoons",
  "teaspoons",
  "cup",
  "cups",
  "c",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "g",
  "gram",
  "grams",
  "kg",
  "kilogram",
  "kilograms",
  "ml",
  "milliliter",
  "milliliters",
  "l",
  "liter",
  "liters",
  "fl oz",
  "fluid ounce",
  "fluid ounces",
  "pt",
  "pint",
  "pints",
  "qt",
  "quart",
  "quarts",
  "gal",
  "gallon",
  "gallons",
  "can",
  "cans",
  "package",
  "packages",
  "pkg",
  "pkgs",
  "count",
  "counts",
  "whole",
  "whole/count",
  "whole item",
  "whole items",
  "clove",
  "cloves",
  "head",
  "heads",
  "piece",
  "pieces",
  "pc",
  "pcs",
  "slice",
  "slices",
  "strip",
  "strips",
  "pinch",
  "dash",
  "sprinkle",
]

/**
 * Parse a single ingredient line into an Ingredient object.
 */
export function parseIngredientLine(line: string): Ingredient {
  if (
    typeof line !== "string" ||
    line.length > RECIPE_QUANTITY_LIMITS.ingredientLineLength
  ) {
    return { item: "", amount: null, unit: "" }
  }
  let cleaned = line.trim()

  // Remove list markers at the start, but preserve numbered amounts.
  cleaned = cleaned.replace(/^[\-*+\u2022.]\s+/, "").trim()
  cleaned = stripMarkdownInlineSyntax(cleaned)

  const originalText = cleaned

  if (!cleaned || /^ingredients?:?$/i.test(cleaned)) {
    return { item: "", amount: null, unit: "" }
  }

  const structured = parseIngredientQuantityPrefix(cleaned)

  if (structured) {
    if (structured.confidence !== "high") {
      return {
        item: structured.rest || cleaned,
        amount: structured.quantityV1.authored || null,
        unit: "",
        quantityV1: structured.quantityV1,
        originalText,
      }
    }

    const { item: baseItem, modifier } = extractModifier(
      normalizeUnicode(structured.rest)
    )
    const { item: finalItem, alternatives } = extractAlternatives(baseItem)

    return {
      item: finalItem || cleaned,
      amount: quantityToLegacyAmount(structured.quantityV1),
      unit:
        normalizeWholeCountUnit(structured.authoredUnit) ||
        structured.authoredUnit ||
        structured.unit ||
        (structured.rest ? WHOLE_COUNT_UNIT : ""),
      quantityV1: structured.quantityV1,
      authoredUnit: structured.authoredUnit || undefined,
      packageV1: structured.packageV1,
      modifier: modifier || undefined,
      alternatives,
      originalText,
    }
  }

  const { item: baseItem, modifier } = extractModifier(cleaned)
  const { item: finalItem, alternatives } = extractAlternatives(baseItem)

  return {
    item: finalItem,
    amount: null,
    unit: "",
    modifier: modifier || undefined,
    alternatives,
    originalText,
  }
}

/**
 * Normalize a quantity typed into an ingredient amount field.
 * Ranges use decimal endpoints and an en dash (for example, `0.5–1`).
 */
export function parseIngredientAmountInput(value: string): Ingredient["amount"] {
  const quantity = parseQuantityV1(value)
  return quantity.kind === "exact" || quantity.kind === "range"
    ? quantityToLegacyAmount(quantity)
    : null
}

export function parseIngredientAmountLexeme(value: string): string | null {
  const quantity = parseQuantityV1(value)
  return quantity.kind === "exact" || quantity.kind === "range"
    ? value.trim()
    : null
}

export function getIngredientQuantityRange(
  amount: Ingredient["amount"]
): { start: number; end: number; quantity: string } | null {
  if (typeof amount !== "string") {
    return null
  }

  const normalized = parseIngredientAmountInput(amount)
  if (typeof normalized !== "string") {
    return null
  }

  const [start, end] = normalized.split("–").map(Number)
  return { start, end, quantity: normalized }
}

export function hasIngredientAmount(amount: Ingredient["amount"]): boolean {
  return typeof amount === "number" ? amount > 0 : Boolean(amount?.trim())
}

function formatQuantityRange(start: number, end: number): string {
  return `${start}–${end}`
}

function normalizeUnicode(text: string): string {
  let normalized = text

  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    const mixedPattern = new RegExp(`(\\d+)${char}`, "g")
    normalized = normalized.replace(mixedPattern, (_match, whole) => {
      const wholeNumber = parseFloat(whole)
      return (wholeNumber + value).toString()
    })
  }

  for (const [char, value] of Object.entries(UNICODE_FRACTIONS)) {
    normalized = normalized.replace(new RegExp(char, "g"), value.toString())
  }

  normalized = normalized.replace(/[\u2013\u2014]/g, "-")
  return normalized
}

function parseAmount(amountStr: string): number {
  const mixedFraction = amountStr.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (mixedFraction) {
    const whole = parseFloat(mixedFraction[1])
    const numerator = parseFloat(mixedFraction[2])
    const denominator = parseFloat(mixedFraction[3])
    if (denominator !== 0) {
      return whole + numerator / denominator
    }
  }

  if (amountStr.includes("/")) {
    return parseFraction(amountStr)
  }

  const amount = parseFloat(amountStr)
  return Number.isNaN(amount) ? 0 : amount
}

function extractUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null

  const parenMatch = text.match(/^(\([^)]+\))\s*/)
  if (parenMatch) {
    const parenUnit = parenMatch[1]
    const afterParen = text.substring(parenMatch[0].length).trim()
    const unitMatch = matchUnit(afterParen)

    if (unitMatch) {
      return {
        unit: `${unitMatch.unit} ${parenUnit}`.trim(),
        endIndex: parenMatch[0].length + unitMatch.endIndex,
      }
    }

    return {
      unit: parenUnit,
      endIndex: parenMatch[0].length,
    }
  }

  return matchUnit(text)
}

function matchUnit(text: string): { unit: string; endIndex: number } | null {
  if (!text) return null

  const sortedUnits = [...UNIT_ABBREVIATIONS].sort((left, right) => right.length - left.length)

  for (const unit of sortedUnits) {
    const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`^(${escapedUnit})(\\s+|$)`, "i")
    const match = text.match(regex)

    if (match) {
      return {
        unit: match[1],
        endIndex: match[0].length,
      }
    }
  }

  return null
}

function extractModifier(item: string): { item: string; modifier: string | null } {
  if (!item) {
    return { item: "", modifier: null }
  }

  let baseItem = normalizeIngredientCommaDelimiters(item)
  const modifiers: string[] = []
  let deferredCommaModifier: string | null = null

  const commaSuffix = classifyIngredientCommaSuffix(baseItem)
  if (commaSuffix && commaSuffix.segmentCount > 1) {
    return { item: commaSuffix.normalizedValue, modifier: null }
  }
  if (commaSuffix?.exactRecognized) {
    baseItem = commaSuffix.item
    if (/^for\s+/i.test(commaSuffix.expression)) {
      modifiers.push(commaSuffix.expression)
    } else {
      deferredCommaModifier = commaSuffix.expression
    }
  }

  const forPattern = /,?\s*\bfor\s+[a-z\s]+$/i
  const forMatch = baseItem.match(forPattern)
  if (forMatch) {
    const forText = forMatch[0].replace(/^,\s*/, "").trim()
    if (forText.length < 30) {
      modifiers.push(forText)
      baseItem = baseItem.substring(0, baseItem.length - forMatch[0].length).trim()
    }
  }

  const parenPattern = /\s*\(([^)]+)\)\s*/g
  const parenMatches: { text: string; fullMatch: string; index: number }[] = []
  let match: RegExpExecArray | null

  while ((match = parenPattern.exec(baseItem)) !== null) {
    parenMatches.push({
      text: match[1].trim(),
      fullMatch: match[0],
      index: match.index,
    })
  }

  for (const parenMatch of parenMatches.reverse()) {
    const innerText = parenMatch.text
    const isModifier = innerText.length <= 30 &&
      startsWithIngredientModifier(innerText)

    if (isModifier) {
      modifiers.unshift(innerText)
      const before = baseItem.substring(0, parenMatch.index)
      const after = baseItem.substring(parenMatch.index + parenMatch.fullMatch.length)
      baseItem = `${before} ${after}`.replace(/\s+/g, " ").trim()
    }
  }

  const topLevelCommaIndexes: number[] = []
  let parenDepth = 0

  for (let index = 0; index < baseItem.length; index += 1) {
    if (baseItem[index] === "(") parenDepth += 1
    else if (baseItem[index] === ")") parenDepth -= 1
    else if (baseItem[index] === "," && parenDepth === 0) {
      topLevelCommaIndexes.push(index)
    }
  }

  if (deferredCommaModifier) {
    modifiers.unshift(deferredCommaModifier)
  }

  const lastCommaIndex = topLevelCommaIndexes.at(-1) ?? -1
  if (lastCommaIndex !== -1) {
    const potentialModifier = baseItem.substring(lastCommaIndex + 1).trim()
    const beforeComma = baseItem.substring(0, lastCommaIndex).trim()
    const isCommaDelimitedChoice = /^or\s+/i.test(potentialModifier) &&
      beforeComma.includes(',')

    const isLikelyModifier =
      !isCommaDelimitedChoice &&
      potentialModifier.length > 0 &&
      potentialModifier.length < 60 &&
      !/^\d+/.test(potentialModifier) &&
      beforeComma.length > 0 &&
      potentialModifier.length < 25

    if (isLikelyModifier) {
      modifiers.unshift(potentialModifier)
      baseItem = beforeComma
    }
  }

  return modifiers.length > 0
    ? { item: baseItem, modifier: modifiers.join(", ") }
    : { item: baseItem, modifier: null }
}

function extractAlternatives(item: string): { item: string; alternatives?: string[] } {
  const commaSuffix = classifyIngredientCommaSuffix(item)
  if (commaSuffix && commaSuffix.segmentCount > 1) {
    return { item }
  }

  if (isIngredientModifierLike(item)) {
    return { item }
  }

  const modifierContextPatterns = [
    /more or less/i,
    /or more/i,
    /or less/i,
  ]

  for (const pattern of modifierContextPatterns) {
    if (pattern.test(item)) {
      return { item }
    }
  }

  const commaChoices = item.split(/\s*,\s*/).map((choice) =>
    choice.replace(/^or\s+/i, '').trim()).filter(Boolean)
  const hasCommaChoiceSyntax = /,\s*or\s+/i.test(item)
  if (commaChoices.length >= 3 && hasCommaChoiceSyntax &&
      /^other\s+\S+/i.test(commaChoices.at(-1) || '')) {
    return {
      item: commaChoices[0],
      alternatives: commaChoices.slice(1),
    }
  }
  if (hasCommaChoiceSyntax) return { item }

  const alternativeMatch = item.match(/^(.+?)\s+\bor\b\s+(.+)$/i)
  if (!alternativeMatch) {
    return { item }
  }

  let primary = alternativeMatch[1].trim()
  const alternative = alternativeMatch[2].trim()

  if (primary.length <= 1 || alternative.length <= 1) {
    return { item }
  }

  const primaryWords = primary.split(/\s+/)
  const alternativeWords = alternative.split(/\s+/)
  const primaryLast = primaryWords.at(-1)?.toLowerCase() || ''
  const sharedNoun = alternativeWords.at(-1) || ''
  const sharedNounQualifier = primaryLast === 'red' ||
    primaryLast === 'white' ||
    ingredientModifierSharesAlternativeNoun(primaryLast) ||
    primaryLast.endsWith('-blend')
  if (sharedNounQualifier && sharedNoun &&
      primaryLast !== sharedNoun.toLowerCase()) {
    primary = `${primary} ${sharedNoun}`
  }

  return {
    item: primary,
    alternatives: [alternative],
  }
}

function parseFraction(fraction: string): number {
  const parts = fraction.split("/")
  if (parts.length !== 2) {
    return parseFloat(fraction) || 0
  }

  const numerator = parseFloat(parts[0])
  const denominator = parseFloat(parts[1])

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return parseFloat(fraction) || 0
  }

  return numerator / denominator
}
