import { describe, it, expect } from 'vitest';
import {
  parseRecipeText,
  parseIngredientLine,
} from '../recipe-parser';
import { STRUCTURED_LAMB_RECIPE_TEXT } from './recipe-parser.fixtures';

describe('parseIngredientLine', () => {
  it('should populate originalText with the cleaned line', () => {
    const result = parseIngredientLine('2 cups flour');
    expect(result.originalText).toBe('2 cups flour');
    expect(result.item).toBe('flour');
    expect(result.amount).toBe(2);
    expect(result.unit).toBe('cups');
  });

  it('should strip list markers before setting originalText', () => {
    const result = parseIngredientLine('- 1 tsp salt');
    expect(result.originalText).toBe('1 tsp salt');
  });

  it('should strip bullet markers before setting originalText', () => {
    const result = parseIngredientLine('• 1/2 cup sugar');
    expect(result.originalText).toBe('1/2 cup sugar');
  });

  it('should set originalText on items without amounts', () => {
    const result =
      parseIngredientLine('Salt & black pepper to taste');
    expect(result.originalText)
      .toBe('Salt & black pepper to taste');
    expect(result.amount).toBeNull();
  });

  it('should preserve modifier in originalText', () => {
    const result =
      parseIngredientLine('1 yellow onion, diced');
    expect(result.originalText)
      .toBe('1 yellow onion, diced');
    expect(result.modifier).toBe('diced');
  });

  it('should infer whole/count units when an amount is followed by an item name', () => {
    const cases = [
      ['1 onion, sliced', { amount: 1, unit: 'count', item: 'onion', modifier: 'sliced' }],
      ['1 red bell pepper, diced', { amount: 1, unit: 'count', item: 'red bell pepper', modifier: 'diced' }],
      ['2 eggs', { amount: 2, unit: 'count', item: 'eggs' }],
      ['1 lime, juiced', { amount: 1, unit: 'count', item: 'lime', modifier: 'juiced' }],
      ['\u00bd avocado', { amount: 0.5, unit: 'count', item: 'avocado' }],
      ['3 tortillas', { amount: 3, unit: 'count', item: 'tortillas' }],
      ['1 chicken breast, thinly sliced', { amount: 1, unit: 'count', item: 'chicken breast', modifier: 'thinly sliced' }],
    ] as const;

    for (const [line, expected] of cases) {
      expect(parseIngredientLine(line)).toMatchObject(expected);
    }
  });

  it('should preserve measured-unit parsing while supporting count inference', () => {
    expect(parseIngredientLine('1 cup rice')).toMatchObject({
      amount: 1,
      unit: 'cup',
      item: 'rice',
    });
    expect(parseIngredientLine('2 tbsp soy sauce')).toMatchObject({
      amount: 2,
      unit: 'tbsp',
      item: 'soy sauce',
    });
    expect(parseIngredientLine('1 lb chicken breast')).toMatchObject({
      amount: 1,
      unit: 'lb',
      item: 'chicken breast',
    });
    expect(parseIngredientLine('\u00bd tsp salt')).toMatchObject({
      amount: 0.5,
      unit: 'tsp',
      item: 'salt',
    });
  });

  it('parses copied quantities when the unit is attached to the number', () => {
    expect(parseIngredientLine('2tbsp soy sauce')).toMatchObject({
      amount: 2,
      unit: 'tbsp',
      item: 'soy sauce',
    });
  });

  it('should return empty item for section headers', () => {
    const result = parseIngredientLine('Ingredients');
    expect(result.item).toBe('');
    expect(result.originalText).toBeUndefined();
  });

  it('should return empty item for empty lines', () => {
    const result = parseIngredientLine('   ');
    expect(result.item).toBe('');
    expect(result.originalText).toBeUndefined();
  });
});

describe('parseRecipeText', () => {
  it('should populate originalText on all parsed ingredients', () => {
    const text = `Chicken Stir Fry

Ingredients
2 lbs chicken breast
1 tbsp soy sauce
3 cloves garlic, minced

Instructions
Cook the chicken.
Add sauce.`;

    const result = parseRecipeText(text);
    expect(result.ingredients).toHaveLength(3);
    expect(result.ingredients[0].originalText)
      .toBe('2 lbs chicken breast');
    expect(result.ingredients[1].originalText)
      .toBe('1 tbsp soy sauce');
    expect(result.ingredients[2].originalText)
      .toBe('3 cloves garlic, minced');
  });

  it('should parse pasted countable whole ingredients without validation gaps', () => {
    const text = `Fajita Eggs

Ingredients
1 onion, sliced
1 red bell pepper, diced
2 eggs
1 lime, juiced
\u00bd avocado
1 chicken breast, thinly sliced

Instructions
Cook everything.
Serve.`;

    const result = parseRecipeText(text);

    expect(result.ingredients).toMatchObject([
      { item: 'onion', amount: 1, unit: 'count', modifier: 'sliced' },
      { item: 'red bell pepper', amount: 1, unit: 'count', modifier: 'diced' },
      { item: 'eggs', amount: 2, unit: 'count' },
      { item: 'lime', amount: 1, unit: 'count', modifier: 'juiced' },
      { item: 'avocado', amount: 0.5, unit: 'count' },
      { item: 'chicken breast', amount: 1, unit: 'count', modifier: 'thinly sliced' },
    ]);
  });

  it('should preserve Unicode fractions in originalText', () => {
    const result = parseIngredientLine('½ tsp oregano');
    expect(result.originalText).toBe('½ tsp oregano');
    expect(result.amount).toBe(0.5);
  });

  it('should keep optional ingredient lines instead of treating them as section headers', () => {
    const text = `Sweet Ginger Teriyaki Chicken Bowl

Ingredients:
1.25 lb boneless skinless chicken thighs or breasts, cubed
1 to 1.5 cups sweet ginger teriyaki sauce
1 tbsp avocado oil or olive oil
1 red bell pepper, sliced
1 cup broccoli florets
2 cloves garlic, minced
1 tsp fresh grated ginger (optional)
2 cups cooked jasmine rice
Sesame seeds (optional)
Green onions, sliced (optional)

Instructions:
Cook and serve.`;

    const result = parseRecipeText(text);
    expect(result.ingredients).toHaveLength(10);
    expect(result.ingredients.some((i) => i.item.toLowerCase().includes('sesame seeds'))).toBe(true);
    expect(result.ingredients.some((i) => i.item.toLowerCase().includes('green onions'))).toBe(true);
  });

  it('parses field-prefixed metadata, grouped sections, and notes from structured recipe text', () => {
    const result = parseRecipeText(STRUCTURED_LAMB_RECIPE_TEXT);

    expect(result.name).toBe('Cast Iron Lamb Shoulder Chops with Garlic Herb Pan Sauce');
    expect(result.servings).toBe(2);
    expect(result.metadata).toMatchObject({
      prepTime: '10 minutes',
      prepTimeMinutes: 10,
      cookTime: '12 minutes',
      cookTimeMinutes: 12,
      totalTime: '22 minutes',
      totalTimeMinutes: 22,
    });

    expect(result.ingredientGroups).toHaveLength(2);
    expect(result.ingredientGroups?.[0].label).toBeUndefined();
    expect(result.ingredientGroups?.[0].ingredients).toHaveLength(7);
    expect(result.ingredientGroups?.[1].label).toBe('Pan Sauce');
    expect(result.ingredientGroups?.[1].ingredients).toHaveLength(3);

    expect(result.ingredients).toHaveLength(10);
    expect(result.ingredients[7]).toMatchObject({
      item: 'red wine',
      amount: 0.25,
      unit: 'cup',
      groupLabel: 'Pan Sauce',
      alternatives: ['beef broth'],
      originalText: '1/4 cup red wine or beef broth',
    });
    expect(result.ingredients[9]).toMatchObject({
      item: 'butter',
      amount: 1,
      unit: 'tbsp',
      groupLabel: 'Pan Sauce',
    });

    expect(result.instructionGroups).toHaveLength(2);
    expect(result.instructionGroups?.[0].steps).toHaveLength(8);
    expect(result.instructionGroups?.[1]).toMatchObject({
      label: 'Pan Sauce',
    });
    expect(result.instructionGroups?.[1].steps).toHaveLength(5);
    expect(result.instructionGroups?.[1].steps[0]).toBe('Lower heat to medium.');

    expect(result.notes).toEqual([
      'Lamb shoulder chops are flavorful but slightly tougher than loin chops, so slicing along the natural seam after cooking improves tenderness.',
      'Best served medium-rare to medium (130–140°F).',
      'Pairs well with crispy potatoes, Greek salad, or roasted vegetables.',
    ]);
  });

  it('preserves grouped instructions and notes losslessly in the current flat model fallback', () => {
    const result = parseRecipeText(STRUCTURED_LAMB_RECIPE_TEXT);

    expect(result.instructions).toEqual([
      'Remove lamb shoulder chops from the refrigerator 20–30 minutes before cooking. Pat dry thoroughly.',
      'Season both sides generously with salt and black pepper.',
      'Heat a heavy skillet (preferably cast iron) over medium-high heat until very hot.',
      'Add olive oil to the pan.',
      'Place lamb shoulder chops in the skillet and sear for 4–5 minutes on the first side.',
      'Flip and cook for 4–6 minutes on the second side.',
      'During the last minute of cooking, add butter, smashed garlic, and rosemary. Tilt the pan and spoon the melted butter over the chops repeatedly.',
      'Remove lamb from the pan when internal temperature reaches about 130°F for medium-rare. Rest for 5 minutes.',
      'Pan Sauce:',
      'Lower heat to medium.',
      'Add red wine or beef broth to the skillet and scrape the browned bits from the pan.',
      'Add lemon juice and simmer for 1–2 minutes until slightly reduced.',
      'Stir in butter until the sauce becomes glossy.',
      'Spoon the pan sauce over the rested lamb chops and serve.',
      'Notes:',
      'Lamb shoulder chops are flavorful but slightly tougher than loin chops, so slicing along the natural seam after cooking improves tenderness.',
      'Best served medium-rare to medium (130–140°F).',
      'Pairs well with crispy potatoes, Greek salad, or roasted vegetables.',
    ]);
  });

  it('does not lose content from the structured regression fixture', () => {
    const result = parseRecipeText(STRUCTURED_LAMB_RECIPE_TEXT);

    const flattenedContent = [
      result.name,
      ...result.ingredients.map((ingredient) => ingredient.originalText || ingredient.item),
      ...result.instructions,
      ...(result.notes || []),
    ].join('\n');

    expect(flattenedContent).toContain('Cast Iron Lamb Shoulder Chops with Garlic Herb Pan Sauce');
    expect(flattenedContent).toContain('1 sprig fresh rosemary (or thyme)');
    expect(flattenedContent).toContain('1/4 cup red wine or beef broth');
    expect(flattenedContent).toContain('Pan Sauce:');
    expect(flattenedContent).toContain('Lower heat to medium.');
    expect(flattenedContent).toContain('Best served medium-rare to medium (130–140°F).');
  });

  it('recognizes common copied ingredient headings without adding them as ingredients', () => {
    const result = parseRecipeText(`Best Ever Guacamole
Yield: 4 servings

WHAT YOU'LL NEED
3 avocados
1 tbsp lime juice

METHOD
Step 1: Mash the avocados.`);

    expect(result.ingredients.map((ingredient) => ingredient.item)).toEqual([
      'avocados',
      'lime juice',
    ]);
    expect(result.warnings).not.toContain('"WHAT YOU\'LL NEED" has no amount');
  });

  it.each(['WHAT YOU NEED', 'WHAT YOU WILL NEED'])(
    'recognizes the copied ingredient heading %s',
    (heading) => {
      const result = parseRecipeText(`Tomato Toast\n\n${heading}\n2 tomatoes\n\nMETHOD\nSlice and serve.`);

      expect(result.ingredients.map((ingredient) => ingredient.item)).toEqual(['tomatoes']);
      expect(result.warnings).not.toContain(`"${heading}" has no amount`);
    }
  );

  it('removes serving boilerplate from a title after extracting the count', () => {
    const result = parseRecipeText(`Tacos — Makes 6 servings

Ingredients:
12 tortillas

Instructions:
Fill tortillas and serve.`);

    expect(result.name).toBe('Tacos');
    expect(result.servings).toBe(6);
  });
});

describe('modifier extraction improvements', () => {
  it('should extract parenthetical modifiers', () => {
    const result = parseIngredientLine('½ cup unsalted butter (to be browned)');
    expect(result.item).toBe('unsalted butter');
    expect(result.amount).toBe(0.5);
    expect(result.unit).toBe('cup');
    expect(result.modifier).toBe('to be browned');
  });

  it('should extract "optional" in parentheses', () => {
    const result = parseIngredientLine('Pinch nutmeg (optional)');
    expect(result.item).toBe('Pinch nutmeg'); // "Pinch" without amount stays as part of item
    expect(result.amount).toBeNull();
    expect(result.modifier).toBe('optional');
  });

  it('should extract "for X" patterns', () => {
    const result = parseIngredientLine('1 tablespoon sugar, for topping');
    expect(result.item).toBe('sugar');
    expect(result.amount).toBe(1);
    expect(result.unit).toBe('tablespoon');
    expect(result.modifier).toBe('for topping');
  });

  it('should extract both parenthetical and "for X" modifiers', () => {
    const result = parseIngredientLine('1–2 tablespoons turbinado (raw) sugar, for topping');
    expect(result.item).toBe('turbinado sugar');
    expect(result.amount).toBe(1);
    expect(result.unit).toBe('1-2 tablespoons');
    expect(result.modifier).toBe('raw, for topping');
  });

  it('should extract both comma-separated and parenthetical modifiers', () => {
    const result = parseIngredientLine('1 yellow onion (medium), diced');
    expect(result.item).toBe('yellow onion');
    expect(result.amount).toBe(1);
    expect(result.modifier).toBe('diced, medium');
  });

  it('should handle "softened" in parentheses', () => {
    const result = parseIngredientLine('1 cup butter (softened)');
    expect(result.item).toBe('butter');
    expect(result.modifier).toBe('softened');
  });

  it('should not extract long notes in parentheses', () => {
    const result = parseIngredientLine('1½ cups flour (use 1¾ if bananas are very large)');
    // Long notes should stay in the item, not be extracted as modifiers
    expect(result.item).toBe('flour (use 1.75 if bananas are very large)');
    expect(result.originalText).toBe('1½ cups flour (use 1¾ if bananas are very large)');
    expect(result.modifier).toBeUndefined();
    expect(result.amount).toBe(1.5); // Verify primary amount is correct
    expect(result.unit).toBe('cups'); // Verify unit is correct
  });

  it('should preserve existing comma-based modifier extraction', () => {
    const result = parseIngredientLine('3 cloves garlic, minced');
    expect(result.item).toBe('garlic');
    expect(result.modifier).toBe('minced');
    expect(result.amount).toBe(3);
    expect(result.unit).toBe('cloves');
  });

  it('should handle modifier with "or" in parentheses', () => {
    const result = parseIngredientLine('2 cups potatoes (peeled or unpeeled), diced');
    expect(result.item).toBe('potatoes');
    expect(result.amount).toBe(2);
    expect(result.unit).toBe('cups');
    // Both modifiers should be extracted
    expect(result.modifier).toBe('diced, peeled or unpeeled');
  });
});

describe('mixed fraction parsing (P0 fix)', () => {
  it('should correctly parse ASCII mixed fractions', () => {
    const result = parseIngredientLine('1 1/2 cups cornmeal');
    expect(result.amount).toBe(1.5);
    expect(result.unit).toBe('cups');
    expect(result.item).toBe('cornmeal');
  });

  it('should correctly parse simple mixed fractions', () => {
    const result = parseIngredientLine('1¾ cups flour');
    expect(result.amount).toBe(1.75); // NOT 1
    expect(result.unit).toBe('cups'); // NOT "10.75 cups"
    expect(result.item).toBe('flour');
  });

  it('should handle multiple mixed fractions in ranges', () => {
    const result = parseIngredientLine('1½–1¾ cups flour');
    expect(result.amount).toBe(1.5);
    expect(result.unit).toBe('1.5-1.75 cups');
    expect(result.item).toBe('flour');
  });

  it('should still handle standalone fractions correctly', () => {
    const result = parseIngredientLine('¾ cup sugar');
    expect(result.amount).toBe(0.75);
    expect(result.unit).toBe('cup');
    expect(result.item).toBe('sugar');
  });

  it('should preserve Unicode fractions in originalText', () => {
    const result = parseIngredientLine('1¾ cups flour');
    expect(result.originalText).toBe('1¾ cups flour');
    expect(result.amount).toBe(1.75); // Parsed correctly
  });

  it('should handle all Unicode fraction types as mixed fractions', () => {
    expect(parseIngredientLine('1½ cups water').amount).toBe(1.5);
    expect(parseIngredientLine('2⅓ cups flour').amount).toBe(2 + 1/3);
    expect(parseIngredientLine('1⅔ cups sugar').amount).toBe(1 + 2/3);
    expect(parseIngredientLine('3¼ cups broth').amount).toBe(3.25);
    expect(parseIngredientLine('2¾ cups milk').amount).toBe(2.75);
  });

  it('should handle mixed fractions with ⅛ and ⅜ variants', () => {
    expect(parseIngredientLine('1⅛ tsp salt').amount).toBe(1.125);
    expect(parseIngredientLine('2⅜ oz cheese').amount).toBe(2.375);
    expect(parseIngredientLine('3⅝ cups cream').amount).toBe(3.625);
    expect(parseIngredientLine('4⅞ lbs meat').amount).toBe(4.875);
  });
});

describe('alternative ingredient detection (P2)', () => {
  it('should extract simple "or" alternatives', () => {
    const result = parseIngredientLine('2 tablespoons Greek yogurt or sour cream');
    expect(result.item).toBe('Greek yogurt');
    expect(result.alternatives).toEqual(['sour cream']);
    expect(result.amount).toBe(2);
    expect(result.unit).toBe('tablespoons');
  });

  it('should not extract "or" in modifier context (to taste)', () => {
    const result = parseIngredientLine('Salt or pepper to taste');
    expect(result.item).toBe('Salt or pepper to taste');
    expect(result.alternatives).toBeUndefined();
  });

  it('should not extract "or" in modifier context (peeled or unpeeled)', () => {
    const result = parseIngredientLine('2 cups potatoes (peeled or unpeeled)');
    expect(result.item).toBe('potatoes');
    expect(result.modifier).toBe('peeled or unpeeled');
    expect(result.alternatives).toBeUndefined();
  });

  it('should not extract "or" in quantity context (more or less)', () => {
    const result = parseIngredientLine('1 cup milk, more or less');
    expect(result.item).toBe('milk');
    expect(result.modifier).toBe('more or less');
    expect(result.alternatives).toBeUndefined();
  });

  it('should handle alternatives without amounts', () => {
    const result = parseIngredientLine('Butter or margarine');
    expect(result.item).toBe('Butter');
    expect(result.alternatives).toEqual(['margarine']);
    expect(result.amount).toBeNull();
  });

  it('should handle alternatives with modifiers', () => {
    const result = parseIngredientLine('1 cup whole milk or almond milk, chilled');
    expect(result.item).toBe('whole milk');
    expect(result.alternatives).toEqual(['almond milk']);
    expect(result.modifier).toBe('chilled');
    expect(result.amount).toBe(1);
    expect(result.unit).toBe('cup');
  });

  it('should not extract single-letter alternatives', () => {
    // Edge case: avoid matching things like "X or Y coordinates"
    const result = parseIngredientLine('X or Y');
    expect(result.item).toBe('X or Y');
    expect(result.alternatives).toBeUndefined();
  });

  it('should handle "as needed" pattern', () => {
    const result = parseIngredientLine('Salt or water as needed');
    expect(result.item).toBe('Salt or water as needed');
    expect(result.alternatives).toBeUndefined();
  });
});

