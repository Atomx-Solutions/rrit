-- The previous migration rebuilt admin_organization_packages from an older copy
-- and dropped the credit rate and the per-package usage block that
-- 20261002200000 and 20260929180000 had added. This restores both and keeps the
-- video rate, so the proposal form prices posts, videos and credits from the
-- same place, and each package reports what it has used of its two allowances.
CREATE OR REPLACE FUNCTION public.admin_organization_packages(target_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'post_price_cents', (SELECT custom_package_post_price_cents FROM public.platform_settings),
    'video_price_cents', (SELECT custom_package_video_price_cents FROM public.platform_settings),
    'credit_price_cents', (SELECT credit_price_cents FROM public.credit_pricing WHERE singleton = true),
    'packages', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(package) || pg_catalog.jsonb_build_object(
          'used_posts', usage.used_posts,
          'remaining_posts', GREATEST(0, package.posts_included - usage.used_posts),
          'used_videos', usage.used_videos,
          'remaining_videos', GREATEST(0, package.videos_included - usage.used_videos),
          'remaining_days', CASE
            WHEN package.status = 'active'
              AND package.starts_at <= pg_catalog.now()
              AND package.ends_at > pg_catalog.now()
            THEN GREATEST(0, pg_catalog.ceil(EXTRACT(epoch FROM (package.ends_at - pg_catalog.now())) / 86400))::integer
            ELSE 0
          END
        )
        ORDER BY package.starts_at DESC, package.id DESC
      )
      FROM public.custom_packages AS package
      CROSS JOIN LATERAL (
        SELECT
          (SELECT pg_catalog.count(*)::integer
             FROM public.posts
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_posts,
          (SELECT pg_catalog.count(*)::integer
             FROM public.tiktok_video_renders
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_videos
      ) AS usage
      WHERE package.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_organization_packages(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_organization_packages(uuid) TO service_role;
  END IF;
END $$;
