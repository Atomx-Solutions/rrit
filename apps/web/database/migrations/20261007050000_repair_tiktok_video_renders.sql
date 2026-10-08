-- Repair migration for environments where the migration ledger says the
-- video-render migration ran but the relation was not created.
CREATE TABLE IF NOT EXISTS public.tiktok_video_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  source_asset_ids jsonb NOT NULL,
  logo_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('rendering', 'ready', 'failed')),
  storage_path text,
  size_bytes bigint,
  width integer NOT NULL DEFAULT 1080,
  height integer NOT NULL DEFAULT 1920,
  duration_seconds integer NOT NULL DEFAULT 12,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tiktok_video_renders_post
  ON public.tiktok_video_renders(post_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_video_renders TO app_runtime;

ALTER TABLE public.tiktok_video_renders ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'tiktok_video_renders'
       AND policyname = 'tiktok_video_renders_tenant_access'
  ) THEN
    CREATE POLICY tiktok_video_renders_tenant_access
      ON public.tiktok_video_renders
      FOR ALL TO app_runtime
      USING (business_id = app.current_organization_id())
      WITH CHECK (business_id = app.current_organization_id());
  END IF;
END
$$;
