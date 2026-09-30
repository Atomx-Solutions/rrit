-- Remove the legacy three-package template rows (pako-1/2/3). Packages are now
-- custom per organization; only the trial row stays because trial_grants and
-- new signups still reference plans.code = 'free-trial'.
--
-- The migration is defensive: if any subscription still references these
-- codes, it aborts with a clear error rather than silently orphaning data.

BEGIN;

DO $$
DECLARE
  legacy_codes text[] := ARRAY['pako-1', 'pako-2', 'pako-3'];
  referencing integer;
BEGIN
  SELECT COUNT(*) INTO referencing
    FROM subscriptions
   WHERE plan_code = ANY(legacy_codes)
      OR pending_plan_code = ANY(legacy_codes);

  IF referencing > 0 THEN
    RAISE EXCEPTION
      'Cannot drop legacy pako plans: % subscription(s) still reference pako-1/2/3. Migrate or cancel them first.',
      referencing;
  END IF;

  DELETE FROM plans WHERE code = ANY(legacy_codes);
END $$;

COMMIT;
