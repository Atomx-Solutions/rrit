-- The monthly planner worker resolves the active brand, its plan and its
-- style snapshot before the monthly page-style fetch (PRC-01/PRC-04). It only
-- reads brands; tenant writes remain limited to the runtime role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  GRANT SELECT ON brands TO rrit_worker;
  DROP POLICY IF EXISTS brands_worker_read ON brands;
  CREATE POLICY brands_worker_read ON brands FOR SELECT TO rrit_worker USING (true);
END
$$;
