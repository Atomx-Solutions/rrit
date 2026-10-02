-- `generate_count` accumulates across requests, so it answers "how much of the
-- package has been asked for", not "how much is running now". Asking for one
-- post after one was already made showed "1 / 2": a truthful total of the plan,
-- but not of the work the customer just started.
--
-- `batch_start` marks how much was already produced when the current request
-- was made, so the panel can report the running batch on its own.

ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS batch_start integer NOT NULL DEFAULT 0;

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_batch_start_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_batch_start_check
    CHECK (batch_start >= 0 AND batch_start <= generate_count);
