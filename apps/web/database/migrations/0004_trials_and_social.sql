CREATE TABLE app_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO app_settings (key, value) VALUES
('trial', '{"duration_hours":72,"features":["posts","media","validation","social_import","publishing","ai"],"device_retention_days":365}'),
('post_limits', '{"caption_characters":2200,"image_bytes":2097152,"minimum_width":320,"maximum_width":1440,"minimum_aspect_ratio":0.8,"maximum_aspect_ratio":1.91,"max_hashtags":30,"daily_ai_requests":30}');

CREATE TABLE trial_grants (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('granted', 'blocked', 'revoked')),
  reason text,
  CHECK (expires_at >= starts_at)
);
CREATE TABLE trial_claims (
  kind text NOT NULL CHECK (kind IN ('email', 'device', 'facebook_user', 'facebook_page', 'instagram_account')),
  value_hash text NOT NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, value_hash)
);
CREATE INDEX trial_claims_business ON trial_claims (business_id);
CREATE TABLE entitlements (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  features jsonb NOT NULL,
  source text NOT NULL,
  CHECK (valid_until > valid_from)
);
CREATE TABLE meta_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX meta_oauth_user ON meta_oauth_states (user_id);
CREATE INDEX meta_oauth_business ON meta_oauth_states (business_id);
CREATE TABLE meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  facebook_user_id text NOT NULL,
  token_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','expired','revoked')),
  page_id text,
  page_name text,
  page_token_ciphertext text,
  instagram_id text,
  instagram_username text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz
);
CREATE UNIQUE INDEX meta_connected_page ON meta_connections (page_id) WHERE status = 'connected';
CREATE UNIQUE INDEX meta_connected_instagram ON meta_connections (instagram_id) WHERE status = 'connected' AND instagram_id IS NOT NULL;
CREATE TABLE social_posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('Facebook','Instagram')),
  provider_id text NOT NULL,
  caption text NOT NULL DEFAULT '',
  media_url text,
  permalink text,
  published_at timestamptz NOT NULL,
  media_type text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, channel, provider_id)
);
CREATE INDEX social_posts_business_published ON social_posts (business_id, published_at DESC, id DESC);
CREATE TABLE post_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  post_version integer NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX validations_post_version ON post_validations (post_id, post_version, created_at DESC);
CREATE INDEX validations_business ON post_validations (business_id);
CREATE TABLE publication_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  post_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','published','failed','uncertain','cancelled')),
  run_at timestamptz NOT NULL,
  locked_at timestamptz,
  provider_container_id text,
  provider_post_id text,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, post_version)
);
CREATE INDEX jobs_due ON publication_jobs (run_at, id) WHERE status = 'pending';
CREATE INDEX jobs_business ON publication_jobs (business_id);
CREATE INDEX audit_actor ON audit_events (actor_id);
