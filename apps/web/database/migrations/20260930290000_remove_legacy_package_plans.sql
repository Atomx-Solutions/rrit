-- Follow-up to 20260930280000: production had renamed the legacy pako-1/2/3
-- rows to package-1/2/3, so a separate migration drops those. Same defensive
-- pattern — if any subscription still references them, it aborts.

BEGIN;

DO $$
DECLARE
  legacy_codes text[] := ARRAY['package-1', 'package-2', 'package-3'];
  referencing integer;
BEGIN
  SELECT COUNT(*) INTO referencing
    FROM subscriptions
   WHERE plan_code = ANY(legacy_codes)
      OR pending_plan_code = ANY(legacy_codes);

  IF referencing > 0 THEN
    RAISE EXCEPTION
      'Cannot drop legacy package plans: % subscription(s) still reference package-1/2/3. Migrate or cancel them first.',
      referencing;
  END IF;

  DELETE FROM plans WHERE code = ANY(legacy_codes);
END $$;

COMMIT;
