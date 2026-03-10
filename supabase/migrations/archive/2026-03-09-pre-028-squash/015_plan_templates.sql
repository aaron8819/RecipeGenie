-- Plan Templates: save/load reusable meal plan templates
CREATE TABLE IF NOT EXISTS plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  day_assignments JSONB DEFAULT NULL,
  category_selection JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plan_templates_user_id ON plan_templates(user_id);
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_own_templates ON plan_templates;
CREATE POLICY users_own_templates ON plan_templates
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_plan_templates_updated_at ON plan_templates;
CREATE TRIGGER update_plan_templates_updated_at
  BEFORE UPDATE ON plan_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
