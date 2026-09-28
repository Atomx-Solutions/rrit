-- The monthly planner now snapshots Business Brain: the verified facts, the
-- active voice version, the audiences, the active offers and the guardrails.
-- The worker login is not BYPASSRLS and had neither a grant nor a policy on
-- those tables, so the planner stopped at advance.evidence with
-- "permission denied for table brand_facts".
--
-- Read-only, matching the brands grant the planner already relies on. Tenant
-- writes stay with the runtime role: the worker must never edit what the
-- business declared about itself.
DO $$
DECLARE
  brain_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  FOREACH brain_table IN ARRAY ARRAY[
    'brand_facts',
    'brand_voice_versions',
    'brand_audiences',
    'brand_offers',
    'brand_guardrails'
  ] LOOP
    EXECUTE format('GRANT SELECT ON %I TO rrit_worker', brain_table);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM rrit_worker', brain_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'rrit_worker_' || brain_table || '_read', brain_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO rrit_worker USING (true)',
      'rrit_worker_' || brain_table || '_read',
      brain_table
    );
  END LOOP;
END
$$;
