-- TikTok Direct Post: a post bound for TikTok is published by the same queue
-- as Facebook and Instagram once its account holder has chosen how TikTok
-- shows it. TikTok requires that choice per post, with no preset value, so it
-- is stored apart from the post's content and never versioned with it.
CREATE TABLE public.post_tiktok_settings (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  privacy_level text NOT NULL,
  disable_comment boolean NOT NULL,
  disable_duet boolean NOT NULL,
  disable_stitch boolean NOT NULL,
  brand_organic boolean NOT NULL DEFAULT false,
  branded_content boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_tiktok_settings_business ON public.post_tiktok_settings(business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_tiktok_settings TO app_runtime;
ALTER TABLE public.post_tiktok_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY post_tiktok_settings_tenant_access ON public.post_tiktok_settings FOR ALL TO app_runtime
  USING (business_id = app.current_organization_id())
  WITH CHECK (business_id = app.current_organization_id());

-- The TikTok account a job publishes to, as target_page_id and
-- target_instagram_id name the Meta accounts.
ALTER TABLE public.publication_jobs ADD COLUMN target_tiktok_open_id text;

-- The publisher reads the settings and the connection, and stores refreshed
-- TikTok tokens.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    RETURN;
  END IF;
  GRANT SELECT ON public.post_tiktok_settings TO rrit_worker;
  CREATE POLICY rrit_worker_post_tiktok_settings_read ON public.post_tiktok_settings
    FOR SELECT TO rrit_worker USING (true);
  GRANT SELECT, UPDATE ON public.tiktok_connections TO rrit_worker;
  CREATE POLICY rrit_worker_tiktok_connections_read ON public.tiktok_connections
    FOR SELECT TO rrit_worker USING (true);
  CREATE POLICY rrit_worker_tiktok_connections_update ON public.tiktok_connections
    FOR UPDATE TO rrit_worker USING (true) WITH CHECK (true);
END
$$;
