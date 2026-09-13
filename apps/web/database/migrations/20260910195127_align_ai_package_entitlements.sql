-- All commercial packages share the complete product/AI capability set. The
-- post allowance is the only package-specific service limit (12/30/60).
UPDATE public.plan_catalog
SET version = version + 1,
    feature_codes = '["posts","media","validation","social_import","publishing","ai"]'::jsonb,
    limits = jsonb_build_object(
      'posts_per_month', (limits->>'posts_per_month')::integer,
      'ai_requests_per_day', 200,
      'media_storage_bytes', 5368709120,
      'social_accounts', 2,
      'members', 1
    ),
    features = jsonb_build_array(
      '1 biznes',
      'Facebook & Instagram',
      (limits->>'posts_per_month') || ' drafte postimesh në muaj',
      'Hulumtim dhe përgatitje me AI',
      'Dizajn, miratim dhe planifikim'
    )
WHERE sort_order IN (1,2,3)
  AND (limits->>'posts_per_month')::integer IN (12,30,60);

-- This is an additive upgrade for already-issued versions of the three known
-- packages: customers receive the same capabilities without losing data.
UPDATE public.entitlements entitlement
SET features = catalog.feature_codes,
    limits = catalog.limits,
    plan_version = catalog.version
FROM public.plan_catalog catalog
WHERE entitlement.plan_name = catalog.name
  AND catalog.sort_order IN (1,2,3)
  AND (catalog.limits->>'posts_per_month')::integer IN (12,30,60);

-- The 72-hour trial mirrors the entry experience instead of preparing sixty
-- posts; it still exposes the complete AI workflow for evaluation.
UPDATE public.app_settings
SET value = jsonb_set(
  jsonb_set(
    value,
    '{features}',
    '["posts","media","validation","social_import","publishing","ai"]'::jsonb
  ),
  '{limits}',
  '{"posts_per_month":12,"ai_requests_per_day":200,"media_storage_bytes":5368709120,"social_accounts":2,"members":1}'::jsonb
)
WHERE key = 'trial';
