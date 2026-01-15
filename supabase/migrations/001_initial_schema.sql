-- Recipe Genie: Initial Schema
-- Run this in Supabase SQL Editor or via CLI

-- ============================================================================
-- RECIPES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 4,
  favorite BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',
  ingredients JSONB NOT NULL DEFAULT '[]',
  instructions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);

-- Index for favorites filtering
CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON recipes(favorite) WHERE favorite = TRUE;

-- ============================================================================
-- PANTRY ITEMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS pantry_items (
  item TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- USER CONFIG TABLE (single row)
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  categories TEXT[] DEFAULT ARRAY['chicken', 'turkey', 'steak'],
  default_selection JSONB DEFAULT '{"chicken": 2, "turkey": 1, "steak": 1}',
  excluded_keywords TEXT[] DEFAULT '{}',
  history_exclusion_days INTEGER DEFAULT 7,
  week_start_day INTEGER DEFAULT 1
);

-- Insert default config row if not exists
INSERT INTO user_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RECIPE HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS recipe_history (
  id SERIAL PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  date_made TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_history_recipe ON recipe_history(recipe_id);
CREATE INDEX IF NOT EXISTS idx_history_date ON recipe_history(date_made DESC);

-- ============================================================================
-- WEEKLY PLANS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS weekly_plans (
  week_date DATE PRIMARY KEY,
  recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  scale NUMERIC DEFAULT 1.0,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- SHOPPING LIST TABLE (single row, persisted state)
-- ============================================================================
CREATE TABLE IF NOT EXISTS shopping_list (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  items JSONB DEFAULT '[]',
  already_have JSONB DEFAULT '[]',
  excluded JSONB DEFAULT '[]',
  source_recipes TEXT[] DEFAULT '{}',
  scale NUMERIC DEFAULT 1.0,
  total_servings INTEGER DEFAULT 0,
  custom_order BOOLEAN DEFAULT FALSE,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default shopping list row if not exists
INSERT INTO shopping_list (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- Protects data even if anon key is exposed
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "authenticated_full_access" ON recipes
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON pantry_items
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON user_config
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON recipe_history
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON weekly_plans
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "authenticated_full_access" ON shopping_list
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for recipes table
DROP TRIGGER IF EXISTS update_recipes_updated_at ON recipes;
CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
