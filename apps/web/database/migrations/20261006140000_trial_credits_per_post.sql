-- The credits a post is worth are configured once, in platform settings, and
-- the superadmin changes that rate from the admin panel. Trials ignored it and
-- funded every post at a rate written into the application instead, so a trial
-- kept arriving with 80 credits a post however the panel was set.
--
-- platform_settings is not readable by the runtime role, and widening it would
-- expose provider balances and invoice settings along with the rate. This
-- exposes the one number instead.
CREATE OR REPLACE FUNCTION public.credits_per_post()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT custom_package_credits_per_post FROM public.platform_settings WHERE singleton;
$function$;

REVOKE ALL ON FUNCTION public.credits_per_post() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.credits_per_post() TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT EXECUTE ON FUNCTION public.credits_per_post() TO rrit_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.credits_per_post() TO service_role;
  END IF;
END $$;
