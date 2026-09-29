-- Package usage belongs to the agreement window, never to a calendar month.
-- This makes every historical package visible to the superadmin with the posts
-- created while that exact package was in effect.

CREATE OR REPLACE FUNCTION public.admin_organization_packages(target_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'post_price_cents', (SELECT custom_package_post_price_cents FROM public.platform_settings),
    'packages', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(package) || pg_catalog.jsonb_build_object(
          'used_posts', usage.used_posts,
          'remaining_posts', GREATEST(0, package.posts_included - usage.used_posts),
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
        SELECT pg_catalog.count(*)::integer AS used_posts
        FROM public.posts
        WHERE business_id = package.organization_id
          AND created_at >= package.starts_at
          AND created_at < package.ends_at
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
END
$$;
