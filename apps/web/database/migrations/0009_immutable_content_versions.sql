-- Separate immutable editorial content from mutable workflow state. Existing
-- payloads become the first complete snapshot that can be proven; legacy
-- caption-only history is retained in the payload but is not promoted as a
-- complete historical snapshot.
ALTER TABLE posts
  ADD COLUMN content_version integer NOT NULL DEFAULT 1 CHECK (content_version > 0);

UPDATE posts
SET content_version = GREATEST(1, COALESCE((payload->>'contentVersion')::integer, 1)),
    payload = jsonb_set(
      payload,
      '{contentVersion}',
      to_jsonb(GREATEST(1, COALESCE((payload->>'contentVersion')::integer, 1)))
    );

CREATE TABLE post_content_versions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  content_version integer NOT NULL CHECK (content_version > 0),
  fingerprint text NOT NULL CHECK (length(fingerprint) > 0),
  snapshot jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('migration','editor')),
  actor_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, content_version),
  CHECK ((snapshot->>'contentVersion')::integer = content_version),
  CHECK (snapshot ?& ARRAY['title','caption','channel','format','image','pillar'])
);
CREATE INDEX post_content_versions_business_created
  ON post_content_versions (business_id, created_at DESC, post_id);

INSERT INTO post_content_versions (
  post_id, business_id, content_version, fingerprint, snapshot, source, created_at
)
SELECT
  id,
  business_id,
  content_version,
  'legacy-unverified',
  jsonb_build_object(
    'contentVersion', content_version,
    'title', payload->>'title',
    'caption', payload->>'caption',
    'channel', payload->>'channel',
    'format', payload->>'format',
    'image', payload->>'image',
    'pillar', payload->>'pillar'
  ),
  'migration',
  created_at
FROM posts;

CREATE TABLE post_approval_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  content_version integer NOT NULL,
  fingerprint text NOT NULL CHECK (length(fingerprint) > 0),
  actor_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved','reopened')),
  source text NOT NULL CHECK (source IN ('migration','editor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (post_id, content_version)
    REFERENCES post_content_versions(post_id, content_version) ON DELETE RESTRICT
);
CREATE INDEX post_approvals_current
  ON post_approval_records (post_id, content_version, created_at DESC);
CREATE INDEX post_approvals_business
  ON post_approval_records (business_id, created_at DESC);

INSERT INTO post_approval_records (
  post_id, business_id, content_version, fingerprint, actor_id, decision, source, created_at
)
SELECT
  p.id,
  p.business_id,
  p.content_version,
  v.fingerprint,
  b.owner_id,
  'approved',
  'migration',
  p.updated_at
FROM posts p
JOIN businesses b ON b.id = p.business_id
JOIN post_content_versions v
  ON v.post_id = p.id AND v.content_version = p.content_version
WHERE p.payload->>'status' IN ('approved','scheduled','published','failed');

ALTER TABLE post_validations ADD COLUMN content_version integer;
UPDATE post_validations v
SET content_version = p.content_version
FROM posts p
WHERE p.id = v.post_id;
ALTER TABLE post_validations ALTER COLUMN content_version SET NOT NULL;
CREATE INDEX validations_content_version
  ON post_validations (post_id, content_version, created_at DESC);

ALTER TABLE publication_jobs ADD COLUMN content_version integer;
UPDATE publication_jobs j
SET content_version = p.content_version
FROM posts p
WHERE p.id = j.post_id;
ALTER TABLE publication_jobs ALTER COLUMN content_version SET NOT NULL;

CREATE FUNCTION reject_immutable_record_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable record cannot be changed';
END;
$$;
CREATE TRIGGER post_content_versions_immutable
  BEFORE UPDATE ON post_content_versions
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER post_approval_records_immutable
  BEFORE UPDATE ON post_approval_records
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
