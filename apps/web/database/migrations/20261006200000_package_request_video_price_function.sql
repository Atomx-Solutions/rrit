CREATE OR REPLACE FUNCTION public.package_request_video_price_cents()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT custom_package_video_price_cents FROM public.platform_settings WHERE singleton;
$function$;

REVOKE ALL ON FUNCTION public.package_request_video_price_cents() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.package_request_video_price_cents() TO app_runtime;
