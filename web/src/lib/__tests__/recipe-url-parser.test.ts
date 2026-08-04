import { describe, it, expect } from 'vitest';
import { extractRecipeFromHtml } from '../recipe-url-parser';

type ExtractedRecipe = NonNullable<ReturnType<typeof extractRecipeFromHtml>>;
const flatIngredients = (result: ExtractedRecipe) =>
  result.ingredientSections.flatMap((section) => section.ingredients);
const flatInstructions = (result: ExtractedRecipe) =>
  result.instructionSections.flatMap((section) => section.steps);

const BASIC_JSONLD = `
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Classic Pancakes",
  "recipeIngredient": [
    "2 cups all-purpose flour",
    "1 tbsp sugar",
    "2 eggs",
    "1.5 cups milk"
  ],
  "recipeInstructions": [
    { "@type": "HowToStep", "text": "Mix dry ingredients." },
    { "@type": "HowToStep", "text": "Add wet ingredients." },
    { "@type": "HowToStep", "text": "Cook on griddle." }
  ],
  "recipeYield": "12 pancakes",
  "image": "https://example.com/pancakes.jpg"
}
</script>
</head>
<body></body>
</html>`;

const GRAPH_JSONLD = `
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "name": "My Blog" },
    {
      "@type": "Recipe",
      "name": "Graph Tacos",
      "recipeIngredient": ["1 lb beef", "8 tortillas"],
      "recipeInstructions": "Cook beef.\\nFill tortillas.",
      "recipeYield": "4 servings"
    }
  ]
}
</script>
</head>
<body></body>
</html>`;

const OG_ONLY = `
<html>
<head>
  <meta property="og:title" content="My Awesome Recipe" />
  <meta property="og:image" content="https://example.com/img.jpg" />
</head>
<body></body>
</html>`;

const EMPTY_HTML = `<html><head></head><body></body></html>`;

const HOWTOSECTION_JSONLD = `
<html>
<head>
<script type="application/ld+json">
{
  "@type": "Recipe",
  "name": "Sectioned Recipe",
  "recipeIngredient": ["1 cup rice"],
  "recipeInstructions": [
    {
      "@type": "HowToSection",
      "name": "Prep",
      "itemListElement": [
        { "@type": "HowToStep", "text": "Wash rice." },
        { "@type": "HowToStep", "text": "Soak 30 min." }
      ]
    },
    {
      "@type": "HowToSection",
      "name": "Cook",
      "itemListElement": [
        { "@type": "HowToStep", "text": "Boil water." }
      ]
    }
  ]
}
</script>
</head>
<body></body>
</html>`;

const IMAGE_OBJECT_JSONLD = `
<html>
<head>
<script type="application/ld+json">
{
  "@type": "Recipe",
  "name": "Image Test",
  "recipeIngredient": ["1 egg"],
  "recipeInstructions": ["Cook it."],
  "image": {
    "@type": "ImageObject",
    "url": "https://example.com/photo.jpg"
  }
}
</script>
</head>
<body></body>
</html>`;

describe('extractRecipeFromHtml', () => {
  it('should extract basic JSON-LD recipe', () => {
    const result = extractRecipeFromHtml(BASIC_JSONLD);
    expect(result.name).toBe('Classic Pancakes');
    expect(flatIngredients(result)).toHaveLength(4);
    expect(flatIngredients(result)[0].item).toBe('all-purpose flour');
    expect(flatIngredients(result)[0].amount).toBe(2);
    expect(flatIngredients(result)[0].originalText)
      .toBe('2 cups all-purpose flour');
    expect(flatIngredients(result)[2]).toMatchObject({
      item: 'eggs',
      amount: 2,
      unit: 'count',
    });
    expect(flatInstructions(result)).toHaveLength(3);
    expect(flatInstructions(result)[0])
      .toBe('Mix dry ingredients.');
    expect(result.servings).toBe(12);
    expect(result.imageUrl)
      .toBe('https://example.com/pancakes.jpg');
    expect(result.warnings).toHaveLength(0);
  });

  it('should handle @graph-nested recipe', () => {
    const result = extractRecipeFromHtml(GRAPH_JSONLD);
    expect(result.name).toBe('Graph Tacos');
    expect(flatIngredients(result)).toHaveLength(2);
    expect(flatIngredients(result)[1]).toMatchObject({
      item: 'tortillas',
      amount: 8,
      unit: 'count',
    });
    expect(flatInstructions(result)).toHaveLength(2);
    expect(result.servings).toBe(4);
  });

  it('should fall back to OG meta tags', () => {
    const result = extractRecipeFromHtml(OG_ONLY);
    expect(result.name).toBe('My Awesome Recipe');
    expect(result.imageUrl)
      .toBe('https://example.com/img.jpg');
    expect(flatIngredients(result)).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should return warnings for empty HTML', () => {
    const result = extractRecipeFromHtml(EMPTY_HTML);
    expect(result.name).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should handle HowToSection instructions', () => {
    const result =
      extractRecipeFromHtml(HOWTOSECTION_JSONLD);
    expect(result.name).toBe('Sectioned Recipe');
    expect(flatInstructions(result)).toEqual([
      'Wash rice.',
      'Soak 30 min.',
      'Boil water.',
    ]);
  });

  it('should handle ImageObject', () => {
    const result =
      extractRecipeFromHtml(IMAGE_OBJECT_JSONLD);
    expect(result.imageUrl)
      .toBe('https://example.com/photo.jpg');
  });

  it('should handle image as string array', () => {
    const html = `
<html><head>
<script type="application/ld+json">
{
  "@type": "Recipe",
  "name": "Test",
  "recipeIngredient": ["1 egg"],
  "recipeInstructions": ["Cook."],
  "image": ["https://example.com/a.jpg", "https://example.com/b.jpg"]
}
</script>
</head><body></body></html>`;
    const result = extractRecipeFromHtml(html);
    expect(result.imageUrl)
      .toBe('https://example.com/a.jpg');
  });

  it.each([
    ['unsupported', 99],
    ['missing', undefined],
    ['string', '1'],
    ['null', null],
    ['array', [1]],
    ['boolean', true],
    ['object', { major: 1 }],
    ['negative', -1],
    ['oversized', 999999999999999],
  ])('ignores %s Recipe Genie extension versions', (_label, version) => {
    const extension = JSON.stringify({
      ...(version === undefined ? {} : { version }),
      ingredients: [
        {
          item: 'poisoned structured value',
          amount: 9,
          unit: 'cup',
        },
      ],
      yieldMetadata: {
        version: 1,
        authoredText: '99 servings',
        kind: 'servings',
        scalingBasis: { numerator: '99', denominator: '1' },
        value: { numerator: '99', denominator: '1' },
      },
    });
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Fallback Recipe',
      recipeIngredient: ['1 cup flour'],
      recipeYield: '4 servings',
      recipeInstructions: ['Mix.'],
      recipeGenieData: JSON.parse(extension),
    })}</script>`;

    const result = extractRecipeFromHtml(html);

    expect(flatIngredients(result)[0]).toMatchObject({
      item: 'flour',
      amount: 1,
      unit: 'cup',
    });
    expect(result.servings).toBe(4);
    expect(result.warnings).toContain(
      'Unsupported Recipe Genie extension ignored; standard recipe data used'
    );
  });

  it('consumes supported Recipe Genie extension version 1 atomically', () => {
    const structured = {
      version: 1,
      ingredients: [
        {
          item: 'sugar',
          amount: 0.5,
          unit: 'cup',
          authoredUnit: 'cup',
          quantityV1: {
            version: 1,
            kind: 'exact',
            authored: '0.50',
            source: 'authored',
            value: { numerator: '1', denominator: '2' },
            lexeme: '0.50',
          },
        },
      ],
      yieldMetadata: {
        version: 1,
        authoredText: '4 servings',
        kind: 'servings',
        scalingBasis: { numerator: '4', denominator: '1' },
        value: { numerator: '4', denominator: '1' },
      },
    };
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Structured Recipe',
      recipeIngredient: ['9 cups fallback'],
      recipeYield: '9 servings',
      recipeInstructions: ['Mix.'],
      recipeGenieData: structured,
    })}</script>`;

    const result = extractRecipeFromHtml(html);

    expect(flatIngredients(result)[0].quantityV1).toMatchObject({
      authored: '0.50',
      value: { numerator: '1', denominator: '2' },
    });
    expect(result.servings).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  it('consumes canonical Recipe Genie extension version 2 without yield metadata', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Sectioned Recipe',
      recipeIngredient: ['9 cups fallback'],
      recipeInstructions: ['Fallback.'],
      recipeGenieData: {
        version: 2,
        ingredientSections: [{
          label: 'Sauce',
          ingredients: [{ item: 'butter', amount: 1, unit: 'tbsp' }],
        }],
        instructionSections: [{ label: 'Finish', steps: ['Whisk.'] }],
        yieldMetadata: null,
      },
    })}</script>`;

    const result = extractRecipeFromHtml(html);

    expect(result.ingredientSections).toEqual([{
      label: 'Sauce',
      ingredients: [{ item: 'butter', amount: 1, unit: 'tbsp' }],
    }]);
    expect(result.instructionSections).toEqual([
      { label: 'Finish', steps: ['Whisk.'] },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    [
      'valid ingredients with malformed yield',
      {
        ingredients: [{
          item: 'structured sugar',
          amount: 1,
          unit: 'cup',
        }],
        yieldMetadata: { version: 1 },
      },
    ],
    [
      'malformed ingredients with valid yield',
      {
        ingredients: [{ item: 'structured sugar', amount: {}, unit: 'cup' }],
        yieldMetadata: {
          version: 1,
          authoredText: '8 servings',
          kind: 'servings',
          scalingBasis: { numerator: '8', denominator: '1' },
          value: { numerator: '8', denominator: '1' },
        },
      },
    ],
    [
      'malformed nested package metadata',
      {
        ingredients: [{
          item: 'structured tomatoes',
          amount: 1,
          unit: 'can',
          quantityV1: {
            version: 1,
            kind: 'exact',
            authored: '1',
            source: 'authored',
            value: { numerator: '1', denominator: '1' },
            lexeme: '1',
          },
          packageV1: { version: 1, size: {} },
        }],
        yieldMetadata: {
          version: 1,
          authoredText: '8 servings',
          kind: 'servings',
          scalingBasis: { numerator: '8', denominator: '1' },
          value: { numerator: '8', denominator: '1' },
        },
      },
    ],
    [
      'missing ingredients',
      {
        yieldMetadata: {
          version: 1,
          authoredText: '8 servings',
          kind: 'servings',
          scalingBasis: { numerator: '8', denominator: '1' },
          value: { numerator: '8', denominator: '1' },
        },
      },
    ],
    [
      'missing yield',
      {
        ingredients: [{
          item: 'structured sugar',
          amount: 1,
          unit: 'cup',
        }],
      },
    ],
  ])('rejects version 1 atomically for %s', (_label, extension) => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Fallback Recipe',
      recipeIngredient: ['1 cup fallback flour'],
      recipeYield: '4 servings',
      recipeInstructions: ['Mix.'],
      recipeGenieData: { version: 1, ...extension },
    })}</script>`;

    const result = extractRecipeFromHtml(html);

    expect(flatIngredients(result)).toHaveLength(1);
    expect(flatIngredients(result)[0]).toMatchObject({
      item: 'fallback flour',
      amount: 1,
      unit: 'cup',
    });
    expect(result.servings).toBe(4);
    expect(result.yieldMetadata?.authoredText).toBe('4 servings');
    expect(result.warnings).toContain(
      'Unsupported Recipe Genie extension ignored; standard recipe data used'
    );
  });

  it('allows extra version-1 properties without weakening atomic validation', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Recipe',
      name: 'Extended Recipe',
      recipeIngredient: ['9 cups fallback'],
      recipeYield: '9 servings',
      recipeInstructions: ['Mix.'],
      recipeGenieData: {
        version: 1,
        ingredients: [{ item: 'sugar', amount: 1, unit: 'cup' }],
        yieldMetadata: {
          version: 1,
          authoredText: '4 servings',
          kind: 'servings',
          scalingBasis: { numerator: '4', denominator: '1' },
          value: { numerator: '4', denominator: '1' },
        },
        futureMetadata: { ignored: true },
      },
    })}</script>`;

    const result = extractRecipeFromHtml(html);

    expect(flatIngredients(result)[0].item).toBe('sugar');
    expect(result.servings).toBe(4);
    expect(result.warnings).toEqual([]);
  });
});
