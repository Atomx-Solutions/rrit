-- The monthly planner reads the complete connected page history and refreshes
-- it from Meta. Without these policies RLS silently hides every imported post
-- from the non-BYPASSRLS worker login, so only platform-published posts reach
-- the style evidence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS rrit_worker_social_posts_read ON social_posts;
  CREATE POLICY rrit_worker_social_posts_read ON social_posts
    FOR SELECT TO rrit_worker USING (true);
  DROP POLICY IF EXISTS rrit_worker_social_posts_insert ON social_posts;
  CREATE POLICY rrit_worker_social_posts_insert ON social_posts
    FOR INSERT TO rrit_worker WITH CHECK (true);
  DROP POLICY IF EXISTS rrit_worker_social_posts_update ON social_posts;
  CREATE POLICY rrit_worker_social_posts_update ON social_posts
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
END
$$;
