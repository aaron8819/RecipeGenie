/**
 * Guest Mode - Simplified cache-only guest experience
 * Data is stored in React Query cache only and lost on page refresh
 */

import type { Recipe, ShoppingItem } from "@/types/database"

const GUEST_MODE_KEY = "recipe-genie-guest-mode"
const GUEST_USER_ID = "guest"

// ============================================================================
// GUEST MODE STATE
// ============================================================================

export function isGuestMode(): boolean {
  if (typeof window === "undefined") return false
  return sessionStorage.getItem(GUEST_MODE_KEY) === "true"
}

export function setGuestMode(enabled: boolean): void {
  if (typeof window === "undefined") return
  if (enabled) {
    sessionStorage.setItem(GUEST_MODE_KEY, "true")
  } else {
    sessionStorage.removeItem(GUEST_MODE_KEY)
  }
}

// ============================================================================
// DEFAULT DATA FOR GUEST MODE
// ============================================================================

export function getDefaultRecipes(): Recipe[] {
  const now = new Date().toISOString()
  
  return [
    {
      id: "mac-and-cheese",
      user_id: GUEST_USER_ID,
      name: "4-Ingredient Mac & Cheese",
      category: "vegetarian",
      servings: 4,
      favorite: false,
      tags: [],
      ingredients: [
        { item: "chicken broth", unit: "cups", amount: 2 },
        { item: "elbow noodles", unit: "oz", amount: 8 },
        { item: "evaporated milk", unit: "oz", amount: 8 },
        { item: "cheddar cheese", unit: "oz", amount: 8 },
      ],
      instructions: [
        "Bring broth to boil in large pan, add noodles.",
        "Cook 3 mins less than package directions, stirring to release starches.",
        "Lower heat, stir in evaporated milk. Simmer until 1/3 milk remains.",
        "Remove from heat, stir in grated cheese until smooth. Serve immediately.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "beef-and-broccoli",
      user_id: GUEST_USER_ID,
      name: "Beef and Broccoli",
      category: "beef",
      servings: 4,
      favorite: true,
      tags: [],
      ingredients: [
        { item: "beef sirloin", unit: "lb", amount: 1 },
        { item: "broccoli florets", unit: "cups", amount: 3 },
        { item: "olive oil", unit: "tbsp", amount: 2 },
        { item: "soy sauce", unit: "tbsp", amount: 6 },
        { item: "cornstarch", unit: "tbsp", amount: 2 },
        { item: "brown sugar", unit: "tbsp", amount: 2 },
        { item: "oyster sauce", unit: "tbsp", amount: 2 },
        { item: "rice vinegar", unit: "tbsp", amount: 1 },
        { item: "garlic", unit: "cloves", amount: 3 },
        { item: "ginger", unit: "tbsp", amount: 1 },
        { item: "rice", unit: "cups", amount: 2 },
      ],
      instructions: [
        "Slice beef thin against the grain. Toss with 2 tbsp soy sauce and 1 tbsp cornstarch. Marinate 10 mins.",
        "Blanch broccoli 2 mins, transfer to ice water.",
        "Mix remaining soy sauce, brown sugar, oyster sauce, vinegar, garlic, ginger for sauce.",
        "Sear beef in hot oil 1-2 mins per side, set aside.",
        "Stir-fry broccoli 2 mins, return beef, pour in sauce.",
        "Add cornstarch slurry (1 tbsp cornstarch + 2 tbsp water) to thicken. Serve over rice.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "lamb-meatballs-gyros",
      user_id: GUEST_USER_ID,
      name: "Lamb Meatball Gyros",
      category: "lamb",
      servings: 4,
      favorite: false,
      tags: [],
      ingredients: [
        { item: "cucumber", unit: "large", amount: 0.5 },
        { item: "greek yogurt", unit: "cups", amount: 2 },
        { item: "garlic", unit: "cloves", amount: 3 },
        { item: "lemon", unit: "whole", amount: 1.5 },
        { item: "olive oil", unit: "tbsp", amount: 2 },
        { item: "panko breadcrumbs", unit: "cup", amount: 0.25 },
        { item: "milk", unit: "cup", amount: 0.25 },
        { item: "ground lamb", unit: "lb", amount: 1 },
        { item: "yellow onion", unit: "medium", amount: 0.5 },
        { item: "fresh mint", unit: "tbsp", amount: 3 },
        { item: "egg", unit: "large", amount: 1 },
        { item: "oregano", unit: "tsp", amount: 1 },
        { item: "cumin", unit: "tsp", amount: 1 },
        { item: "coriander", unit: "tsp", amount: 1 },
        { item: "pita bread", unit: "whole", amount: 4 },
        { item: "tomato", unit: "whole", amount: 1 },
        { item: "red onion", unit: "whole", amount: 0.25 },
      ],
      instructions: [
        "Make tzatziki: mix grated cucumber, yogurt, garlic, lemon juice, olive oil, salt.",
        "Soak panko in milk 10 mins. Mix with lamb, onion, garlic, mint, egg, lemon zest, oregano, cumin, coriander, salt, pepper.",
        "Form into 2 tbsp meatballs, flatten slightly. Pan-fry in oil 2-3 mins per side until 165°F.",
        "Toast pitas lightly with oil on both sides.",
        "Spread tzatziki on pita, add 3-4 meatballs, sliced veggies, more tzatziki. Enjoy!",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "mediterranean-turkey-meatballs",
      user_id: GUEST_USER_ID,
      name: "Mediterranean Meatballs",
      category: "turkey",
      servings: 4,
      favorite: true,
      tags: [],
      ingredients: [
        { item: "ground turkey", unit: "lb", amount: 1 },
        { item: "feta cheese", unit: "oz", amount: 4 },
        { item: "spinach", unit: "cup", amount: 0.5 },
        { item: "red onion", unit: "small", amount: 0.5 },
        { item: "garlic", unit: "cloves", amount: 4 },
        { item: "fresh mint", unit: "tsp", amount: 1 },
        { item: "sun dried tomatoes", unit: "tbsp", amount: 2 },
        { item: "panko breadcrumbs", unit: "cup", amount: 0.25 },
        { item: "egg", unit: "large", amount: 1 },
        { item: "mayonnaise", unit: "tbsp", amount: 1 },
        { item: "cumin", unit: "tsp", amount: 0.5 },
        { item: "oregano", unit: "tsp", amount: 0.5 },
        { item: "paprika", unit: "tsp", amount: 0.5 },
      ],
      instructions: [
        "Mix ground turkey with crumbled feta, chopped spinach, red onion, garlic, mint, sun dried tomatoes.",
        "Add panko, egg, mayo, cumin, oregano, paprika, salt, pepper. Mix gently.",
        "Form into meatballs and place on baking sheet.",
        "Roast at 425°F for 20 mins (17 mins convection), flipping halfway.",
        "Serve with tzatziki, rice, or in pita.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "mexican-street-tacos-chicken",
      user_id: GUEST_USER_ID,
      name: "Mexican Street Tacos",
      category: "chicken",
      servings: 4,
      favorite: true,
      tags: [],
      ingredients: [
        { item: "chicken thighs", unit: "lbs", amount: 1.5 },
        { item: "orange juice", unit: "tbsp", amount: 4 },
        { item: "apple cider vinegar", unit: "tbsp", amount: 2 },
        { item: "lime", unit: "tbsp", amount: 1.5 },
        { item: "garlic", unit: "cloves", amount: 3 },
        { item: "chipotle chili powder", unit: "tbsp", amount: 1.5 },
        { item: "mexican oregano", unit: "tsp", amount: 2 },
        { item: "paprika", unit: "tsp", amount: 2 },
        { item: "cinnamon", unit: "tsp", amount: 0.25 },
        { item: "cotija cheese", unit: "cup", amount: 0.5 },
        { item: "corn tortillas", unit: "whole", amount: 12 },
      ],
      instructions: [
        "Mix marinade: orange juice, vinegar, lime juice, garlic, chipotle powder, oregano, paprika, cinnamon, salt, pepper.",
        "Marinate chicken thighs at least 1 hour or overnight.",
        "Grill over medium-high heat 4-5 mins per side until 165°F.",
        "Rest a few minutes, then chop into small pieces.",
        "Serve in tortillas with cotija cheese, roasted corn, pico, and guacamole.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "teriyaki-chicken-broccoli-bowls",
      user_id: GUEST_USER_ID,
      name: "Teriyaki Chicken and Broccoli Rice Bowls",
      category: "chicken",
      servings: 4,
      favorite: true,
      tags: [],
      ingredients: [
        { item: "chicken thighs", unit: "lbs", amount: 1.5 },
        { item: "garlic", unit: "cloves", amount: 2 },
        { item: "ginger", unit: "tsp", amount: 2 },
        { item: "water", unit: "cup", amount: 1 },
        { item: "soy sauce", unit: "cup", amount: 0.25 },
        { item: "brown sugar", unit: "cup", amount: 0.25 },
        { item: "jasmine rice", unit: "cup", amount: 1 },
        { item: "avocado oil", unit: "tsp", amount: 2 },
        { item: "cornstarch", unit: "tbsp", amount: 1 },
        { item: "white vinegar", unit: "tsp", amount: 1 },
        { item: "broccoli florets", unit: "cups", amount: 2 },
      ],
      instructions: [
        "Mix sauce ingredients (garlic, ginger, water, soy sauce, brown sugar). Reserve 1 cup, marinate chicken in rest for 30 mins.",
        "Cook rice: 1 cup rice + 1.25 cups water, simmer covered 12-15 mins.",
        "Sear chicken in oil 5-6 mins per side until charred and 160°F. Rest and slice.",
        "Heat reserved sauce, whisk in cornstarch slurry (1 tbsp + 1 tbsp water), cook until thick. Stir in vinegar.",
        "Microwave broccoli with 2 tbsp water for 2-4 mins. Serve chicken over rice with broccoli and teriyaki sauce.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "thai-basil-fried-rice",
      user_id: GUEST_USER_ID,
      name: "Thai Basil Fried Rice",
      category: "chicken",
      servings: 4,
      favorite: true,
      tags: [],
      ingredients: [
        { item: "cooked jasmine rice", unit: "cups", amount: 4 },
        { item: "sesame oil", unit: "tbsp", amount: 2 },
        { item: "eggs", unit: "large", amount: 2 },
        { item: "onion", unit: "small", amount: 1 },
        { item: "garlic", unit: "cloves", amount: 4 },
        { item: "poblano pepper", unit: "whole", amount: 1 },
        { item: "chicken breast", unit: "whole", amount: 1 },
        { item: "soy sauce", unit: "tbsp", amount: 3 },
        { item: "oyster sauce", unit: "tbsp", amount: 2 },
        { item: "fish sauce", unit: "tbsp", amount: 1 },
        { item: "sugar", unit: "tsp", amount: 1 },
        { item: "thai basil", unit: "cup", amount: 1 },
        { item: "lime", unit: "whole", amount: 1 },
      ],
      instructions: [
        "Mix soy sauce, oyster sauce, fish sauce, and sugar for sauce.",
        "Scramble eggs in hot wok, remove and set aside.",
        "Sauté butterflied chicken until cooked, remove.",
        "Stir-fry onion, garlic, and peppers for 1 min.",
        "Add rice and sauce, stir-fry 2-3 mins on high heat.",
        "Add back eggs and chicken. Toss in Thai basil until wilted. Serve with lime.",
      ],
      created_at: now,
      updated_at: now,
    },
    {
      id: "turkey-burger",
      user_id: GUEST_USER_ID,
      name: "Turkey Burger",
      category: "turkey",
      servings: 4,
      favorite: false,
      tags: [],
      ingredients: [
        { item: "ground turkey", unit: "lb", amount: 1 },
        { item: "breadcrumbs", unit: "cup", amount: 0.25 },
        { item: "egg", unit: "large", amount: 1 },
        { item: "mayonnaise", unit: "tbsp", amount: 2 },
        { item: "garlic", unit: "clove", amount: 1 },
        { item: "scallions", unit: "cup", amount: 0.25 },
        { item: "feta cheese", unit: "cup", amount: 0.33 },
        { item: "oregano", unit: "tsp", amount: 0.5 },
        { item: "paprika", unit: "tsp", amount: 0.5 },
        { item: "cumin", unit: "tsp", amount: 0.5 },
        { item: "burger buns", unit: "whole", amount: 4 },
        { item: "tomato", unit: "whole", amount: 1 },
        { item: "avocado", unit: "whole", amount: 1 },
        { item: "red onion", unit: "whole", amount: 0.5 },
      ],
      instructions: [
        "Mix ground turkey with breadcrumbs, egg, mayo, garlic, scallions, parsley, feta, and seasonings.",
        "Form into 4 patties.",
        "Grill or pan-fry until cooked through (165°F internal).",
        "Serve on buns with tomato, avocado, and red onion.",
      ],
      created_at: now,
      updated_at: now,
    },
  ]
}

export function getDefaultConfig() {
  return {
    user_id: GUEST_USER_ID,
    categories: ["chicken", "beef", "turkey", "lamb", "vegetarian"],
    default_selection: { chicken: 2, beef: 1, turkey: 1, lamb: 1, vegetarian: 1 },
    excluded_keywords: [] as string[],
    history_exclusion_days: 7,
    week_start_day: 1,
    category_overrides: {} as Record<string, string>,
    custom_categories: [] as { id: string; name: string; order: number }[],
    category_order: null as string[] | null,
  }
}

export function getDefaultShoppingList() {
  return {
    user_id: GUEST_USER_ID,
    items: [] as ShoppingItem[],
    already_have: [] as ShoppingItem[],
    excluded: [] as ShoppingItem[],
    source_recipes: [] as string[],
    scale: 1,
    total_servings: 0,
    custom_order: false,
    generated_at: new Date().toISOString(),
  }
}
