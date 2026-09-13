-- Trial identity hashes must be compared globally to prevent repeated trials,
-- but writes are restricted to the tenant context of the current request.
ALTER TABLE trial_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trial_claims_runtime_read ON trial_claims;
CREATE POLICY trial_claims_runtime_read ON trial_claims
  FOR SELECT TO app_runtime
  USING (true);

DROP POLICY IF EXISTS trial_claims_runtime_insert ON trial_claims;
CREATE POLICY trial_claims_runtime_insert ON trial_claims
  FOR INSERT TO app_runtime
  WITH CHECK (business_id = app.current_organization_id());
