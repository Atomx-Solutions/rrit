-- Persist retry policy with each publication so deploy-time configuration changes
-- cannot silently alter the attempt limit of an already scheduled post.
ALTER TABLE publication_jobs
  ADD COLUMN retry_count smallint NOT NULL DEFAULT 0
    CHECK (retry_count BETWEEN 0 AND 20),
  ADD COLUMN max_attempts smallint NOT NULL DEFAULT 5
    CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN last_attempt_at timestamptz,
  ADD CONSTRAINT publication_retry_count_limit
    CHECK (retry_count < max_attempts);
