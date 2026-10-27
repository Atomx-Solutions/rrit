-- A business may connect its Instagram professional account directly through
-- Instagram Login, independent of a Facebook page. When present, this
-- connection takes precedence over an Instagram account linked to the page.
CREATE TABLE instagram_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE instagram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  instagram_user_id text NOT NULL,
  username text,
  token_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','revoked')),
  last_sync_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX instagram_connections_user ON instagram_connections(instagram_user_id);
CREATE INDEX instagram_oauth_states_expiry ON instagram_oauth_states(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_oauth_states, instagram_connections TO app_runtime;

ALTER TABLE instagram_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY instagram_oauth_states_tenant_access ON instagram_oauth_states FOR ALL TO app_runtime
  USING (user_id = app.current_user_id() AND (app.current_organization_id() IS NULL OR business_id = app.current_organization_id()))
  WITH CHECK (user_id = app.current_user_id() AND business_id = app.current_organization_id());

ALTER TABLE instagram_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY instagram_connections_tenant_access ON instagram_connections FOR ALL TO app_runtime
  USING (business_id = app.current_organization_id())
  WITH CHECK (business_id = app.current_organization_id());

-- The publisher reads the connection and stores refreshed tokens, as it does
-- for meta_connections.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;
  GRANT SELECT, UPDATE ON instagram_connections TO rrit_worker;
  CREATE POLICY rrit_worker_instagram_connections_read ON instagram_connections
    FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY rrit_worker_instagram_connections_update ON instagram_connections
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
END
$$;
