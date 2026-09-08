INSERT INTO app_settings(key,value) VALUES (
  'retention',
  '{"oauth_state_days":7,"ai_generation_days":90,"ai_usage_days":400,"trial_claim_days":365,"validation_days":365,"social_post_days":730}'
);

CREATE TABLE maintenance_runs (
  name text PRIMARY KEY,
  last_started_at timestamptz NOT NULL,
  last_completed_at timestamptz,
  result jsonb,
  failure text
);
