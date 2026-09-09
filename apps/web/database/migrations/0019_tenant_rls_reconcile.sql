-- Reconcile tenant RLS without editing the already-applied 0018 migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE CREATE ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO PUBLIC;
GRANT USAGE ON SCHEMA app TO app_runtime;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO app_runtime;
GRANT EXECUTE ON FUNCTION app.current_organization_id() TO app_runtime;

DO $$
DECLARE
  tenant_schema text := current_schema();
  table_name text;
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_runtime', tenant_schema);
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_runtime',
    tenant_schema
  );
  EXECUTE format(
    'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO app_runtime',
    tenant_schema
  );
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM app_runtime', tenant_schema);

  ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS businesses_tenant_access ON businesses;
  CREATE POLICY businesses_tenant_access ON businesses
    FOR ALL TO app_runtime
    USING (
      owner_id = app.current_user_id()
      AND (
        app.current_organization_id() IS NULL
        OR id = app.current_organization_id()
      )
    )
    WITH CHECK (
      owner_id = app.current_user_id()
      AND (
        app.current_organization_id() IS NULL
        OR id = app.current_organization_id()
      )
    );

  FOREACH table_name IN ARRAY ARRAY[
    'posts',
    'assets',
    'audit_events',
    'trial_grants',
    'entitlements',
    'meta_connections',
    'social_posts',
    'post_validations',
    'publication_jobs',
    'post_content_versions',
    'post_approval_records',
    'ai_daily_usage',
    'ai_generations',
    'ai_cost_ledger',
    'publication_attempts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_access', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO app_runtime USING (business_id = app.current_organization_id()) WITH CHECK (business_id = app.current_organization_id())',
      table_name || '_tenant_access',
      table_name
    );
  END LOOP;

  ALTER TABLE meta_oauth_states ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS meta_oauth_states_tenant_access ON meta_oauth_states;
  CREATE POLICY meta_oauth_states_tenant_access ON meta_oauth_states
    FOR ALL TO app_runtime
    USING (
      user_id = app.current_user_id()
      AND (
        app.current_organization_id() IS NULL
        OR business_id = app.current_organization_id()
      )
    )
    WITH CHECK (
      user_id = app.current_user_id()
      AND business_id = app.current_organization_id()
    );
END
$$;

DO $$
BEGIN
  IF to_regclass('app_settings') IS NOT NULL THEN
    GRANT SELECT ON app_settings TO app_runtime;
  END IF;
  IF to_regclass('plan_catalog') IS NOT NULL THEN
    GRANT SELECT ON plan_catalog TO app_runtime;
  END IF;
  IF to_regclass('schema_migrations') IS NOT NULL THEN
    GRANT SELECT ON schema_migrations TO app_runtime;
  END IF;
END
$$;
