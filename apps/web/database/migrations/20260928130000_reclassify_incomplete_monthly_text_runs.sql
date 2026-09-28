-- A historical provider response can carry `status: incomplete` even when an
-- older worker recorded the ledger row as completed. These are text-only
-- stages; image response JSON intentionally has no top-level status field.
-- Keep the recorded cost intact: the provider call did happen.
UPDATE public.monthly_ai_runs
SET status = 'failed',
    error_code = 'PROVIDER_INCOMPLETE',
    completed_at = COALESCE(completed_at, now())
WHERE status = 'completed'
  AND stage_key ~ '^(research|planning|content|quality|style):'
  AND result ? 'status'
  AND result->>'status' <> 'completed';
