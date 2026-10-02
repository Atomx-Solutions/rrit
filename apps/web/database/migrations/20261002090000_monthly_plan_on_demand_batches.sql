-- Posts are drawn from a package on the customer's own rhythm: one today, two
-- tomorrow. Previously `target_count` meant both "slots this month has" and
-- "posts to produce now", so a finished plan could only be extended by a reset,
-- which deleted the drafts and paid for the research and the strategy again.
--
-- The two meanings are split. `target_count` stays the month's quota, and
-- `generate_count` is how much of it the customer has asked for so far. A plan
-- whose requested work is done but whose quota remains goes to 'idle' and waits,
-- keeping its research and its drafts.

ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS generate_count integer NOT NULL DEFAULT 0;

-- Plans created before this migration produced their whole target in one run,
-- so everything they targeted was also requested.
UPDATE public.monthly_plans SET generate_count = target_count WHERE generate_count = 0;

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_generate_count_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_generate_count_check
    CHECK (generate_count >= 0 AND generate_count <= target_count);

-- Produced work can never exceed requested work; requested work is itself
-- capped at the month's quota above.
ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_completed_within_requested;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_completed_within_requested
    CHECK (completed_count <= generate_count);

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_status_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_status_check
    CHECK (status IN ('queued','running','review','blocked','cancelled','idle'));
