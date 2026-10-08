CREATE TABLE tiktok_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE tiktok_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  open_id text NOT NULL,
  display_name text,
  avatar_url text,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  refresh_expires_at timestamptz,
  scopes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','expired','revoked')),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tiktok_connections_open_id ON tiktok_connections(open_id);
CREATE INDEX tiktok_oauth_states_expiry ON tiktok_oauth_states(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON tiktok_oauth_states, tiktok_connections TO app_runtime;

ALTER TABLE tiktok_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tiktok_oauth_states_tenant_access ON tiktok_oauth_states FOR ALL TO app_runtime
  USING (user_id = app.current_user_id() AND (app.current_organization_id() IS NULL OR business_id = app.current_organization_id()))
  WITH CHECK (user_id = app.current_user_id() AND business_id = app.current_organization_id());

ALTER TABLE tiktok_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tiktok_connections_tenant_access ON tiktok_connections FOR ALL TO app_runtime
  USING (business_id = app.current_organization_id())
  WITH CHECK (business_id = app.current_organization_id());
