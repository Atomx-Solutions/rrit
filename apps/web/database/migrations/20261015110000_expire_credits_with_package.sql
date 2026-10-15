-- Credits belong to the package they were granted under, including credits
-- bought on top of it during its period. When the package expires, whatever is
-- left of them expires with it. Credits reserved by work already running stay,
-- so that work can settle, and a business with another package in force keeps
-- its balance for that package.
CREATE OR REPLACE FUNCTION app.expire_custom_packages(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  expired_count integer;
  ended record;
  balance record;
  unused bigint;
  written integer;
BEGIN
  CREATE TEMP TABLE expired_packages ON COMMIT DROP AS
  WITH expired AS (
    UPDATE public.custom_packages
       SET status = 'expired', updated_at = p_now
     WHERE status = 'active' AND ends_at <= p_now
     RETURNING id, organization_id
  )
  SELECT * FROM expired;

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
  FROM expired_packages AS expired
  JOIN public.businesses AS business ON business.id = expired.organization_id;
  GET DIAGNOSTICS expired_count = ROW_COUNT;

  FOR ended IN
    SELECT expired.id, expired.organization_id
      FROM expired_packages AS expired
     WHERE NOT EXISTS (
       SELECT 1 FROM public.custom_packages AS other
        WHERE other.organization_id = expired.organization_id
          AND other.status = 'active'
          AND other.starts_at <= p_now
          AND other.ends_at > p_now
     )
  LOOP
    SELECT remaining_credits, reserved_credits INTO balance
      FROM public.credit_balances
     WHERE organization_id = ended.organization_id
       FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    unused := balance.remaining_credits - balance.reserved_credits;
    CONTINUE WHEN unused <= 0;

    INSERT INTO public.credit_ledger
      (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
    VALUES (
      ended.organization_id, 'expire', -unused, 'custom_package', ended.id::text,
      'package-expire:' || ended.id::text,
      pg_catalog.jsonb_build_object('reason', 'package_expired', 'reserved_kept', balance.reserved_credits)
    )
    ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS written = ROW_COUNT;
    CONTINUE WHEN written = 0;

    UPDATE public.credit_balances
       SET remaining_credits = reserved_credits, updated_at = p_now
     WHERE organization_id = ended.organization_id;
  END LOOP;

  DROP TABLE expired_packages;
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
