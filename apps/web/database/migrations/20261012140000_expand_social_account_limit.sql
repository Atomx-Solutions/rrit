-- Facebook, Instagram and TikTok are all included in the social-account quota.
UPDATE plan_catalog
SET limits = jsonb_set(limits, '{social_accounts}', '3'::jsonb, true)
WHERE limits ? 'social_accounts';

UPDATE entitlements
SET limits = jsonb_set(limits, '{social_accounts}', '3'::jsonb, true)
WHERE limits ? 'social_accounts';

UPDATE app_settings
SET value = jsonb_set(value, '{limits,social_accounts}', '3'::jsonb, true)
WHERE key = 'trial';
