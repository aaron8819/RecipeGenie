import { describe, it, expect } from 'vitest';
import { extractRecipeFromHtml } from '../recipe-url-parser';

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
    expect(result.ingredients).toHaveLength(4);
    expect(result.ingredients[0].item).toBe('all-purpose flour');
    expect(result.ingredients[0].amount).toBe(2);
    expect(result.ingredients[0].originalText)
      .toBe('2 cups all-purpose flour');
    expect(result.ingredients[2]).toMatchObject({
      item: 'eggs',
      amount: 2,
      unit: 'count',
    });
    expect(result.instructions).toHaveLength(3);
    expect(result.instructions[0])
      .toBe('Mix dry ingredients.');
    expect(result.servings).toBe(12);
    expect(result.imageUrl)
      .toBe('https://example.com/pancakes.jpg');
    expect(result.warnings).toHaveLength(0);
  });

  it('should handle @graph-nested recipe', () => {
    const result = extractRecipeFromHtml(GRAPH_JSONLD);
    expect(result.name).toBe('Graph Tacos');
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[1]).toMatchObject({
      item: 'tortillas',
      amount: 8,
      unit: 'count',
    });
    expect(result.instructions).toHaveLength(2);
    expect(result.servings).toBe(4);
  });

  it('should fall back to OG meta tags', () => {
    const result = extractRecipeFromHtml(OG_ONLY);
    expect(result.name).toBe('My Awesome Recipe');
    expect(result.imageUrl)
      .toBe('https://example.com/img.jpg');
    expect(result.ingredients).toHaveLength(0);
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
    expect(result.instructions).toEqual([
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
});
