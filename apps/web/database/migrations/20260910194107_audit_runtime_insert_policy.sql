-- The web role may append only an event for the authenticated actor and active
-- tenant context. Audit rows remain immutable and are never writable by
-- browser-facing anon/authenticated roles.
DROP POLICY IF EXISTS audit_events_insert_own ON public.audit_events;
CREATE POLICY audit_events_insert_own ON public.audit_events
  FOR INSERT TO app_runtime
  WITH CHECK (
    business_id = app.current_organization_id()
    AND organization_id = app.current_organization_id()
    AND actor_id = app.current_user_id()
  );

GRANT INSERT ON TABLE public.audit_events TO app_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.audit_events_id_seq TO app_runtime;
