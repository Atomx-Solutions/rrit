-- Package expiry is a system transition. The function owns both the status
-- update and its append-only audit row, so a delayed maintenance tick cannot
-- leave a package entitled past its end (runtime checks the dates as well).
CREATE OR REPLACE FUNCTION app.expire_custom_packages(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  expired_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.custom_packages
       SET status = 'expired', updated_at = p_now
     WHERE status = 'active' AND ends_at <= p_now
     RETURNING id, organization_id, name, starts_at, ends_at, posts_included, price_cents
  ), audited AS (
    INSERT INTO public.audit_events
      (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
    SELECT
      expired.organization_id,
      expired.organization_id,
      business.owner_id,
      'admin_custom_package.expired',
      'custom_package',
      expired.id::text,
      'succeeded',
      pg_catalog.jsonb_build_object(
        'event_type', 'admin_custom_package_change',
        'actor_email', 'system',
        'changes', pg_catalog.jsonb_build_object('status', 'expired', 'action', 'expiry'),
        'before', pg_catalog.jsonb_build_object('status', 'active'),
        'after', pg_catalog.jsonb_build_object('status', 'expired')
      ),
      business.revision
    FROM expired
    JOIN public.businesses AS business ON business.id = expired.organization_id
    RETURNING id
  )
  SELECT count(*)::integer INTO expired_count FROM audited;

  RETURN expired_count;
END
$function$;

REVOKE ALL ON FUNCTION app.expire_custom_packages(timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT EXECUTE ON FUNCTION app.expire_custom_packages(timestamptz) TO rrit_worker;
  END IF;
END
$$;
