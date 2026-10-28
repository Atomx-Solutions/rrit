-- The admin overview and currency reads go through the service role, which had
-- no read access to these tables in production.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.custom_packages, public.platform_settings TO service_role;
  END IF;
END
$$;
