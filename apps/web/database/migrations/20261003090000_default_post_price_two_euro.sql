-- The public page now quotes a per-post price before anyone fills in a form,
-- so the figure it quotes has to be the one the platform actually charges.
-- Two euro becomes that figure, as the default for a fresh install and as the
-- current setting. A superadmin can still change it from the billing screen,
-- and an agreed package keeps the rate it was written with.

ALTER TABLE public.platform_settings
  ALTER COLUMN custom_package_post_price_cents SET DEFAULT 200;

UPDATE public.platform_settings
   SET custom_package_post_price_cents = 200,
       updated_at = pg_catalog.now()
 WHERE singleton;

-- The public landing page asks for this without a session, so it is read
-- through a definer function rather than by opening the settings table.
CREATE OR REPLACE FUNCTION public.package_request_post_price_cents()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT custom_package_post_price_cents FROM public.platform_settings;
$function$;

REVOKE ALL ON FUNCTION public.package_request_post_price_cents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_request_post_price_cents() TO app_runtime;
