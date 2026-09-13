-- Protect global reference and operational tables in Supabase's exposed
-- public schema. Only the server-side runtime and worker roles receive the
-- operations required by the application.
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_consumptions ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE ON schema_migrations, post_templates, app_settings, plan_catalog
  FROM app_runtime;
REVOKE INSERT, UPDATE, DELETE ON worker_heartbeats FROM app_runtime;
REVOKE DELETE ON outbox_messages FROM app_runtime;
REVOKE ALL PRIVILEGES ON outbox_consumptions, maintenance_runs FROM app_runtime;
REVOKE UPDATE, DELETE ON trial_claims FROM app_runtime;

GRANT SELECT ON schema_migrations, post_templates, app_settings, plan_catalog, worker_heartbeats
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON outbox_messages TO app_runtime;
GRANT SELECT, INSERT ON trial_claims TO app_runtime;

DROP POLICY IF EXISTS app_runtime_schema_migrations_read ON schema_migrations;
CREATE POLICY app_runtime_schema_migrations_read ON schema_migrations
  FOR SELECT TO app_runtime USING (true);

DROP POLICY IF EXISTS app_runtime_post_templates_read ON post_templates;
CREATE POLICY app_runtime_post_templates_read ON post_templates
  FOR SELECT TO app_runtime USING (true);

DROP POLICY IF EXISTS app_runtime_app_settings_read ON app_settings;
CREATE POLICY app_runtime_app_settings_read ON app_settings
  FOR SELECT TO app_runtime USING (true);

DROP POLICY IF EXISTS app_runtime_plan_catalog_read ON plan_catalog;
CREATE POLICY app_runtime_plan_catalog_read ON plan_catalog
  FOR SELECT TO app_runtime USING (true);

DROP POLICY IF EXISTS app_runtime_worker_heartbeats_read ON worker_heartbeats;
CREATE POLICY app_runtime_worker_heartbeats_read ON worker_heartbeats
  FOR SELECT TO app_runtime USING (true);

DROP POLICY IF EXISTS app_runtime_outbox_messages_read ON outbox_messages;
CREATE POLICY app_runtime_outbox_messages_read ON outbox_messages
  FOR SELECT TO app_runtime USING (true);
DROP POLICY IF EXISTS app_runtime_outbox_messages_insert ON outbox_messages;
CREATE POLICY app_runtime_outbox_messages_insert ON outbox_messages
  FOR INSERT TO app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS app_runtime_outbox_messages_update ON outbox_messages;
CREATE POLICY app_runtime_outbox_messages_update ON outbox_messages
  FOR UPDATE TO app_runtime USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  REVOKE INSERT, UPDATE, DELETE ON app_settings FROM rrit_worker;
  REVOKE DELETE ON worker_heartbeats, maintenance_runs FROM rrit_worker;
  GRANT SELECT ON app_settings TO rrit_worker;
  GRANT SELECT, INSERT, UPDATE ON worker_heartbeats, maintenance_runs TO rrit_worker;

  GRANT SELECT, UPDATE ON outbox_messages TO rrit_worker;
  REVOKE INSERT, DELETE ON outbox_messages FROM rrit_worker;
  GRANT SELECT, INSERT ON outbox_consumptions TO rrit_worker;
  REVOKE UPDATE, DELETE ON outbox_consumptions FROM rrit_worker;

  DROP POLICY IF EXISTS rrit_worker_app_settings_read ON app_settings;
  CREATE POLICY rrit_worker_app_settings_read ON app_settings
    FOR SELECT TO rrit_worker USING (true);

  DROP POLICY IF EXISTS rrit_worker_worker_heartbeats_read ON worker_heartbeats;
  CREATE POLICY rrit_worker_worker_heartbeats_read ON worker_heartbeats
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_worker_heartbeats_insert ON worker_heartbeats;
  CREATE POLICY rrit_worker_worker_heartbeats_insert ON worker_heartbeats
    FOR INSERT TO rrit_worker WITH CHECK (true);
  DROP POLICY IF EXISTS rrit_worker_worker_heartbeats_update ON worker_heartbeats;
  CREATE POLICY rrit_worker_worker_heartbeats_update ON worker_heartbeats
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_maintenance_runs_read ON maintenance_runs;
  CREATE POLICY rrit_worker_maintenance_runs_read ON maintenance_runs
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_maintenance_runs_insert ON maintenance_runs;
  CREATE POLICY rrit_worker_maintenance_runs_insert ON maintenance_runs
    FOR INSERT TO rrit_worker WITH CHECK (true);
  DROP POLICY IF EXISTS rrit_worker_maintenance_runs_update ON maintenance_runs;
  CREATE POLICY rrit_worker_maintenance_runs_update ON maintenance_runs
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_outbox_messages_read ON outbox_messages;
  CREATE POLICY rrit_worker_outbox_messages_read ON outbox_messages
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_outbox_messages_update ON outbox_messages;
  CREATE POLICY rrit_worker_outbox_messages_update ON outbox_messages
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_outbox_consumptions_read ON outbox_consumptions;
  CREATE POLICY rrit_worker_outbox_consumptions_read ON outbox_consumptions
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_outbox_consumptions_insert ON outbox_consumptions;
  CREATE POLICY rrit_worker_outbox_consumptions_insert ON outbox_consumptions
    FOR INSERT TO rrit_worker WITH CHECK (true);
END
$$;

-- Restore the signed-media reader to the reviewed implementation and remove
-- its obsolete predecessor. SECURITY DEFINER functions always use a fixed,
-- minimal search path.
CREATE OR REPLACE FUNCTION app.read_signed_asset(asset_id uuid)
RETURNS TABLE(bytes bytea, mime text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.bytes, a.mime
  FROM public.assets AS a
  WHERE a.id = $1 AND a.rights = true
$$;

REVOKE ALL ON FUNCTION app.read_signed_asset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_asset(uuid) TO app_runtime;
DROP FUNCTION IF EXISTS app.read_signed_asset_location(uuid);
