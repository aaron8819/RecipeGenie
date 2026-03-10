-- Normalize legacy default category taxonomy from "steak" to canonical "beef".
-- Scope is intentionally narrow: only known legacy default payload shapes are updated.
-- This migration is idempotent.

-- Legacy app defaults persisted in some user_config rows:
-- categories: ["chicken","turkey","steak","beef","lamb","vegetarian"]
-- default_selection: {"chicken":2,"turkey":1,"steak":1}
-- category_order: ["chicken","turkey","steak","beef","lamb","vegetarian"]

UPDATE public.user_config
SET categories = ARRAY['chicken', 'beef', 'turkey', 'lamb', 'vegetarian']::text[]
WHERE categories = ARRAY['chicken', 'turkey', 'steak', 'beef', 'lamb', 'vegetarian']::text[];

UPDATE public.user_config
SET default_selection = (default_selection - 'steak') || jsonb_build_object('beef', default_selection->'steak')
WHERE default_selection IS NOT NULL
  AND default_selection ? 'steak'
  AND NOT (default_selection ? 'beef')
  AND (
    SELECT bool_and(k IN ('chicken', 'turkey', 'lamb', 'vegetarian', 'steak'))
    FROM jsonb_object_keys(default_selection) AS t(k)
  );

UPDATE public.user_config
SET category_order = '["chicken","beef","turkey","lamb","vegetarian"]'::jsonb
WHERE category_order = '["chicken","turkey","steak","beef","lamb","vegetarian"]'::jsonb;

UPDATE public.user_config
SET enabled_planner_categories = ARRAY['chicken', 'beef', 'turkey', 'lamb', 'vegetarian']::text[]
WHERE enabled_planner_categories = ARRAY['chicken', 'turkey', 'steak', 'beef', 'lamb', 'vegetarian']::text[];
