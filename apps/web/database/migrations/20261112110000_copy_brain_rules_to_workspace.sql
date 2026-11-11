-- A business's rules for AI get one home: the workspace profile
-- (businesses.state->'brand'->'guardrails'), the list My business edits. The
-- active Business Brain rules (brand_guardrails) that are not there yet are
-- added after the profile's own, so the planner keeps every rule it follows
-- today. Nothing is deleted, and running this again adds nothing twice.
WITH business_brand AS (
  -- The brand a business plans with: the one with its slug, or its only brand.
  SELECT DISTINCT ON (biz.id) biz.id AS business_id, b.id AS brand_id
  FROM businesses biz
  JOIN brands b ON b.organization_id = biz.id
  WHERE b.slug = biz.slug
     OR (SELECT count(*) FROM brands other WHERE other.organization_id = biz.id) = 1
  ORDER BY biz.id, (b.slug = biz.slug) DESC
),
current_rules AS (
  SELECT biz.id AS business_id,
         CASE WHEN jsonb_typeof(biz.state->'brand'->'guardrails') = 'array'
              THEN biz.state->'brand'->'guardrails' ELSE '[]'::jsonb END AS rules
  FROM businesses biz
),
missing AS (
  SELECT bb.business_id, jsonb_agg(left(trim(g.text), 500) ORDER BY g.created_at) AS rules
  FROM business_brand bb
  JOIN brand_guardrails g
    ON g.brand_id = bb.brand_id AND g.organization_id = bb.business_id AND g.status = 'active'
  JOIN current_rules cr ON cr.business_id = bb.business_id
  WHERE length(trim(g.text)) > 0
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(cr.rules) existing(text)
      WHERE lower(trim(existing.text)) = lower(left(trim(g.text), 500))
    )
  GROUP BY bb.business_id
)
-- The profile keeps at most twenty rules, the limit My business allows. The
-- revision moves on, so a screen opened before this cannot save over them.
UPDATE businesses biz
SET state = jsonb_set(
      biz.state,
      '{brand,guardrails}',
      (SELECT coalesce(jsonb_agg(rule ORDER BY position), '[]'::jsonb)
         FROM jsonb_array_elements(cr.rules || missing.rules) WITH ORDINALITY AS all_rules(rule, position)
        WHERE position <= 20),
      true
    ),
    revision = biz.revision + 1,
    updated_at = now()
FROM missing
JOIN current_rules cr ON cr.business_id = missing.business_id
WHERE biz.id = missing.business_id
  AND jsonb_typeof(biz.state->'brand') = 'object';
