-- A function frozen or stopped in the middle of a transaction would otherwise
-- hold its locks and its connection until someone ended it by hand, as a
-- retention clean-up did, holding the lock every later clean-up waited on.
-- Postgres now ends a transaction left open with nothing sent, and frees both.
--
-- It is set on the login roles because the Supabase pooler drops settings sent
-- when a connection opens; a role's own setting applies to every new session.
-- Every transaction the application runs is short, so a minute is generous.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['rrit_web', 'rrit_planner'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', role_name, '60s');
    END IF;
  END LOOP;
END $$;
