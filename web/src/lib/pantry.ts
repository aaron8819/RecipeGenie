"use client"

export function normalizePantryItemName(item: string): string {
  return item.toLowerCase().trim()
}

export function parsePantryCandidates(rawInput: string): string[] {
  return rawInput
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
}

export function getPantryFailureInput(outcomes: { input: string; status: string }[]): string {
  return outcomes
    .filter((outcome) => outcome.status === "failure")
    .map((outcome) => outcome.input)
    .join(", ")
}
