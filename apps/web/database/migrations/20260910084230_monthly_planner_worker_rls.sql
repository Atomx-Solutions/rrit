-- The worker is a server-only trusted cross-tenant process. It is deliberately
-- not a member of the web/API request path; do not add its connection string
-- to DATABASE_URL. RLS otherwise denies every row to this separate role, even
-- when the SQL grants from 0021/0022 are present.
--
-- Keep worker permissions explicit by operation. In particular, there is no
-- DELETE policy: planner data is retained for audit/cost reconciliation.
DO $$
DECLARE
  table_name text;
  read_tables text[] := ARRAY[
    'app_settings',
    'trial_grants',
    'entitlements',
    'ai_cost_ledger'
  ];
  tenant_tables text[] := ARRAY[
    'businesses',
    'assets',
    'posts',
    'post_content_versions',
    'audit_events',
    'ai_daily_usage',
    'monthly_planner_settings',
    'monthly_plans',
    'monthly_ai_runs'
  ];
  insert_tables text[] := ARRAY[
    'assets',
    'posts',
    'post_content_versions',
    'audit_events',
    'ai_daily_usage',
    'monthly_planner_settings',
    'monthly_plans',
    'monthly_ai_runs'
  ];
  update_tables text[] := ARRAY[
    'businesses',
    'ai_daily_usage',
    'monthly_planner_settings',
    'monthly_plans',
    'monthly_ai_runs'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  REVOKE DELETE ON monthly_planner_settings,monthly_plans,monthly_ai_runs FROM rrit_worker;

  -- app_settings is global, not a tenant table, and contains only validated
  -- application policy needed by trialStatus.
  GRANT SELECT ON app_settings TO rrit_worker;

  FOREACH table_name IN ARRAY read_tables LOOP
    IF table_name <> 'app_settings' THEN
      EXECUTE format('GRANT SELECT ON TABLE %I TO rrit_worker', table_name);
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I',
        'rrit_worker_' || table_name || '_read',
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT TO rrit_worker USING (true)',
        'rrit_worker_' || table_name || '_read',
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('GRANT SELECT ON TABLE %I TO rrit_worker', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'rrit_worker_' || table_name || '_read',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO rrit_worker USING (true)',
      'rrit_worker_' || table_name || '_read',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY insert_tables LOOP
    EXECUTE format('GRANT INSERT ON TABLE %I TO rrit_worker', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'rrit_worker_' || table_name || '_insert',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO rrit_worker WITH CHECK (true)',
      'rrit_worker_' || table_name || '_insert',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY update_tables LOOP
    EXECUTE format('GRANT UPDATE ON TABLE %I TO rrit_worker', table_name);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      'rrit_worker_' || table_name || '_update',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true)',
      'rrit_worker_' || table_name || '_update',
      table_name
    );
  END LOOP;
END
$$;
