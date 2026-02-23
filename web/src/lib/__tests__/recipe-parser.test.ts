import { describe, it, expect } from 'vitest';
import {
  parseRecipeText,
  parseIngredientLine,
} from '../recipe-parser';

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

