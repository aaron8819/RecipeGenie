export const RECIPE_WORKFLOW_FIXTURE_VERSION = 1

export interface RecipeWorkflowFixtureInput {
  id: string
  covers: string[]
  pastedText: string
}

export const RECIPE_WORKFLOW_FIXTURE_INPUTS: RecipeWorkflowFixtureInput[] = [
  {
    id: "unicode-fractions-pancakes",
    covers: ["unicode fractions", "servings"],
    pastedText: `Fluffy Pancakes
Serves 4

Ingredients:
- 1½ cups all-purpose flour
- ½ cup milk
- ¼ tsp salt

Instructions:
1. Whisk the dry ingredients.
2. Stir in milk and cook on a griddle.`,
  },
  {
    id: "ascii-mixed-fractions-bread",
    covers: ["ASCII fractions", "mixed fractions"],
    pastedText: `Skillet Cornbread
Makes 8 servings
Ingredients
1 1/2 cups cornmeal
3/4 cup flour
1/3 cup sugar
Directions
Mix the batter.
Bake until golden.`,
  },
  {
    id: "range-seasoning",
    covers: ["ranges", "en dash"],
    pastedText: `Roasted Carrots
Servings: 6

Ingredients:
1–2 tablespoons olive oil
2-3 tsp cumin
1 lb carrots

Instructions:
Toss everything together.
Roast until tender.`,
  },
  {
    id: "mixed-units-cocoa",
    covers: ["mixed units", "duplicate ingredients"],
    pastedText: `Double Chocolate Pudding
Serves 4

Ingredients:
1 cup milk
8 fl oz milk
4 oz dark chocolate
2 tbsp cocoa powder

Instructions:
Heat the milk.
Whisk in the remaining ingredients.`,
  },
  {
    id: "missing-quantities-salad",
    covers: ["missing quantities", "garnish"],
    pastedText: `Garden Salad

Ingredients:
mixed greens
salt, to taste
black pepper
fresh herbs for garnish

Directions:
Combine in a bowl.
Season and serve.`,
  },
  {
    id: "optional-garnishes-soup",
    covers: ["optional ingredients", "garnishes", "parenthetical modifier"],
    pastedText: `Tomato Soup
Serves 4

Ingredients:
2 cans tomatoes
1 cup vegetable stock
1/2 cup cream (optional)
2 tbsp basil, for garnish

Instructions:
Simmer tomatoes and stock.
Blend, finish with cream, and garnish.`,
  },
  {
    id: "ingredient-alternatives-curry",
    covers: ["ingredient alternatives"],
    pastedText: `Weeknight Curry
Servings: 4

Ingredients:
1 cup coconut milk or cashew cream
2 tbsp cilantro or parsley
1 lb chicken thighs

Instructions:
Simmer the chicken in coconut milk.
Top with herbs.`,
  },
  {
    id: "multiple-components-chicken",
    covers: ["multiple components", "grouped ingredients", "grouped instructions"],
    pastedText: `Lemon Chicken with Salad
Serves 4

Ingredients:
Chicken:
1 lb chicken breast
1 tbsp olive oil
Sauce:
1/2 cup chicken broth
1 tbsp lemon juice
Salad:
2 cups arugula
1 whole lemon

Instructions:
Chicken:
1. Sear the chicken.
Sauce:
2. Deglaze with broth and lemon juice.
Salad:
3. Toss arugula with sliced lemon.`,
  },
  {
    id: "near-duplicate-onions",
    covers: ["duplicate ingredients", "near-duplicate ingredients", "singular plural"],
    pastedText: `Onion Pasta
Serves 2

Ingredients:
1 onion
2 whole onions
1 cup red onion, sliced
1 tbsp butter

Instructions:
Cook the onions slowly.
Toss with pasta and butter.`,
  },
  {
    id: "instruction-only-ingredients",
    covers: ["ingredients only in instructions"],
    pastedText: `Simple Omelet
Serves 1

Ingredients:
2 eggs
1 tbsp butter

Instructions:
Whisk the eggs with a splash of water.
Melt butter, add eggs, and finish with chives.`,
  },
  {
    id: "parenthetical-preparation",
    covers: ["parenthetical preparation notes", "package size"],
    pastedText: `Bean Chili
Serves 6

Ingredients:
1 (28 oz) can crushed tomatoes
2 cans black beans (drained)
1 large onion (diced)
3 cloves garlic, minced

Instructions:
Combine all ingredients.
Simmer for 30 minutes.`,
  },
  {
    id: "poorly-formatted-no-blank-lines",
    covers: ["poor formatting", "multiline copied text"],
    pastedText: `Quick Noodles
serves 2
INGREDIENTS
8 oz noodles
2tbsp soy sauce
1 tsp sesame oil
DIRECTIONS
Boil noodles
Drain well
Toss with sauce`,
  },
  {
    id: "unit-variations-potatoes",
    covers: ["singular plural units", "unit variations"],
    pastedText: `Mashed Potatoes
Makes 6 servings

Ingredients:
2 pounds potatoes
1 cup milk
2 tablespoons butter
1 teaspoon salt

Instructions:
Boil potatoes.
Mash with milk, butter, and salt.`,
  },
  {
    id: "servings-in-title",
    covers: ["serving count in title"],
    pastedText: `Tacos — Makes 6 servings

Ingredients:
12 tortillas
1 lb ground beef
1 cup salsa

Instructions:
Brown the beef.
Fill tortillas and serve.`,
  },
  {
    id: "no-serving-count",
    covers: ["missing serving count"],
    pastedText: `Garlic Rice

Ingredients:
1 cup rice
2 cups water
2 cloves garlic

Instructions:
Bring to a boil.
Cover and cook until tender.`,
  },
  {
    id: "metric-lentil-stew",
    covers: ["metric units", "mixed units"],
    pastedText: `Lentil Stew
Servings: 5

Ingredients:
500 g lentils
1 liter vegetable broth
250 ml water
2 tbsp tomato paste

Instructions:
Combine ingredients.
Simmer until the lentils are tender.`,
  },
  {
    id: "bom-crlf-bullets",
    covers: ["BOM", "CRLF", "bullet variations", "non-breaking spaces"],
    pastedText: `﻿Herbed Couscous\r
Serves 3\r
\r
Ingredients:\r
• 1 cup couscous\r
* 1½ cups broth\r
- 2 tbsp parsley\r
\r
Method:\r
1) Pour hot broth over couscous.\r
2) Rest, fluff, and add parsley.`,
  },
  {
    id: "metadata-times-and-notes",
    covers: ["field metadata", "times", "notes"],
    pastedText: `Title: Sheet Pan Salmon
Servings: 4
Prep Time: 15 minutes
Cook Time: 20 minutes
Total Time: 35 minutes

Ingredients:
4 fillets salmon
2 tbsp olive oil

Instructions:
1. Heat the oven.
2. Roast salmon until flaky.

Notes:
- Use center-cut fillets.
- Serve immediately.`,
  },
  {
    id: "parenthetical-optional-alternative",
    covers: ["alternatives", "optional modifier"],
    pastedText: `Creamy Pasta
Serves 4

Ingredients:
12 oz pasta
1 cup parmesan or pecorino
1/4 cup parsley (optional)

Directions:
Cook pasta.
Fold in cheese and parsley.`,
  },
  {
    id: "whole-count-variations",
    covers: ["whole count units", "count inference"],
    pastedText: `Citrus Salsa
Serves 4

Ingredients:
2 limes
1 whole orange
3 count tomatoes
1 piece jalapeño

Instructions:
Dice all produce.
Mix and chill.`,
  },
  {
    id: "legacy-unheaded-format",
    covers: ["legacy format", "missing section headers"],
    pastedText: `Peanut Butter Toast
Serves 1
2 slices bread
2 tbsp peanut butter
1 banana
Toast the bread.
Spread peanut butter and top with banana.`,
  },
  {
    id: "decimal-and-dash-range",
    covers: ["decimal quantities", "em dash range"],
    pastedText: `Spiced Tea
Serves 2

Ingredients:
1.5 cups water
0.5 cup milk
2—4 pods cardamom

Steps:
Boil water with cardamom.
Add milk and steep.`,
  },
  {
    id: "noisy-copied-heading",
    covers: ["copied text", "section aliases", "numbered instructions"],
    pastedText: `Best Ever Guacamole
Yield: 4 servings

WHAT YOU'LL NEED
3 avocados
1 tbsp lime juice
1/2 tsp kosher salt

METHOD
Step 1: Mash the avocados.
Step 2: Fold in lime juice and salt.`,
  },
  {
    id: "sauce-duplicate-citrus-prep",
    covers: ["duplicate citrus", "preparation intent", "shopping normalization"],
    pastedText: `Lemon Dressing
Serves 4

Ingredients:
2 tbsp lemon juice
1 tbsp lemon zest
1/2 cup olive oil
1 tsp mustard

Instructions:
Whisk all ingredients until emulsified.`,
  },
]
