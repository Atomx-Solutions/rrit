-- The non-BYPASSRLS worker login inherits rrit_worker grants. These policies
-- expose only the cross-tenant operations used by publisher and retention.
-- Planner-record deletion remains deliberately unavailable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS rrit_worker_meta_connections_read ON meta_connections;
  CREATE POLICY rrit_worker_meta_connections_read ON meta_connections
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_meta_connections_update ON meta_connections;
  CREATE POLICY rrit_worker_meta_connections_update ON meta_connections
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_post_validations_read ON post_validations;
  CREATE POLICY rrit_worker_post_validations_read ON post_validations
    FOR SELECT TO rrit_worker USING (true);

  DROP POLICY IF EXISTS rrit_worker_posts_update ON posts;
  CREATE POLICY rrit_worker_posts_update ON posts
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_publication_jobs_read ON publication_jobs;
  CREATE POLICY rrit_worker_publication_jobs_read ON publication_jobs
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_publication_jobs_update ON publication_jobs;
  CREATE POLICY rrit_worker_publication_jobs_update ON publication_jobs
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_publication_attempts_read ON publication_attempts;
  CREATE POLICY rrit_worker_publication_attempts_read ON publication_attempts
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_publication_attempts_insert ON publication_attempts;
  CREATE POLICY rrit_worker_publication_attempts_insert ON publication_attempts
    FOR INSERT TO rrit_worker WITH CHECK (true);

  DROP POLICY IF EXISTS rrit_worker_meta_oauth_states_delete ON meta_oauth_states;
  CREATE POLICY rrit_worker_meta_oauth_states_delete ON meta_oauth_states
    FOR DELETE TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_ai_daily_usage_delete ON ai_daily_usage;
  CREATE POLICY rrit_worker_ai_daily_usage_delete ON ai_daily_usage
    FOR DELETE TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_ai_generations_delete ON ai_generations;
  CREATE POLICY rrit_worker_ai_generations_delete ON ai_generations
    FOR DELETE TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_trial_claims_delete ON trial_claims;
  CREATE POLICY rrit_worker_trial_claims_delete ON trial_claims
    FOR DELETE TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_post_validations_delete ON post_validations;
  CREATE POLICY rrit_worker_post_validations_delete ON post_validations
    FOR DELETE TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_social_posts_delete ON social_posts;
  CREATE POLICY rrit_worker_social_posts_delete ON social_posts
    FOR DELETE TO rrit_worker USING (true);
END
$$;
