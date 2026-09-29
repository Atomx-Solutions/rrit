ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS planning_retry_nonce integer NOT NULL DEFAULT 0
  CHECK (planning_retry_nonce >= 0);
