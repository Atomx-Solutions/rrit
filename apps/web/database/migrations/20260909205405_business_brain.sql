-- Server-owned fact provenance. Client roles have no direct Data API access.
ALTER FUNCTION app.current_user_id() SET search_path = pg_catalog;
ALTER FUNCTION app.current_organization_id() SET search_path = pg_catalog;
ALTER FUNCTION reject_immutable_record_change() SET search_path = pg_catalog;
CREATE INDEX monthly_ai_runs_plan_tenant ON monthly_ai_runs(plan_id,business_id);
CREATE INDEX posts_monthly_plan_tenant_idx ON posts(monthly_plan_id,business_id);
CREATE TABLE business_facts (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 100),
  text text NOT NULL CHECK (length(text) <= 1000),
  source text NOT NULL CHECK (length(source) <= 500),
  kind text NOT NULL CHECK (kind IN ('fact','offer')),
  status text NOT NULL CHECK (status IN ('proposed','verified','rejected','archived')),
  valid_from date,
  valid_until date,
  amount_cents integer CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency text CHECK (currency = 'EUR'),
  origin text NOT NULL CHECK (origin IN ('user','social','research')),
  confidence numeric CHECK (confidence BETWEEN 0 AND 1),
  verified_by uuid,
  verified_at timestamptz,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,id),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),
  CHECK (amount_cents IS NULL OR currency IS NOT NULL),
  CHECK (status <> 'verified' OR (length(trim(text)) > 0 AND length(trim(source)) > 0)),
  CHECK (status <> 'verified' OR kind <> 'offer' OR (valid_from IS NOT NULL AND valid_until IS NOT NULL))
);
CREATE TABLE business_brain_versions (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id,version)
);
CREATE TRIGGER business_brain_versions_immutable BEFORE UPDATE ON business_brain_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
-- Legacy profiles remain canonical JSON until their next authenticated save.
-- Do not invent historical confirmation timestamps or claim independent review.
INSERT INTO business_brain_versions(business_id,version,snapshot)
  SELECT id,1,state->'brand' FROM businesses WHERE jsonb_typeof(state->'brand')='object';
ALTER TABLE business_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_brain_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_access ON business_facts FOR ALL TO app_runtime
  USING (business_id = app.current_organization_id()) WITH CHECK (business_id = app.current_organization_id());
CREATE POLICY tenant_read ON business_brain_versions FOR SELECT TO app_runtime
  USING (business_id = app.current_organization_id());
CREATE POLICY tenant_append ON business_brain_versions FOR INSERT TO app_runtime
  WITH CHECK (business_id = app.current_organization_id());
REVOKE ALL ON business_facts,business_brain_versions FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON business_facts TO app_runtime;
GRANT SELECT,INSERT ON business_brain_versions TO app_runtime;
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=client_role) THEN
      EXECUTE format('REVOKE ALL ON business_facts,business_brain_versions FROM %I',client_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rrit_worker') THEN
    GRANT SELECT ON business_facts,business_brain_versions TO rrit_worker;
  END IF;
END $$;
