import * as cheerio from 'cheerio';
import { parseIngredientLine } from './recipe-parser';
import {
  isValidYieldMetadata,
  parseYieldMetadata,
  rationalToNumber,
} from './recipe-quantity';
import { normalizeIngredients } from './recipe-data-validation';
import {
  editorIngredientsToIngredientSections,
  validateRecipeStructure,
} from './recipe-structure';
import type {
  Ingredient,
  IngredientSection,
  InstructionSection,
  YieldMetadataV1,
} from '@/types/database';

export interface ExtractedRecipe {
  name: string;
  ingredientSections: IngredientSection[];
  instructionSections: InstructionSection[];
  servings?: number;
  yieldMetadata?: YieldMetadataV1;
  imageUrl?: string;
  warnings: string[];
}

type SupportedRecipeGenieData = {
  ingredientSections: IngredientSection[];
  instructionSections?: InstructionSection[];
  yieldMetadata?: YieldMetadataV1;
};

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
        ingredientSections: [],
        instructionSections: [],
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
      ingredientSections: [],
      instructionSections: [],
      warnings,
    };
  }

  // Extract name
  const name = typeof recipe.name === 'string'
    ? recipe.name.trim()
    : '';
  if (!name) warnings.push('No recipe name found');

  // Extract ingredients
  const recipeGenieData = supportedRecipeGenieData(recipe.recipeGenieData);
  if (recipe.recipeGenieData !== undefined && !recipeGenieData) {
    warnings.push(
      'Unsupported Recipe Genie extension ignored; standard recipe data used'
    );
  }
  const standardIngredients = parseRecipeIngredients(recipe.recipeIngredient);
  const ingredientSections = recipeGenieData?.ingredientSections
    || (standardIngredients.length > 0
      ? [{ label: null, ingredients: standardIngredients }]
      : []);
  if (ingredientSections.length === 0) {
    warnings.push('No ingredients found');
  }

  // Extract instructions
  const instructionSections = recipeGenieData?.instructionSections
    || parseRecipeInstructions(recipe.recipeInstructions);
  if (instructionSections.length === 0) {
    warnings.push('No instructions found');
  }

  // Extract servings
  const structuredYield = recipeGenieData?.yieldMetadata;
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
    ingredientSections,
    instructionSections,
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
): InstructionSection[] {
  if (!raw) return [];

  // Single string
  if (typeof raw === 'string') {
    const steps = raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return steps.length > 0 ? [{ label: null, steps }] : [];
  }

  if (!Array.isArray(raw)) return [];

  const sections: InstructionSection[] = [];
  let ungroupedSteps: string[] = [];
  const flushUngrouped = () => {
    if (ungroupedSteps.length > 0) {
      sections.push({ label: null, steps: ungroupedSteps });
      ungroupedSteps = [];
    }
  };

  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed) ungroupedSteps.push(trimmed);
    } else if (item && typeof item === 'object') {
      if (Array.isArray(item.itemListElement)) {
        flushUngrouped();
        const steps: string[] = [];
        for (const sub of item.itemListElement) {
          if (typeof sub === 'string') {
            const text = sub.trim();
            if (text) steps.push(text);
          } else if (sub?.text) {
            const text = typeof sub.text === 'string'
              ? sub.text.trim()
              : '';
            if (text) steps.push(text);
          }
        }
        if (steps.length > 0) {
          sections.push({
            label: typeof item.name === 'string' && item.name.trim()
              ? item.name.trim()
              : null,
            steps,
          });
        }
      } else if (item.text) {
        const text = typeof item.text === 'string'
          ? item.text.trim()
          : '';
        if (text) ungroupedSteps.push(text);
      }
    }
  }

  flushUngrouped();
  return sections;
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

function supportedRecipeGenieData(
  value: unknown
): SupportedRecipeGenieData | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.version === 2) {
    const structure = {
      ingredientSections: envelope.ingredientSections,
      instructionSections: envelope.instructionSections,
    };
    const validation = validateRecipeStructure(structure);
    if (
      !validation.valid ||
      (envelope.yieldMetadata !== null &&
        envelope.yieldMetadata !== undefined &&
        !isValidYieldMetadata(envelope.yieldMetadata))
    ) return null;
    return {
      ingredientSections: structure.ingredientSections as IngredientSection[],
      instructionSections: structure.instructionSections as InstructionSection[],
      ...(isValidYieldMetadata(envelope.yieldMetadata)
        ? { yieldMetadata: envelope.yieldMetadata }
        : {}),
    };
  }

  if (envelope.version !== 1) return null;
  if (!isValidYieldMetadata(envelope.yieldMetadata)) return null;
  const ingredients = normalizeIngredients(envelope.ingredients, 'persist');
  if (!ingredients) return null;

  // Version 1 is an atomic compatibility envelope. Unknown properties are
  // ignored for forward compatibility, but no supported field is consumed
  // unless every required version-1 field validates.
  return {
    ingredientSections: editorIngredientsToIngredientSections(ingredients),
    yieldMetadata: envelope.yieldMetadata,
  };
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
