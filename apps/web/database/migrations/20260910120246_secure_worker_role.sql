-- Supabase may protect an existing BypassRLS role from being altered through
-- the application migration connection. Never use that identity for an
-- application process. Provision dedicated, passwordless login roles here;
-- their passwords are set only through the deployment secret manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_web') THEN
    CREATE ROLE rrit_web LOGIN PASSWORD NULL;
  END IF;
  GRANT app_runtime TO rrit_web;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_planner') THEN
      CREATE ROLE rrit_planner LOGIN PASSWORD NULL;
    END IF;
    GRANT rrit_worker TO rrit_planner;
  END IF;
END
$$;
