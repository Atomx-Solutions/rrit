-- "Improve with AI" on the sign-up brief is free, before the business (and its
-- credits) exists, so each person gets ONBOARDING_AI_IMPROVEMENTS of them in
-- total. This counts how many they have used.
CREATE TABLE public.onboarding_ai_usage (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.onboarding_ai_usage TO app_runtime;
ALTER TABLE public.onboarding_ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY onboarding_ai_usage_own ON public.onboarding_ai_usage FOR ALL TO app_runtime
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());
