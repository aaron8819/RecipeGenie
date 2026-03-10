import type { Recipe, RecipeInstructionGroup } from "@/types/database"

type RecipeWithStructure = Pick<Recipe, "instructions" | "notes" | "instruction_groups">

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

export function getRecipeNotes(recipe: RecipeWithStructure): string[] {
  const explicitNotes = normalizeRecipeNotes(recipe.notes)
  if (explicitNotes.length > 0) {
    return explicitNotes
  }

  return splitLegacyNotesFromInstructions(recipe.instructions ?? []).notes
}

export function getRecipeInstructionGroups(recipe: RecipeWithStructure): RecipeInstructionGroup[] {
  const explicitGroups = normalizeRecipeInstructionGroups(recipe.instruction_groups)
  if (explicitGroups.length > 0) {
    return explicitGroups
  }

  const { instructions } = splitLegacyNotesFromInstructions(recipe.instructions ?? [])
  return parseInstructionLines(instructions).instructionGroups
}

export function getFlatRecipeInstructions(recipe: RecipeWithStructure): string[] {
  return getRecipeInstructionGroups(recipe).flatMap((group) => group.steps)
}

export function buildInstructionEditorGroups(
  instructions: string[],
  instructionGroups?: RecipeInstructionGroup[] | null
): RecipeInstructionGroup[] {
  const normalizedGroups = normalizeRecipeInstructionGroups(instructionGroups)
  const legacyInstructions = splitLegacyNotesFromInstructions(instructions).instructions
  return (
    normalizedGroups.length > 0
      ? normalizedGroups
      : parseInstructionLines(legacyInstructions).instructionGroups
  )
}

export function buildInstructionEditorText(
  instructions: string[],
  instructionGroups?: RecipeInstructionGroup[] | null
): string {
  return buildInstructionEditorGroups(instructions, instructionGroups)
    .flatMap((group) => [
      ...(group.label ? [`${group.label}:`] : []),
      ...group.steps,
    ])
    .join("\n")
}

export function parseInstructionEditorText(text: string): {
  instructions: string[]
  instructionGroups?: RecipeInstructionGroup[]
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const parsed = parseInstructionLines(lines)
  return {
    instructions: parsed.instructions,
    instructionGroups: parsed.hasStructuralGrouping ? parsed.instructionGroups : undefined,
  }
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
