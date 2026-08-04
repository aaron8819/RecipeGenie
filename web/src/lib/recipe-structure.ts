import type {
  CanonicalIngredient,
  Ingredient,
  IngredientSection,
  InstructionSection,
  RecipeContent,
  RecipeInstructionGroup,
} from "@/types/database"
import {
  RECIPE_DATA_LIMITS,
  normalizeIngredient,
} from "@/lib/recipe-data-validation"

const CANONICAL_INGREDIENT_KEYS = new Set([
  "item",
  "amount",
  "unit",
  "quantityV1",
  "authoredUnit",
  "packageV1",
  "shoppingCategory",
  "modifier",
  "alternatives",
  "originalText",
])
const LEGACY_INGREDIENT_KEYS = new Set([
  ...CANONICAL_INGREDIENT_KEYS,
  "groupLabel",
])

type RecipeStructureField =
  | "ingredientSections"
  | "instructionSections"
  | "ingredients"
  | "ingredientGroups"
  | "instructions"
  | "instructionGroups"
  | "notes"

export type RecipeStructureValidationIssue = {
  field: RecipeStructureField
  code:
    | "invalid-top-level"
    | "too-many-sections"
    | "invalid-section"
    | "invalid-label"
    | "empty-section"
    | "too-many-items"
    | "invalid-ingredient"
    | "invalid-step"
}

export type RecipeStructureValidationResult =
  | { valid: true }
  | { valid: false; issue: RecipeStructureValidationIssue }

export type LegacyRecipeStructureInput = {
  ingredients?: unknown
  ingredientGroups?: unknown
  instructions?: unknown
  instructionGroups?: unknown
  notes?: unknown
}

export type IngredientConversionClassification =
  | "empty"
  | "flat-only"
  | "grouped-only"
  | "equivalent-dual"
  | "conflicting-dual"

export type InstructionConversionClassification =
  | "empty"
  | "flat-only"
  | "grouped-only"
  | "equivalent-dual"
  | "conflicting-dual"

export type RecipeStructureConversionEvidence = {
  ingredients: IngredientConversionClassification
  instructions: InstructionConversionClassification
  notes: "empty" | "explicit" | "legacy-tail"
}

export type RecipeStructureConversionResult =
  | {
      status: "success" | "equivalent"
      content: RecipeContent
      evidence: RecipeStructureConversionEvidence
    }
  | {
      status: "conflict"
      conflicts: Array<{
        field: "ingredients" | "instructions"
        precedence: "none" | "grouped"
      }>
      evidence: RecipeStructureConversionEvidence
    }
  | {
      status: "malformed"
      issue: RecipeStructureValidationIssue
    }

type NormalizedRepresentation<T> =
  | { state: "absent" }
  | { state: "present"; value: T }
  | { state: "malformed"; issue: RecipeStructureValidationIssue }

export function validateRecipeStructure(
  value: unknown
): RecipeStructureValidationResult {
  if (!isRecord(value)) {
    return invalid("ingredientSections", "invalid-top-level")
  }

  const ingredientResult = validateIngredientSections(value.ingredientSections)
  if (!ingredientResult.valid) return ingredientResult

  return validateInstructionSections(value.instructionSections)
}

export function convertLegacyRecipeStructure(
  input: LegacyRecipeStructureInput
): RecipeStructureConversionResult {
  const flatIngredients = normalizeLegacyFlatIngredients(input.ingredients)
  if (flatIngredients.state === "malformed") {
    return { status: "malformed", issue: flatIngredients.issue }
  }
  const groupedIngredients = normalizeLegacyIngredientGroups(
    input.ingredientGroups
  )
  if (groupedIngredients.state === "malformed") {
    return { status: "malformed", issue: groupedIngredients.issue }
  }
  if (flatIngredients.state === "absent" && groupedIngredients.state === "absent") {
    return {
      status: "malformed",
      issue: { field: "ingredients", code: "invalid-top-level" },
    }
  }

  const notesResult = normalizeLegacyNotes(input.notes)
  if (notesResult.state === "malformed") {
    return { status: "malformed", issue: notesResult.issue }
  }

  const flatInstructions = normalizeLegacyFlatInstructions(input.instructions)
  if (flatInstructions.state === "malformed") {
    return { status: "malformed", issue: flatInstructions.issue }
  }
  const groupedInstructions = normalizeLegacyInstructionGroups(
    input.instructionGroups
  )
  if (groupedInstructions.state === "malformed") {
    return { status: "malformed", issue: groupedInstructions.issue }
  }
  if (flatInstructions.state === "absent" && groupedInstructions.state === "absent") {
    return {
      status: "malformed",
      issue: { field: "instructions", code: "invalid-top-level" },
    }
  }

  const explicitNotes = notesResult.value
  const splitInstructions = splitLegacyNotesFromInstructions(
    flatInstructions.state === "present" ? flatInstructions.value : []
  )
  const notes =
    explicitNotes.length > 0 ? explicitNotes : splitInstructions.notes
  const notesEvidence =
    explicitNotes.length > 0
      ? "explicit"
      : notes.length > 0
        ? "legacy-tail"
        : "empty"

  const flatIngredientSections =
    flatIngredients.state === "present"
      ? buildIngredientSectionsFromConsecutiveRuns(flatIngredients.value)
      : null
  const explicitIngredientSections =
    groupedIngredients.state === "present" ? groupedIngredients.value : null
  const ingredientChoice = chooseIngredientSections(
    flatIngredientSections,
    explicitIngredientSections
  )

  const parsedFlatInstructionSections =
    flatInstructions.state === "present"
      ? parseInstructionLines(splitInstructions.instructions).instructionGroups.map(
          toInstructionSection
        )
      : null
  const explicitInstructionSections =
    groupedInstructions.state === "present" ? groupedInstructions.value : null
  const instructionChoice = chooseInstructionSections(
    parsedFlatInstructionSections,
    explicitInstructionSections
  )

  const evidence: RecipeStructureConversionEvidence = {
    ingredients: ingredientChoice.classification,
    instructions: instructionChoice.classification,
    notes: notesEvidence,
  }
  const conflicts: Array<{
    field: "ingredients" | "instructions"
    precedence: "none" | "grouped"
  }> = []
  if (ingredientChoice.classification === "conflicting-dual") {
    conflicts.push({ field: "ingredients", precedence: "none" })
  }
  if (instructionChoice.classification === "conflicting-dual") {
    conflicts.push({ field: "instructions", precedence: "grouped" })
  }
  if (conflicts.length > 0) {
    return { status: "conflict", conflicts, evidence }
  }

  const content: RecipeContent = {
    ingredientSections: ingredientChoice.sections,
    instructionSections: instructionChoice.sections,
    notes,
  }
  const validation = validateRecipeStructure(content)
  if (!validation.valid) {
    return { status: "malformed", issue: validation.issue }
  }

  return {
    status:
      evidence.ingredients === "equivalent-dual" ||
      evidence.instructions === "equivalent-dual"
        ? "equivalent"
        : "success",
    content,
    evidence,
  }
}

export function flattenRecipeIngredients(
  sections: IngredientSection[]
): CanonicalIngredient[] {
  return sections.flatMap((section) => section.ingredients.map(cloneIngredient))
}

export function flattenRecipeInstructions(
  sections: InstructionSection[]
): string[] {
  return sections.flatMap((section) => [...section.steps])
}

function validateIngredientSections(
  value: unknown
): RecipeStructureValidationResult {
  if (!Array.isArray(value)) {
    return invalid("ingredientSections", "invalid-top-level")
  }
  if (value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe) {
    return invalid("ingredientSections", "too-many-sections")
  }

  let ingredientCount = 0
  for (const section of value) {
    if (
      !isRecord(section) ||
      !hasExactKeys(section, ["label", "ingredients"])
    ) {
      return invalid("ingredientSections", "invalid-section")
    }
    if (!isCanonicalLabel(section.label)) {
      return invalid("ingredientSections", "invalid-label")
    }
    if (!Array.isArray(section.ingredients)) {
      return invalid("ingredientSections", "invalid-section")
    }
    if (section.ingredients.length === 0) {
      return invalid("ingredientSections", "empty-section")
    }

    ingredientCount += section.ingredients.length
    if (ingredientCount > RECIPE_DATA_LIMITS.ingredientsPerRecipe) {
      return invalid("ingredientSections", "too-many-items")
    }

    for (const ingredient of section.ingredients) {
      if (
        !isRecord(ingredient) ||
        Object.keys(ingredient).some(
          (key) => !CANONICAL_INGREDIENT_KEYS.has(key)
        ) ||
        !normalizeIngredient(ingredient, "persist")
      ) {
        return invalid("ingredientSections", "invalid-ingredient")
      }
    }
  }

  return { valid: true }
}

function validateInstructionSections(
  value: unknown
): RecipeStructureValidationResult {
  if (!Array.isArray(value)) {
    return invalid("instructionSections", "invalid-top-level")
  }
  if (value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe) {
    return invalid("instructionSections", "too-many-sections")
  }

  let stepCount = 0
  for (const section of value) {
    if (!isRecord(section) || !hasExactKeys(section, ["label", "steps"])) {
      return invalid("instructionSections", "invalid-section")
    }
    if (!isCanonicalLabel(section.label)) {
      return invalid("instructionSections", "invalid-label")
    }
    if (!Array.isArray(section.steps)) {
      return invalid("instructionSections", "invalid-section")
    }
    if (section.steps.length === 0) {
      return invalid("instructionSections", "empty-section")
    }

    stepCount += section.steps.length
    if (stepCount > RECIPE_DATA_LIMITS.instructionsPerRecipe) {
      return invalid("instructionSections", "too-many-items")
    }

    for (const step of section.steps) {
      if (
        typeof step !== "string" ||
        step !== step.trim() ||
        step.length === 0 ||
        step.length > RECIPE_DATA_LIMITS.instructionLength
      ) {
        return invalid("instructionSections", "invalid-step")
      }
    }
  }

  return { valid: true }
}

function normalizeLegacyFlatIngredients(
  value: unknown
): NormalizedRepresentation<Ingredient[]> {
  if (value === undefined) return { state: "absent" }
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.ingredientsPerRecipe
  ) {
    return malformed("ingredients", "invalid-top-level")
  }

  const ingredients: Ingredient[] = []
  for (const ingredient of value) {
    const normalized = normalizeLegacyIngredient(ingredient)
    if (!normalized) {
      return malformed("ingredients", "invalid-ingredient")
    }
    ingredients.push(normalized)
  }
  return { state: "present", value: ingredients }
}

function normalizeLegacyIngredientGroups(
  value: unknown
): NormalizedRepresentation<IngredientSection[]> {
  if (value === undefined || value === null) return { state: "absent" }
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe
  ) {
    return malformed("ingredientGroups", "invalid-top-level")
  }

  const sections: IngredientSection[] = []
  let ingredientCount = 0
  for (const group of value) {
    if (!isRecord(group) || !hasExactKeys(group, ["ingredients"], ["label"])) {
      return malformed("ingredientGroups", "invalid-section")
    }
    const label = normalizeLegacyLabel(group.label)
    if (label === undefined) {
      return malformed("ingredientGroups", "invalid-label")
    }
    if (!Array.isArray(group.ingredients)) {
      return malformed("ingredientGroups", "invalid-section")
    }

    ingredientCount += group.ingredients.length
    if (ingredientCount > RECIPE_DATA_LIMITS.ingredientsPerRecipe) {
      return malformed("ingredientGroups", "too-many-items")
    }

    const ingredients: CanonicalIngredient[] = []
    for (const ingredient of group.ingredients) {
      const normalized = normalizeLegacyIngredient(ingredient)
      if (!normalized) {
        return malformed("ingredientGroups", "invalid-ingredient")
      }
      ingredients.push(stripIngredientGroupLabel(normalized))
    }
    if (ingredients.length > 0) {
      sections.push({ label, ingredients })
    }
  }

  return { state: "present", value: sections }
}

function normalizeLegacyFlatInstructions(
  value: unknown
): NormalizedRepresentation<string[]> {
  if (value === undefined) return { state: "absent" }
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.instructionsPerRecipe
  ) {
    return malformed("instructions", "invalid-top-level")
  }

  const instructions: string[] = []
  for (const instruction of value) {
    if (
      typeof instruction !== "string" ||
      instruction.length > RECIPE_DATA_LIMITS.instructionLength
    ) {
      return malformed("instructions", "invalid-step")
    }
    const trimmed = instruction.trim()
    if (trimmed) instructions.push(trimmed)
  }
  return { state: "present", value: instructions }
}

function normalizeLegacyInstructionGroups(
  value: unknown
): NormalizedRepresentation<InstructionSection[]> {
  if (value === undefined || value === null) return { state: "absent" }
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.instructionGroupsPerRecipe
  ) {
    return malformed("instructionGroups", "invalid-top-level")
  }

  const sections: InstructionSection[] = []
  let stepCount = 0
  for (const group of value) {
    if (!isRecord(group) || !hasExactKeys(group, ["steps"], ["label"])) {
      return malformed("instructionGroups", "invalid-section")
    }
    const label = normalizeLegacyLabel(group.label)
    if (label === undefined) {
      return malformed("instructionGroups", "invalid-label")
    }
    if (!Array.isArray(group.steps)) {
      return malformed("instructionGroups", "invalid-section")
    }

    const steps: string[] = []
    for (const step of group.steps) {
      if (
        typeof step !== "string" ||
        step.length > RECIPE_DATA_LIMITS.instructionLength
      ) {
        return malformed("instructionGroups", "invalid-step")
      }
      const trimmed = step.trim()
      if (trimmed) steps.push(trimmed)
    }
    stepCount += steps.length
    if (stepCount > RECIPE_DATA_LIMITS.instructionsPerRecipe) {
      return malformed("instructionGroups", "too-many-items")
    }
    if (steps.length > 0) sections.push({ label, steps })
  }

  return { state: "present", value: sections }
}

function normalizeLegacyNotes(
  value: unknown
): Extract<NormalizedRepresentation<string[]>, { state: "present" | "malformed" }> {
  if (value === undefined || value === null) {
    return { state: "present", value: [] }
  }
  if (
    !Array.isArray(value) ||
    value.length > RECIPE_DATA_LIMITS.instructionsPerRecipe
  ) {
    return malformed("notes", "invalid-top-level")
  }

  const notes: string[] = []
  for (const note of value) {
    if (
      typeof note !== "string" ||
      note.length > RECIPE_DATA_LIMITS.instructionLength ||
      note.trim().length === 0
    ) {
      return malformed("notes", "invalid-step")
    }
    notes.push(note.trim())
  }
  return { state: "present", value: notes }
}

function buildIngredientSectionsFromConsecutiveRuns(
  ingredients: Ingredient[]
): IngredientSection[] {
  const sections: IngredientSection[] = []
  for (const ingredient of ingredients) {
    const label = normalizeLegacyLabel(ingredient.groupLabel)
    if (label === undefined) {
      throw new Error("validated ingredient label became invalid")
    }
    const current = sections[sections.length - 1]
    if (!current || current.label !== label) {
      sections.push({
        label,
        ingredients: [stripIngredientGroupLabel(ingredient)],
      })
      continue
    }
    current.ingredients.push(stripIngredientGroupLabel(ingredient))
  }
  return sections
}

function chooseIngredientSections(
  flat: IngredientSection[] | null,
  grouped: IngredientSection[] | null
): {
  sections: IngredientSection[]
  classification: IngredientConversionClassification
} {
  if (flat && grouped) {
    if (ingredientSectionsMatchLegacyFlatForm(flat, grouped)) {
      return {
        sections: grouped,
        classification:
          flat.length === 0 ? "empty" : "equivalent-dual",
      }
    }
    return { sections: [], classification: "conflicting-dual" }
  }
  const sections = grouped ?? flat ?? []
  if (sections.length === 0) return { sections, classification: "empty" }
  return {
    sections,
    classification: grouped ? "grouped-only" : "flat-only",
  }
}

function ingredientSectionsMatchLegacyFlatForm(
  flat: IngredientSection[],
  grouped: IngredientSection[]
): boolean {
  const flattenWithLabels = (sections: IngredientSection[]) =>
    sections.flatMap((section) =>
      section.ingredients.map((ingredient) => [section.label, ingredient])
    )

  return structuresEqual(flattenWithLabels(flat), flattenWithLabels(grouped))
}

function chooseInstructionSections(
  flat: InstructionSection[] | null,
  grouped: InstructionSection[] | null
): {
  sections: InstructionSection[]
  classification: InstructionConversionClassification
} {
  if (grouped && grouped.length === 0) grouped = null
  if (flat && flat.length === 0 && grouped) {
    return { sections: grouped, classification: "grouped-only" }
  }
  if (flat && grouped) {
    if (
      structuresEqual(
        flattenRecipeInstructions(flat),
        flattenRecipeInstructions(grouped)
      )
    ) {
      return { sections: grouped, classification: "equivalent-dual" }
    }
    return { sections: [], classification: "conflicting-dual" }
  }
  const sections = grouped ?? flat ?? []
  if (sections.length === 0) return { sections, classification: "empty" }
  return {
    sections,
    classification: grouped ? "grouped-only" : "flat-only",
  }
}

function toInstructionSection(group: RecipeInstructionGroup): InstructionSection {
  return {
    label: group.label?.trim() || null,
    steps: [...group.steps],
  }
}

function stripIngredientGroupLabel(ingredient: Ingredient): CanonicalIngredient {
  const { groupLabel: _groupLabel, ...canonical } = ingredient
  return canonical
}

function normalizeLegacyIngredient(value: unknown): Ingredient | null {
  if (
    isRecord(value) &&
    Object.keys(value).some((key) => !LEGACY_INGREDIENT_KEYS.has(key))
  ) {
    return null
  }
  if (
    isRecord(value) &&
    typeof value.groupLabel === "string" &&
    value.groupLabel.trim().length === 0
  ) {
    const { groupLabel: _groupLabel, ...withoutBlankLabel } = value
    return normalizeIngredient(withoutBlankLabel, "persist")
  }
  return normalizeIngredient(value, "persist")
}

function cloneIngredient(
  ingredient: CanonicalIngredient
): CanonicalIngredient {
  return {
    ...ingredient,
    ...(ingredient.alternatives
      ? { alternatives: [...ingredient.alternatives] }
      : {}),
  }
}

function normalizeLegacyLabel(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") return undefined
  const label = value.trim()
  if (!label) return null
  return label.length <= RECIPE_DATA_LIMITS.groupLabelLength
    ? label
    : undefined
}

function isCanonicalLabel(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= RECIPE_DATA_LIMITS.groupLabelLength)
  )
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = []
): boolean {
  const keys = Object.keys(value)
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function structuresEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function invalid(
  field: RecipeStructureField,
  code: RecipeStructureValidationIssue["code"]
): RecipeStructureValidationResult {
  return { valid: false, issue: { field, code } }
}

function malformed<T>(
  field: RecipeStructureField,
  code: RecipeStructureValidationIssue["code"]
): NormalizedRepresentation<T> & { state: "malformed" } {
  return { state: "malformed", issue: { field, code } }
}

export interface RecipeIngredientGroup {
  label?: string
  ingredients: Ingredient[]
}

export function createEmptyInstructionGroup(): RecipeInstructionGroup {
  return {
    steps: [""],
  }
}

export function normalizeRecipeNotes(notes?: string[] | null): string[] {
  return (notes ?? []).map((note) => note.trim()).filter(Boolean)
}

export function normalizeRecipeInstructionGroups(
  groups?: RecipeInstructionGroup[] | null
): RecipeInstructionGroup[] {
  return (groups ?? [])
    .map((group) => ({
      label: group.label?.trim() || undefined,
      steps: group.steps.map((step) => step.trim()).filter(Boolean),
    }))
    .filter((group) => group.steps.length > 0)
}

export function ingredientSectionsToEditorIngredients(
  sections: IngredientSection[]
): Ingredient[] {
  return sections.flatMap((section) =>
    section.ingredients.map((ingredient) => ({
      ...cloneIngredient(ingredient),
      ...(section.label ? { groupLabel: section.label } : {}),
    }))
  )
}

export function editorIngredientsToIngredientSections(
  ingredients: Ingredient[]
): IngredientSection[] {
  return buildIngredientSectionsFromConsecutiveRuns(ingredients)
}

export function instructionSectionsToEditorGroups(
  sections: InstructionSection[]
): RecipeInstructionGroup[] {
  return sections.map((section) => ({
    ...(section.label ? { label: section.label } : {}),
    steps: [...section.steps],
  }))
}

export function editorGroupsToInstructionSections(
  groups: RecipeInstructionGroup[]
): InstructionSection[] {
  return normalizeRecipeInstructionGroups(groups).map(toInstructionSection)
}

export function normalizeInstructionGroupsForEditor(
  groups?: RecipeInstructionGroup[] | null
): RecipeInstructionGroup[] {
  const normalizedGroups = (groups ?? []).map((group) => ({
    label: group.label?.trim() || "",
    steps: (group.steps ?? []).map((step) => step ?? ""),
  }))

  if (normalizedGroups.length === 0) {
    return [createEmptyInstructionGroup()]
  }

  return normalizedGroups.map((group) => ({
    label: group.label,
    steps: group.steps.length > 0 ? group.steps : [""],
  }))
}

export function formatRecipeTime(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) {
    return null
  }

  if (minutes < 60) {
    return `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (remainder === 0) {
    return `${hours} hr`
  }

  return `${hours} hr ${remainder} min`
}

export function isInstructionSectionLabel(step: string): boolean {
  const trimmed = step.trim()
  if (!trimmed.endsWith(":")) {
    return false
  }

  if (normalizeHeaderLabel(trimmed) === "notes") {
    return true
  }

  const words = trimmed.replace(/:\s*$/, "").split(/\s+/).filter(Boolean)
  return words.length > 0 && words.length <= 6 && !/[.!?(),\d]/.test(trimmed)
}

function splitLegacyNotesFromInstructions(instructions: string[]): {
  instructions: string[]
  notes: string[]
} {
  const notesHeaderIndex = instructions.findIndex(
    (line) => normalizeHeaderLabel(line) === "notes"
  )

  if (notesHeaderIndex < 0 || notesHeaderIndex === instructions.length - 1) {
    return {
      instructions,
      notes: [],
    }
  }

  return {
    instructions: instructions.slice(0, notesHeaderIndex),
    notes: instructions.slice(notesHeaderIndex + 1).map((line) => line.trim()).filter(Boolean),
  }
}

function parseInstructionLines(lines: string[]): {
  instructions: string[]
  instructionGroups: RecipeInstructionGroup[]
  hasStructuralGrouping: boolean
} {
  const groups: RecipeInstructionGroup[] = []
  let currentGroup: RecipeInstructionGroup = { steps: [] }

  const pushCurrentGroup = () => {
    if (currentGroup.steps.length === 0) {
      return
    }

    groups.push(currentGroup)
  }

  for (const line of lines) {
    if (isInstructionSectionLabel(line)) {
      pushCurrentGroup()
      currentGroup = {
        label: line.replace(/:\s*$/, "").trim(),
        steps: [],
      }
      continue
    }

    currentGroup.steps.push(stripInstructionMarker(line))
  }

  pushCurrentGroup()

  const normalizedGroups = normalizeRecipeInstructionGroups(groups)
  return {
    instructions: normalizedGroups.flatMap((group) => group.steps),
    instructionGroups: normalizedGroups,
    hasStructuralGrouping:
      normalizedGroups.length > 1 || normalizedGroups.some((group) => !!group.label),
  }
}

function stripInstructionMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[\.\)]|[-*\u2022])\s+/, "").trim()
}

function normalizeHeaderLabel(line: string): string {
  return line.toLowerCase().replace(/[:\-\u2013\u2014]+$/, "").trim()
}
