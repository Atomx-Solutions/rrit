-- A business's facts and offers get one home: the workspace brand facts
-- (businesses.state->'brand'->'facts'), which My business edits and the
-- planner reads. Verified Business Brain facts and active offers that are not
-- there yet are copied in. Nothing is deleted: brand_facts and brand_offers stay
-- as they are, and running this again adds nothing twice.
-- Timestamps are written as UTC with a Z, the form the workspace schema reads.
WITH business_brand AS (
  -- The brand a business plans with: the one with its slug, or its only brand.
  SELECT DISTINCT ON (biz.id) biz.id AS business_id, b.id AS brand_id
  FROM businesses biz
  JOIN brands b ON b.organization_id = biz.id
  WHERE b.slug = biz.slug
     OR (SELECT count(*) FROM brands other WHERE other.organization_id = biz.id) = 1
  ORDER BY biz.id, (b.slug = biz.slug) DESC
),
brain_facts AS (
  SELECT bb.business_id, f.created_at AS ordered_at, jsonb_build_object(
    'id', f.id::text,
    'text', trim(f.text),
    'source', trim(f.source),
    'verified', true,
    'kind', 'fact',
    'validFrom', NULL,
    'validUntil', NULL,
    'amountCents', NULL,
    'currency', NULL,
    'state', 'verified',
    'origin', CASE f.source_type WHEN 'manual' THEN 'user' WHEN 'social' THEN 'social' ELSE 'research' END,
    'confidence', f.confidence,
    'verifiedAt', to_char(f.verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'verifiedBy', to_jsonb(f.verified_by),
    'revision', 1
  ) AS fact
  FROM business_brand bb
  JOIN brand_facts f ON f.brand_id = bb.brand_id AND f.organization_id = bb.business_id
  WHERE f.status = 'verified'
),
brain_offers AS (
  -- An offer is confirmed only with both dates, as My business requires; one
  -- without an end date arrives unconfirmed for the business to finish.
  SELECT bb.business_id, o.created_at AS ordered_at, jsonb_build_object(
    'id', o.id::text,
    'text', trim(o.name) || CASE WHEN length(trim(o.description)) > 0 THEN ' – ' || trim(o.description) ELSE '' END,
    'source', trim(o.source),
    'verified', o.valid_until IS NOT NULL,
    'kind', 'offer',
    'validFrom', o.valid_from,
    'validUntil', o.valid_until,
    'amountCents', CASE WHEN o.amount > 0 THEN round(o.amount * 100)::integer END,
    'currency', CASE WHEN o.amount > 0 THEN o.currency END,
    'state', CASE WHEN o.valid_until IS NOT NULL THEN 'verified' ELSE 'proposed' END,
    'origin', 'user',
    'confidence', o.confidence,
    'verifiedAt', CASE WHEN o.valid_until IS NOT NULL THEN to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'verifiedBy', NULL,
    'revision', 1
  ) AS fact
  FROM business_brand bb
  JOIN brand_offers o ON o.brand_id = bb.brand_id AND o.organization_id = bb.business_id
  WHERE o.status = 'active'
),
incoming AS (
  SELECT business_id, ordered_at, fact FROM brain_facts
  UNION ALL
  SELECT business_id, ordered_at, fact FROM brain_offers
),
missing AS (
  -- Skipped when the workspace already has the same id or the same words.
  SELECT i.business_id, jsonb_agg(i.fact ORDER BY i.ordered_at) AS facts
  FROM incoming i
  JOIN businesses biz ON biz.id = i.business_id
  WHERE length(i.fact->>'text') BETWEEN 1 AND 1000
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(biz.state->'brand'->'facts') = 'array' THEN biz.state->'brand'->'facts' ELSE '[]'::jsonb END
      ) AS existing(value)
      WHERE existing.value->>'id' = i.fact->>'id'
         OR lower(trim(existing.value->>'text')) = lower(i.fact->>'text')
    )
  GROUP BY i.business_id
)
-- The revision moves on, so a screen opened before this cannot save over the
-- copied facts without reloading them first.
UPDATE businesses biz
SET state = jsonb_set(
      biz.state,
      '{brand,facts}',
      CASE WHEN jsonb_typeof(biz.state->'brand'->'facts') = 'array' THEN biz.state->'brand'->'facts' ELSE '[]'::jsonb END
        || m.facts,
      true
    ),
    revision = biz.revision + 1,
    updated_at = now()
FROM missing m
WHERE biz.id = m.business_id
  AND jsonb_typeof(biz.state->'brand') = 'object';
