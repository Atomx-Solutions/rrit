-- HTTP 402/429 and authentication failures are explicit provider rejections,
-- not ambiguous network outcomes. Record them without reserving spent budget so
-- the same idempotent stage can be retried after configuration or credit changes.
ALTER TABLE public.monthly_ai_runs
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.monthly_ai_runs
  DROP CONSTRAINT IF EXISTS monthly_ai_runs_status_check;

ALTER TABLE public.monthly_ai_runs
  ADD CONSTRAINT monthly_ai_runs_status_check
    CHECK (status IN ('reserved','completed','uncertain','failed')),
  ADD CONSTRAINT monthly_ai_runs_retry_count_check
    CHECK (retry_count >= 0),
  ADD CONSTRAINT monthly_ai_runs_error_code_check
    CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 100);

-- Reclassify known deterministic failures that were conservatively recorded as
-- uncertain before this migration. Generic uncertain calls remain untouched.
UPDATE public.monthly_ai_runs r
SET status = 'failed',
    error_code = p.error_code,
    actual_cost_micro_eur = 0,
    completed_at = COALESCE(r.completed_at, p.updated_at)
FROM public.monthly_plans p
WHERE r.plan_id = p.id
  AND r.business_id = p.business_id
  AND r.status = 'uncertain'
  AND p.error_code IN ('PROVIDER_CREDIT_REQUIRED','PROVIDER_RATE_LIMITED','CONFIGURATION_REQUIRED')
  AND r.created_at = (
    SELECT max(candidate.created_at)
    FROM public.monthly_ai_runs candidate
    WHERE candidate.plan_id = r.plan_id
      AND candidate.business_id = r.business_id
      AND candidate.status = 'uncertain'
  );
