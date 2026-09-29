-- Do not persist an already-ended agreement as active. This covers an admin
-- shortening a package while the maintenance worker is between ticks.
CREATE OR REPLACE FUNCTION public.normalize_custom_package_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF NEW.status = 'active' AND NEW.ends_at <= pg_catalog.now() THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS custom_packages_normalize_expired_status ON public.custom_packages;
CREATE TRIGGER custom_packages_normalize_expired_status
  BEFORE INSERT OR UPDATE OF status, ends_at ON public.custom_packages
  FOR EACH ROW EXECUTE FUNCTION public.normalize_custom_package_status();

-- Reconcile any package that ended after the previous maintenance tick. The
-- existing expiry function writes the corresponding append-only audit event.
SELECT app.expire_custom_packages(pg_catalog.now());
