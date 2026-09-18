-- PRC-02: monthly/annual subscriptions and package changes. The annual price
-- is monthly_cents x 12 x (100 - plans.annual_discount_percent) / 100.

-- price_cents snapshots what one billing period costs at activation time.
-- A downgrade is scheduled in pending_plan_code and takes effect at the next
-- monthly credit refresh; an upgrade changes plan_code immediately.
ALTER TABLE subscriptions
  ADD COLUMN price_cents integer CHECK (price_cents >= 0),
  ADD COLUMN pending_plan_code text REFERENCES plans(code) ON DELETE RESTRICT;

-- The maintenance worker refreshes monthly credits, applies scheduled
-- downgrades and expires subscriptions whose paid period has ended.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT UPDATE ON subscriptions TO rrit_worker;
  CREATE POLICY subscriptions_worker_update ON subscriptions
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
END
$$;
