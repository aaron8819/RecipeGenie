import * as cheerio from 'cheerio';
import { parseIngredientLine } from './recipe-parser';
import {
  isValidYieldMetadata,
  parseYieldMetadata,
  rationalToNumber,
} from './recipe-quantity';
import { normalizeIngredients } from './recipe-data-validation';
import type { Ingredient, YieldMetadataV1 } from '@/types/database';

export interface ExtractedRecipe {
  name: string;
  ingredients: Ingredient[];
  instructions: string[];
  servings?: number;
  yieldMetadata?: YieldMetadataV1;
  imageUrl?: string;
  warnings: string[];
}

/**
 * Extract recipe data from HTML using Schema.org JSON-LD,
 * falling back to Open Graph meta tags for name/image.
 */
export function extractRecipeFromHtml(
  html: string
): ExtractedRecipe {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  // Try JSON-LD first
  const recipe = findJsonLdRecipe($);

  if (!recipe) {
    // Fall back to OG meta tags for basic info
    const ogName = $('meta[property="og:title"]')
      .attr('content');
    const ogImage = $('meta[property="og:image"]')
      .attr('content');

    if (ogName) {
      warnings.push(
        'No structured recipe data found — '
        + 'only page title and image extracted'
      );
      return {
        name: ogName,
        ingredients: [],
        instructions: [],
        imageUrl: ogImage || undefined,
        warnings,
      };
    }

    warnings.push(
      'No recipe data found on this page. '
      + 'Try pasting the recipe text instead.'
    );
    return {
      name: '',
      ingredients: [],
      instructions: [],
      warnings,
    };
  }

  // Extract name
  const name = typeof recipe.name === 'string'
    ? recipe.name.trim()
    : '';
  if (!name) warnings.push('No recipe name found');

  // Extract ingredients
  const ingredients = parseStructuredRecipeIngredients(
    recipe.recipeGenieData
  ) || parseRecipeIngredients(recipe.recipeIngredient);
  if (ingredients.length === 0) {
    warnings.push('No ingredients found');
  }

  // Extract instructions
  const instructions = parseRecipeInstructions(
    recipe.recipeInstructions
  );
  if (instructions.length === 0) {
    warnings.push('No instructions found');
  }

  // Extract servings
  const structuredYield =
    recipe.recipeGenieData &&
    typeof recipe.recipeGenieData === 'object' &&
    isValidYieldMetadata(recipe.recipeGenieData.yieldMetadata)
      ? recipe.recipeGenieData.yieldMetadata
      : undefined;
  const parsedYield = structuredYield
    ? {
        servings: Math.max(
          1,
          Math.round(rationalToNumber(structuredYield.scalingBasis) || 1)
        ),
        yieldMetadata: structuredYield,
      }
    : parseYield(recipe.recipeYield);
  if (recipe.recipeYield && !parsedYield.yieldMetadata) {
    warnings.push('Recipe yield was preserved for review because it could not be fully parsed');
  }

  // Extract image
  const imageUrl = parseImage(recipe.image);

  return {
    name,
    ingredients,
    instructions,
    servings: parsedYield.servings,
    yieldMetadata: parsedYield.yieldMetadata,
    imageUrl,
    warnings,
  };
}

/**
 * Find a Recipe object in JSON-LD script tags.
 * Handles both top-level and @graph-nested recipes.
 */
function findJsonLdRecipe(
  $: cheerio.CheerioAPI
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Record<string, any> | null {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const text = $(scripts[i]).html();
    if (!text) continue;

    try {
      const data = JSON.parse(text);
      const found = findRecipeInData(data);
      if (found) return found;
    } catch {
      // Malformed JSON-LD, skip
    }
  }
  return null;
}

/**
 * Recursively search for @type: "Recipe" in JSON-LD.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRecipeInData(data: any): Record<string, any> | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInData(item);
      if (found) return found;
    }
    return null;
  }

  if (typeof data === 'object') {
    // Check @type
    const type = data['@type'];
    if (
      type === 'Recipe' ||
      (Array.isArray(type) && type.includes('Recipe'))
    ) {
      return data;
    }

    // Check @graph
    if (data['@graph']) {
      return findRecipeInData(data['@graph']);
    }
  }

  return null;
}

/**
 * Parse recipeIngredient array into Ingredient[].
 */
function parseRecipeIngredients(
  raw: unknown
): Ingredient[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is string =>
      typeof item === 'string' && item.trim().length > 0
    )
    .map((text) => parseIngredientLine(text))
    .filter((ing) => ing.item.length > 0);
}

/**
 * Parse recipeInstructions — handles string[],
 * HowToStep[], and HowToSection[].
 */
function parseRecipeInstructions(
  raw: unknown
): string[] {
  if (!raw) return [];

  // Single string
  if (typeof raw === 'string') {
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  if (!Array.isArray(raw)) return [];

  const steps: string[] = [];

  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) steps.push(trimmed);
    } else if (item && typeof item === 'object') {
      // HowToStep
      if (item.text) {
        const text = typeof item.text === 'string'
          ? item.text.trim()
          : '';
        if (text) steps.push(text);
      }
      // HowToSection with itemListElement
      if (Array.isArray(item.itemListElement)) {
        for (const sub of item.itemListElement) {
          if (typeof sub === 'string') {
            const t = sub.trim();
            if (t) steps.push(t);
          } else if (sub?.text) {
            const t = typeof sub.text === 'string'
              ? sub.text.trim()
              : '';
            if (t) steps.push(t);
          }
        }
      }
    }
  }

  return steps;
}

/**
 * Parse recipeYield into a number.
 */
function parseYield(raw: unknown): {
  servings?: number;
  yieldMetadata?: YieldMetadataV1;
} {
  if (!raw) return {};

  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string' && typeof text !== 'number') {
    return {};
  }

  const authoredText =
    typeof text === 'number' ? `${text} servings` : String(text).trim();
  const yieldMetadata = parseYieldMetadata(authoredText);
  const basis = yieldMetadata
    ? rationalToNumber(yieldMetadata.scalingBasis)
    : null;
  return {
    servings:
      basis && Number.isFinite(basis) ? Math.max(1, Math.round(basis)) : undefined,
    yieldMetadata: yieldMetadata ?? undefined,
  };
}

function parseStructuredRecipeIngredients(
  raw: unknown
): Ingredient[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const ingredients = (raw as { ingredients?: unknown }).ingredients;
  return normalizeIngredients(ingredients, "persist");
}

/**
 * Parse image field — handles string, string[],
 * and ImageObject.
 */
function parseImage(raw: unknown): string | undefined {
  if (!raw) return undefined;

  if (typeof raw === 'string') return raw;

  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === 'string') return first;
    if (first?.url) return String(first.url);
    return undefined;
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.url === 'string') return obj.url;
  }

  return undefined;
}
