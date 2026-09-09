-- Adjust the original proposed volume offer without repricing customized/live offers.
-- Existing entitlement snapshots remain unchanged; new selections use version 2.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
UPDATE plan_catalog
SET monthly_cents = 6900, version = version + 1
WHERE name = 'Më shumë'
  AND version = 1
  AND monthly_cents = 7900
  AND currency = 'EUR'
  AND (limits->>'posts_per_month')::integer = 60
  AND purchasable = false;
