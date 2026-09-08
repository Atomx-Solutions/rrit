ALTER TABLE publication_jobs ADD COLUMN logical_key text;

UPDATE publication_jobs
SET logical_key =
  md5(business_id::text || ':' || post_id::text || ':' || post_version::text) ||
  md5('publication:' || business_id::text || ':' || post_id::text || ':' || post_version::text);

ALTER TABLE publication_jobs
  ALTER COLUMN logical_key SET NOT NULL,
  ALTER COLUMN logical_key SET DEFAULT (md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text)),
  ADD CONSTRAINT publication_jobs_logical_key_format
    CHECK (logical_key ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT publication_jobs_business_logical_unique
    UNIQUE (business_id, logical_key);
