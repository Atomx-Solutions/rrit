ALTER TABLE publication_jobs
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0);

ALTER TABLE publication_jobs
  ADD CONSTRAINT publication_jobs_attempt_identity_unique
    UNIQUE (id, business_id, post_id);

CREATE TABLE publication_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL,
  business_id uuid NOT NULL,
  post_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  event_type text NOT NULL
    CHECK (event_type IN ('started','retry_scheduled','deferred','published','failed','uncertain')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  failure_code text,
  provider_post_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, business_id, post_id)
    REFERENCES publication_jobs(id, business_id, post_id) ON DELETE CASCADE,
  UNIQUE (job_id, attempt_number, event_type)
);

CREATE INDEX publication_attempts_job_history
  ON publication_attempts (job_id, attempt_number, id);
CREATE INDEX publication_attempts_business_created
  ON publication_attempts (business_id, created_at DESC, id DESC);

CREATE TRIGGER publication_attempts_immutable
  BEFORE UPDATE OR DELETE ON publication_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_runtime') THEN
    GRANT SELECT, INSERT ON publication_attempts TO rrit_runtime;
    GRANT USAGE, SELECT ON SEQUENCE publication_attempts_id_seq TO rrit_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE ON publication_attempts FROM rrit_runtime;
  END IF;
END
$$;
