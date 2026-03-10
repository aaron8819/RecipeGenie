-- Add onboarding completion timestamp for user-scoped onboarding
ALTER TABLE public.user_config
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ DEFAULT NULL;
