-- The maintenance worker needs the owner's email to deliver package reminders.
-- Keep this grant narrowly scoped to the auth user email lookup.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'auth'::regnamespace AND relname = 'users') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA auth TO rrit_worker';
    EXECUTE 'GRANT SELECT (id, email) ON TABLE auth.users TO rrit_worker';
  END IF;
END
$$;
