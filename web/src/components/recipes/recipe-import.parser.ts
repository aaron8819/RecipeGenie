import { parseRecipeText, type ParsedRecipe } from "@/lib/recipe-parser"
import type { ExtractedRecipe } from "@/lib/recipe-url-parser"

export const IMPORT_TEXT_REQUIRED_ERROR = "Please paste some recipe text to import"
export const IMPORT_TEXT_PARSE_ERROR =
  "Failed to parse recipe. Please check the format and try again."
export const IMPORT_URL_REQUIRED_ERROR = "Please enter a recipe URL"
export const IMPORT_URL_INVALID_ERROR = "Please enter a valid URL"
export const IMPORT_URL_FAILURE_ERROR = "Failed to import recipe from URL"

export function parseRecipeImportText(text: string): {
  parsedRecipe: ParsedRecipe | null
  error: string | null
} {
  if (!text.trim()) {
    return {
      parsedRecipe: null,
      error: IMPORT_TEXT_REQUIRED_ERROR,
    }
  }

  try {
    return {
      parsedRecipe: parseRecipeText(text),
      error: null,
    }
  } catch (error) {
    return {
      parsedRecipe: null,
      error: getImportErrorMessage(error, IMPORT_TEXT_PARSE_ERROR),
    }
  }
}

export function parseRecipeImportPreview(text: string): ParsedRecipe | null {
  if (!text.trim()) {
    return null
  }

  try {
    return parseRecipeText(text)
  } catch {
    return null
  }
}

export function validateRecipeImportUrl(url: string): {
  normalizedUrl: string | null
  error: string | null
} {
  const normalizedUrl = url.trim()

  if (!normalizedUrl) {
    return {
      normalizedUrl: null,
      error: IMPORT_URL_REQUIRED_ERROR,
    }
  }

  try {
    new URL(normalizedUrl)
    return {
      normalizedUrl,
      error: null,
    }
  } catch {
    return {
      normalizedUrl: null,
      error: IMPORT_URL_INVALID_ERROR,
    }
  }
}

export function toParsedRecipeImport(result: ExtractedRecipe): ParsedRecipe {
  return {
    name: result.name,
    ingredients: result.ingredients,
    instructions: result.instructions,
    servings: result.servings,
    warnings: result.warnings,
  }
}

export function getImportErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  return error instanceof Error ? error.message : fallbackMessage
}
