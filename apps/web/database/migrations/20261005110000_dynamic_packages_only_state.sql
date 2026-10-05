-- Dynamic custom packages are the only commercial entitlement.
-- Keep the public state function deterministic and do not resurrect a legacy
-- subscriptions row when an organization has no package.
CREATE OR REPLACE FUNCTION public.organization_state(p_organization_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    (
      SELECT CASE
        WHEN custom.status = 'active'
         AND custom.starts_at <= pg_catalog.now()
         AND custom.ends_at > pg_catalog.now() THEN 'active'
        WHEN custom.status = 'active' THEN 'expired'
        ELSE custom.status
      END
      FROM public.custom_packages AS custom
      WHERE custom.organization_id = p_organization_id
      ORDER BY (custom.status = 'active'
                AND custom.starts_at <= pg_catalog.now()
                AND custom.ends_at > pg_catalog.now()) DESC,
               custom.ends_at DESC, custom.id DESC
      LIMIT 1
    ),
    'none'
  );
$function$;

REVOKE ALL ON FUNCTION public.organization_state(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.organization_state(uuid) TO service_role;
  END IF;
END
$$;
