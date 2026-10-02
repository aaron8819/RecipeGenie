import type { Recipe } from '@/types/database';
import {
  createEmptyShoppingDocument,
  applyShoppingDocumentMutation,
  createShoppingRecipeEntry,
  projectShoppingDocument,
} from '@/lib/shopping-document';
import { getWeekStartDate } from '@/components/planner/meal-planner.utils';
import { parseLocalDate } from '@/lib/planner-utils';

export const today = new Date('2026-09-30T12:00:00');
export const weekStart = parseLocalDate(getWeekStartDate(today, 1));
export const days = Array.from({ length: 7 }, (_, i) => {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + i);
  return date;
});
export const todayIndex = 2;
export interface Meal {
  recipeId: string;
  day: number;
  cooked: boolean;
}
export const scenarios = [
  'Populated dashboard',
  'Completely empty',
  'Partially planned week',
  'All today’s meals cooked',
  'All shopping checked off',
  'Loading',
  'Load failure',
];
const data: [string, number, [string, number, string][]][] = [
  [
    'Honey Berry Oatmeal',
    15,
    [
      ['rolled oats', 1, 'cup'],
      ['milk', 2, 'cup'],
      ['blueberries', 1, 'cup'],
      ['honey', 2, 'tbsp'],
    ],
  ],
  [
    'Mediterranean Quinoa',
    20,
    [
      ['quinoa', 1, 'cup'],
      ['cucumber', 1, ''],
      ['cherry tomatoes', 2, 'cup'],
      ['feta cheese', 100, 'g'],
    ],
  ],
  [
    'Lemon Garlic Salmon',
    25,
    [
      ['salmon', 500, 'g'],
      ['lemon', 2, ''],
      ['garlic', 3, 'clove'],
    ],
  ],
  [
    'Pesto Pasta Salad',
    20,
    [
      ['pasta', 400, 'g'],
      ['cherry tomatoes', 1, 'cup'],
      ['pesto', 4, 'tbsp'],
    ],
  ],
  [
    'Roasted Vegetable Bowl',
    35,
    [
      ['carrot', 3, ''],
      ['quinoa', 1, 'cup'],
      ['olive oil', 2, 'tbsp'],
    ],
  ],
  [
    'Creamy Tomato Soup',
    30,
    [
      ['tomato', 6, ''],
      ['milk', 1, 'cup'],
      ['garlic', 2, 'clove'],
    ],
  ],
  [
    'Chickpea & Spinach Skillet',
    20,
    [
      ['chickpeas', 2, 'cup'],
      ['spinach', 100, 'g'],
      ['garlic', 2, 'clove'],
    ],
  ],
  [
    'Lemon Herb Chicken',
    30,
    [
      ['chicken', 500, 'g'],
      ['lemon', 1, ''],
      ['olive oil', 2, 'tbsp'],
    ],
  ],
];
export const recipes: Recipe[] = data.map(([name, time, ingredients], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  name,
  user_id: 'fixture-only',
  category: 'Other',
  servings: 4,
  favorite: false,
  tags: [],
  image_url: i === 0 ? '/oatmeal.jpg' : i === 1 ? '/quinoa.jpg' : null,
  created_at: null,
  updated_at: null,
  total_time_minutes: time,
  ingredientSections: [
    {
      label: null,
      ingredients: ingredients.map(([item, amount, unit]) => ({
        item,
        amount,
        unit,
      })),
    },
  ],
  instructionSections: [
    {
      label: null,
      steps: [
        'Prepare the ingredients.',
        'Cook until tender, season to taste, and serve.',
      ],
    },
  ],
}));
export function fixture(scenario: string) {
  let meals: Meal[] = recipes.slice(0, 6).map((recipe, i) => ({
    recipeId: recipe.id,
    day: [2, 2, 0, 3, 5, 6][i],
    cooked: i === 2,
  }));
  if (scenario === 'Completely empty') meals = [];
  if (scenario === 'Partially planned week')
    meals = meals.filter((_, i) => [0, 1, 4].includes(i));
  if (scenario === 'All today’s meals cooked')
    meals = meals.map((m) => ({
      ...m,
      cooked: m.day === todayIndex || m.cooked,
    }));
  let shopping = {
    document: createEmptyShoppingDocument(),
    contentRevision: 0,
  };
  if (scenario !== 'Completely empty')
    shopping = applyShoppingDocumentMutation(shopping, {
      type: 'upsertRecipes',
      entries: recipes
        .slice(0, 2)
        .map((r) =>
          createShoppingRecipeEntry(r, 4, { numerator: '1', denominator: '1' }),
        ),
    });
  if (scenario === 'All shopping checked off')
    shopping = applyShoppingDocumentMutation(shopping, {
      type: 'setCheckedMany',
      rowRefs: projectShoppingDocument(shopping.document).items.map(
        (r) => r.rowRef,
      ),
      checked: true,
    });
  return { meals, shopping };
}
