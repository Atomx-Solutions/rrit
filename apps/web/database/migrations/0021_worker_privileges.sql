-- Publisher and maintenance use a separate non-superuser worker role. The
-- role is provisioned outside migrations because its password is a secret.
DO $$
DECLARE
  tenant_schema text := current_schema();
  worker_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO rrit_worker', tenant_schema);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM rrit_worker', tenant_schema);
    EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM rrit_worker', tenant_schema);
    FOREACH worker_table IN ARRAY ARRAY[
      'app_settings',
      'assets',
      'audit_events',
      'ai_daily_usage',
      'ai_generations',
      'businesses',
      'entitlements',
      'meta_connections',
      'meta_oauth_states',
      'maintenance_runs',
      'post_approval_records',
      'post_content_versions',
      'post_validations',
      'posts',
      'publication_attempts',
      'publication_jobs',
      'social_posts',
      'trial_claims',
      'trial_grants',
      'worker_heartbeats'
    ] LOOP
      IF to_regclass(format('%I.%I', tenant_schema, worker_table)) IS NOT NULL THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO rrit_worker',
          tenant_schema,
          worker_table
        );
      END IF;
    END LOOP;
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA %I TO rrit_worker', tenant_schema);
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM rrit_worker', tenant_schema);
  END IF;
END
$$;
