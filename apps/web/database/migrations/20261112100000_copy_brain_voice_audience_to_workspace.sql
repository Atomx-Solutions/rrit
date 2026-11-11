-- The tone and audience of a business get one home: the workspace profile
-- (businesses.state->'brand'), which My business edits. Until now the planner
-- preferred the Business Brain copies (brand_voice_versions, brand_audiences)
-- over the profile, so the profile is brought to what the planner already
-- uses. Nothing is deleted: the Brain tables stay as they are, and running
-- this again changes nothing.
WITH business_brand AS (
  -- The brand a business plans with: the one with its slug, or its only brand.
  SELECT DISTINCT ON (biz.id) biz.id AS business_id, b.id AS brand_id
  FROM businesses biz
  JOIN brands b ON b.organization_id = biz.id
  WHERE b.slug = biz.slug
     OR (SELECT count(*) FROM brands other WHERE other.organization_id = biz.id) = 1
  ORDER BY biz.id, (b.slug = biz.slug) DESC
),
brain AS (
  SELECT
    bb.business_id,
    (SELECT trim(v.text) FROM brand_voice_versions v
      WHERE v.brand_id = bb.brand_id AND v.organization_id = bb.business_id AND v.active
      ORDER BY v.version DESC LIMIT 1) AS voice,
    -- Written the way the planner joined them: one audience per line.
    (SELECT string_agg(
              CASE WHEN length(trim(a.description)) > 0
                   THEN trim(a.name) || ' — ' || trim(a.description)
                   ELSE trim(a.name) END,
              E'\n' ORDER BY a.created_at)
       FROM brand_audiences a
      WHERE a.brand_id = bb.brand_id AND a.organization_id = bb.business_id AND a.status = 'active') AS audience
  FROM business_brand bb
),
changes AS (
  SELECT
    biz.id,
    CASE WHEN length(coalesce(brain.voice, '')) > 0 THEN left(brain.voice, 1000)
         ELSE biz.state->'brand'->>'voice' END AS voice,
    CASE WHEN length(coalesce(brain.audience, '')) > 0 THEN left(brain.audience, 1000)
         ELSE biz.state->'brand'->>'audience' END AS audience
  FROM businesses biz
  JOIN brain ON brain.business_id = biz.id
  WHERE jsonb_typeof(biz.state->'brand') = 'object'
)
-- The revision moves on, so a screen opened before this cannot save over the
-- copied values without reloading them first.
UPDATE businesses biz
SET state = jsonb_set(
      jsonb_set(biz.state, '{brand,voice}', to_jsonb(coalesce(changes.voice, '')), true),
      '{brand,audience}', to_jsonb(coalesce(changes.audience, '')), true),
    revision = biz.revision + 1,
    updated_at = now()
FROM changes
WHERE biz.id = changes.id
  AND (coalesce(biz.state->'brand'->>'voice', '') IS DISTINCT FROM coalesce(changes.voice, '')
    OR coalesce(biz.state->'brand'->>'audience', '') IS DISTINCT FROM coalesce(changes.audience, ''));
