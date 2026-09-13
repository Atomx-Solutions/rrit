-- audit_events has a CHECK constraint backed by this hardened helper. Roles
-- that may insert audit rows need EXECUTE on the helper as well as table/RLS
-- permission; no broader database privilege is granted here.
DO $$
BEGIN
  IF to_regprocedure('app.audit_metadata_is_safe(jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION app.audit_metadata_is_safe(jsonb) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION app.audit_metadata_is_safe(jsonb) TO app_runtime;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
      GRANT EXECUTE ON FUNCTION app.audit_metadata_is_safe(jsonb) TO rrit_worker;
    END IF;
  END IF;
END
$$;
