-- Recipe Genie: Fix Signup Trigger
-- Makes the signup trigger more robust and handles errors gracefully

-- ============================================================================
-- IMPROVE TRIGGER FUNCTION WITH ERROR HANDLING
-- ============================================================================

-- Function that gets called when a new user signs up
-- Now with better error handling and explicit search_path
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Try to insert default recipes, but don't fail the user creation if it fails
  BEGIN
    PERFORM insert_default_recipes_for_user(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Log the error but don't fail the transaction
    -- This allows the user to be created even if default recipes fail
    RAISE WARNING 'Failed to create default recipes for user %: %', NEW.id, SQLERRM;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ENSURE insert_default_recipes_for_user HAS PROPER PERMISSIONS
-- ============================================================================

-- Update the function to explicitly set search_path and handle errors
CREATE OR REPLACE FUNCTION insert_default_recipes_for_user(p_user_id UUID)
RETURNS void 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 4-Ingredient Mac & Cheese
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'mac-and-cheese-' || p_user_id,
    p_user_id,
    '4-Ingredient Mac & Cheese',
    'vegetarian',
    4,
    false,
    ARRAY[]::text[],
    '[
      {"item": "chicken broth", "unit": "cups", "amount": 2},
      {"item": "elbow noodles", "unit": "oz", "amount": 8},
      {"item": "evaporated milk", "unit": "oz", "amount": 8},
      {"item": "cheddar cheese", "unit": "oz", "amount": 8}
    ]'::jsonb,
    ARRAY[
      'Bring broth to boil in large pan, add noodles.',
      'Cook 3 mins less than package directions, stirring to release starches.',
      'Lower heat, stir in evaporated milk. Simmer until 1/3 milk remains.',
      'Remove from heat, stir in grated cheese until smooth. Serve immediately.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Beef and Broccoli
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'beef-and-broccoli-' || p_user_id,
    p_user_id,
    'Beef and Broccoli',
    'beef',
    4,
    true,
    ARRAY[]::text[],
    '[
      {"item": "beef sirloin", "unit": "lb", "amount": 1},
      {"item": "broccoli florets", "unit": "cups", "amount": 3},
      {"item": "olive oil", "unit": "tbsp", "amount": 2},
      {"item": "soy sauce", "unit": "tbsp", "amount": 6},
      {"item": "cornstarch", "unit": "tbsp", "amount": 2},
      {"item": "brown sugar", "unit": "tbsp", "amount": 2},
      {"item": "oyster sauce", "unit": "tbsp", "amount": 2},
      {"item": "rice vinegar", "unit": "tbsp", "amount": 1},
      {"item": "garlic", "unit": "cloves", "amount": 3},
      {"item": "ginger", "unit": "tbsp", "amount": 1},
      {"item": "rice", "unit": "cups", "amount": 2}
    ]'::jsonb,
    ARRAY[
      'Slice beef thin against the grain. Toss with 2 tbsp soy sauce and 1 tbsp cornstarch. Marinate 10 mins.',
      'Blanch broccoli 2 mins, transfer to ice water.',
      'Mix remaining soy sauce, brown sugar, oyster sauce, vinegar, garlic, ginger for sauce.',
      'Sear beef in hot oil 1-2 mins per side, set aside.',
      'Stir-fry broccoli 2 mins, return beef, pour in sauce.',
      'Add cornstarch slurry (1 tbsp cornstarch + 2 tbsp water) to thicken. Serve over rice.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Lamb Meatball Gyros
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'lamb-meatballs-gyros-' || p_user_id,
    p_user_id,
    'Lamb Meatball Gyros',
    'lamb',
    4,
    false,
    ARRAY[]::text[],
    '[
      {"item": "cucumber", "unit": "large", "amount": 0.5},
      {"item": "greek yogurt", "unit": "cups", "amount": 2},
      {"item": "garlic", "unit": "cloves", "amount": 3},
      {"item": "lemon", "unit": "whole", "amount": 1.5},
      {"item": "olive oil", "unit": "tbsp", "amount": 2},
      {"item": "panko breadcrumbs", "unit": "cup", "amount": 0.25},
      {"item": "milk", "unit": "cup", "amount": 0.25},
      {"item": "ground lamb", "unit": "lb", "amount": 1},
      {"item": "yellow onion", "unit": "medium", "amount": 0.5},
      {"item": "fresh mint", "unit": "tbsp", "amount": 3},
      {"item": "egg", "unit": "large", "amount": 1},
      {"item": "oregano", "unit": "tsp", "amount": 1},
      {"item": "cumin", "unit": "tsp", "amount": 1},
      {"item": "coriander", "unit": "tsp", "amount": 1},
      {"item": "pita bread", "unit": "whole", "amount": 4},
      {"item": "tomato", "unit": "whole", "amount": 1},
      {"item": "red onion", "unit": "whole", "amount": 0.25}
    ]'::jsonb,
    ARRAY[
      'Make tzatziki: mix grated cucumber, yogurt, garlic, lemon juice, olive oil, salt.',
      'Soak panko in milk 10 mins. Mix with lamb, onion, garlic, mint, egg, lemon zest, oregano, cumin, coriander, salt, pepper.',
      'Form into 2 tbsp meatballs, flatten slightly. Pan-fry in oil 2-3 mins per side until 165°F.',
      'Toast pitas lightly with oil on both sides.',
      'Spread tzatziki on pita, add 3-4 meatballs, sliced veggies, more tzatziki. Enjoy!'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Mediterranean Meatballs (Turkey)
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'mediterranean-turkey-meatballs-' || p_user_id,
    p_user_id,
    'Mediterranean Meatballs',
    'turkey',
    4,
    true,
    ARRAY[]::text[],
    '[
      {"item": "ground turkey", "unit": "lb", "amount": 1},
      {"item": "feta cheese", "unit": "oz", "amount": 4},
      {"item": "spinach", "unit": "cup", "amount": 0.5},
      {"item": "red onion", "unit": "small", "amount": 0.5},
      {"item": "garlic", "unit": "cloves", "amount": 4},
      {"item": "fresh mint", "unit": "tsp", "amount": 1},
      {"item": "sun dried tomatoes", "unit": "tbsp", "amount": 2},
      {"item": "panko breadcrumbs", "unit": "cup", "amount": 0.25},
      {"item": "egg", "unit": "large", "amount": 1},
      {"item": "mayonnaise", "unit": "tbsp", "amount": 1},
      {"item": "cumin", "unit": "tsp", "amount": 0.5},
      {"item": "oregano", "unit": "tsp", "amount": 0.5},
      {"item": "paprika", "unit": "tsp", "amount": 0.5}
    ]'::jsonb,
    ARRAY[
      'Mix ground turkey with crumbled feta, chopped spinach, red onion, garlic, mint, sun dried tomatoes.',
      'Add panko, egg, mayo, cumin, oregano, paprika, salt, pepper. Mix gently.',
      'Form into meatballs and place on baking sheet.',
      'Roast at 425°F for 20 mins (17 mins convection), flipping halfway.',
      'Serve with tzatziki, rice, or in pita.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Mexican Street Tacos (Chicken)
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'mexican-street-tacos-chicken-' || p_user_id,
    p_user_id,
    'Mexican Street Tacos',
    'chicken',
    4,
    true,
    ARRAY[]::text[],
    '[
      {"item": "chicken thighs", "unit": "lbs", "amount": 1.5},
      {"item": "orange juice", "unit": "tbsp", "amount": 4},
      {"item": "apple cider vinegar", "unit": "tbsp", "amount": 2},
      {"item": "lime", "unit": "tbsp", "amount": 1.5},
      {"item": "garlic", "unit": "cloves", "amount": 3},
      {"item": "chipotle chili powder", "unit": "tbsp", "amount": 1.5},
      {"item": "mexican oregano", "unit": "tsp", "amount": 2},
      {"item": "paprika", "unit": "tsp", "amount": 2},
      {"item": "cinnamon", "unit": "tsp", "amount": 0.25},
      {"item": "cotija cheese", "unit": "cup", "amount": 0.5},
      {"item": "corn tortillas", "unit": "whole", "amount": 12}
    ]'::jsonb,
    ARRAY[
      'Mix marinade: orange juice, vinegar, lime juice, garlic, chipotle powder, oregano, paprika, cinnamon, salt, pepper.',
      'Marinate chicken thighs at least 1 hour or overnight.',
      'Grill over medium-high heat 4-5 mins per side until 165°F.',
      'Rest a few minutes, then chop into small pieces.',
      'Serve in tortillas with cotija cheese, roasted corn, pico, and guacamole.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Teriyaki Chicken and Broccoli Rice Bowls
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'teriyaki-chicken-broccoli-bowls-' || p_user_id,
    p_user_id,
    'Teriyaki Chicken and Broccoli Rice Bowls',
    'chicken',
    4,
    true,
    ARRAY[]::text[],
    '[
      {"item": "chicken thighs", "unit": "lbs", "amount": 1.5},
      {"item": "garlic", "unit": "cloves", "amount": 2},
      {"item": "ginger", "unit": "tsp", "amount": 2},
      {"item": "water", "unit": "cup", "amount": 1},
      {"item": "soy sauce", "unit": "cup", "amount": 0.25},
      {"item": "brown sugar", "unit": "cup", "amount": 0.25},
      {"item": "jasmine rice", "unit": "cup", "amount": 1},
      {"item": "avocado oil", "unit": "tsp", "amount": 2},
      {"item": "cornstarch", "unit": "tbsp", "amount": 1},
      {"item": "white vinegar", "unit": "tsp", "amount": 1},
      {"item": "broccoli florets", "unit": "cups", "amount": 2}
    ]'::jsonb,
    ARRAY[
      'Mix sauce ingredients (garlic, ginger, water, soy sauce, brown sugar). Reserve 1 cup, marinate chicken in rest for 30 mins.',
      'Cook rice: 1 cup rice + 1.25 cups water, simmer covered 12-15 mins.',
      'Sear chicken in oil 5-6 mins per side until charred and 160°F. Rest and slice.',
      'Heat reserved sauce, whisk in cornstarch slurry (1 tbsp + 1 tbsp water), cook until thick. Stir in vinegar.',
      'Microwave broccoli with 2 tbsp water for 2-4 mins. Serve chicken over rice with broccoli and teriyaki sauce.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Thai Basil Fried Rice
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'thai-basil-fried-rice-' || p_user_id,
    p_user_id,
    'Thai Basil Fried Rice',
    'chicken',
    4,
    true,
    ARRAY[]::text[],
    '[
      {"item": "cooked jasmine rice", "unit": "cups", "amount": 4},
      {"item": "sesame oil", "unit": "tbsp", "amount": 2},
      {"item": "eggs", "unit": "large", "amount": 2},
      {"item": "onion", "unit": "small", "amount": 1},
      {"item": "garlic", "unit": "cloves", "amount": 4},
      {"item": "poblano pepper", "unit": "whole", "amount": 1},
      {"item": "chicken breast", "unit": "whole", "amount": 1},
      {"item": "soy sauce", "unit": "tbsp", "amount": 3},
      {"item": "oyster sauce", "unit": "tbsp", "amount": 2},
      {"item": "fish sauce", "unit": "tbsp", "amount": 1},
      {"item": "sugar", "unit": "tsp", "amount": 1},
      {"item": "thai basil", "unit": "cup", "amount": 1},
      {"item": "lime", "unit": "whole", "amount": 1}
    ]'::jsonb,
    ARRAY[
      'Mix soy sauce, oyster sauce, fish sauce, and sugar for sauce.',
      'Scramble eggs in hot wok, remove and set aside.',
      'Sauté butterflied chicken until cooked, remove.',
      'Stir-fry onion, garlic, and peppers for 1 min.',
      'Add rice and sauce, stir-fry 2-3 mins on high heat.',
      'Add back eggs and chicken. Toss in Thai basil until wilted. Serve with lime.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Turkey Burger
  INSERT INTO recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES (
    'turkey-burger-' || p_user_id,
    p_user_id,
    'Turkey Burger',
    'turkey',
    4,
    false,
    ARRAY[]::text[],
    '[
      {"item": "ground turkey", "unit": "lb", "amount": 1},
      {"item": "breadcrumbs", "unit": "cup", "amount": 0.25},
      {"item": "egg", "unit": "large", "amount": 1},
      {"item": "mayonnaise", "unit": "tbsp", "amount": 2},
      {"item": "garlic", "unit": "clove", "amount": 1},
      {"item": "scallions", "unit": "cup", "amount": 0.25},
      {"item": "feta cheese", "unit": "cup", "amount": 0.33},
      {"item": "oregano", "unit": "tsp", "amount": 0.5},
      {"item": "paprika", "unit": "tsp", "amount": 0.5},
      {"item": "cumin", "unit": "tsp", "amount": 0.5},
      {"item": "burger buns", "unit": "whole", "amount": 4},
      {"item": "tomato", "unit": "whole", "amount": 1},
      {"item": "avocado", "unit": "whole", "amount": 1},
      {"item": "red onion", "unit": "whole", "amount": 0.5}
    ]'::jsonb,
    ARRAY[
      'Mix ground turkey with breadcrumbs, egg, mayo, garlic, scallions, parsley, feta, and seasonings.',
      'Form into 4 patties.',
      'Grill or pan-fry until cooked through (165°F internal).',
      'Serve on buns with tomato, avocado, and red onion.'
    ]
  ) ON CONFLICT DO NOTHING;

  -- Create default user_config for the new user
  INSERT INTO user_config (user_id, categories, default_selection, excluded_keywords, history_exclusion_days, week_start_day, category_overrides)
  VALUES (
    p_user_id,
    ARRAY['chicken', 'beef', 'turkey', 'lamb', 'vegetarian'],
    '{"chicken": 2, "beef": 1, "turkey": 1, "lamb": 1, "vegetarian": 1}'::jsonb,
    ARRAY[]::text[],
    7,
    1,
    '{}'::jsonb
  ) ON CONFLICT DO NOTHING;

  -- Create empty shopping list for new user
  INSERT INTO shopping_list (user_id, items, already_have, excluded, source_recipes, scale, total_servings, custom_order)
  VALUES (
    p_user_id,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    ARRAY[]::text[],
    1.0,
    0,
    false
  ) ON CONFLICT DO NOTHING;

END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to ensure it's using the updated function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();
