-- PRC-07: trial post usage is durable and cannot be reset by deleting drafts.
ALTER TABLE trial_grants
  ADD COLUMN posts_used integer NOT NULL DEFAULT 0 CHECK (posts_used >= 0);

-- Existing trial posts must count immediately after the migration. Paid
-- subscriptions use their own monthly quota and are unaffected by this value.
UPDATE trial_grants trial
SET posts_used = usage.post_count
FROM (
  SELECT trial.business_id, count(post.id)::integer AS post_count
  FROM trial_grants trial
  LEFT JOIN posts post ON post.business_id = trial.business_id
  GROUP BY trial.business_id
) usage
WHERE trial.business_id = usage.business_id;

-- The monthly planner runs as rrit_worker and records generated trial posts
-- inside its existing transaction.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT UPDATE ON trial_grants TO rrit_worker;
    DROP POLICY IF EXISTS rrit_worker_trial_grants_update ON trial_grants;
    CREATE POLICY rrit_worker_trial_grants_update ON trial_grants
      FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
  END IF;
END
$$;
