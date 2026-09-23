-- Keep legacy onboarding data visible in the normalized Business Brain.
-- Migration 0028 handled brands that already existed at that time, but new
-- registrations continued to write the legacy profile shape only.
INSERT INTO brand_facts (
  organization_id,
  brand_id,
  kind,
  status,
  text,
  source,
  source_type,
  confidence,
  verified_at
)
SELECT
  b.organization_id,
  b.id,
  'explicit',
  CASE WHEN COALESCE(f.value->>'verified', 'false') = 'true' THEN 'verified' ELSE 'proposed' END,
  trim(f.value->>'text'),
  COALESCE(NULLIF(trim(f.value->>'source'), ''), 'Migrim nga profili i biznesit'),
  'manual',
  1,
  CASE WHEN COALESCE(f.value->>'verified', 'false') = 'true' THEN now() ELSE NULL END
FROM brands b
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(b.profile->'facts') = 'array' THEN b.profile->'facts' ELSE '[]'::jsonb END
) AS f(value)
WHERE length(trim(f.value->>'text')) BETWEEN 1 AND 1000
  AND NOT EXISTS (
    SELECT 1
    FROM brand_facts existing
    WHERE existing.organization_id = b.organization_id
      AND existing.brand_id = b.id
      AND existing.text = trim(f.value->>'text')
      AND existing.source = COALESCE(NULLIF(trim(f.value->>'source'), ''), 'Migrim nga profili i biznesit')
  );

INSERT INTO brand_voice_versions (organization_id, brand_id, version, text, source, active)
SELECT b.organization_id, b.id, 1, trim(b.profile->>'voice'), 'Migrim nga profili i biznesit', true
FROM brands b
WHERE length(trim(COALESCE(b.profile->>'voice', ''))) BETWEEN 1 AND 1000
  AND NOT EXISTS (
    SELECT 1 FROM brand_voice_versions existing
    WHERE existing.organization_id = b.organization_id AND existing.brand_id = b.id
  );
