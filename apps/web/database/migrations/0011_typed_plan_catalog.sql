ALTER TABLE plan_catalog
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN feature_codes jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN limits jsonb NOT NULL DEFAULT '{}';

UPDATE plan_catalog SET
  feature_codes = CASE name
    WHEN 'Fillimi' THEN '["posts","media","validation","social_import","publishing"]'::jsonb
    ELSE '["posts","media","validation","social_import","publishing","ai"]'::jsonb
  END,
  limits = CASE name
    WHEN 'Fillimi' THEN '{"posts_per_month":12,"ai_requests_per_day":0,"media_storage_bytes":268435456,"social_accounts":2,"members":1}'::jsonb
    WHEN 'Përditë' THEN '{"posts_per_month":30,"ai_requests_per_day":30,"media_storage_bytes":1073741824,"social_accounts":2,"members":1}'::jsonb
    WHEN 'Më shumë' THEN '{"posts_per_month":60,"ai_requests_per_day":100,"media_storage_bytes":5368709120,"social_accounts":2,"members":1}'::jsonb
    ELSE '{}'::jsonb
  END;

ALTER TABLE plan_catalog
  ADD CONSTRAINT plan_catalog_feature_codes_array CHECK (jsonb_typeof(feature_codes) = 'array'),
  ADD CONSTRAINT plan_catalog_limits_object CHECK (jsonb_typeof(limits) = 'object');

UPDATE app_settings
SET value = jsonb_set(
  value,
  '{limits}',
  '{"posts_per_month":60,"ai_requests_per_day":30,"media_storage_bytes":1073741824,"social_accounts":2,"members":1}'::jsonb
)
WHERE key = 'trial';

ALTER TABLE entitlements
  ADD COLUMN plan_name text,
  ADD COLUMN plan_version integer CHECK (plan_version IS NULL OR plan_version > 0),
  ADD COLUMN limits jsonb NOT NULL DEFAULT '{}';
ALTER TABLE entitlements
  ADD CONSTRAINT entitlements_limits_object CHECK (jsonb_typeof(limits) = 'object');
