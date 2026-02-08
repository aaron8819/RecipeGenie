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
});
