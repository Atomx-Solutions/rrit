-- A package can stop being active three ways: it runs past its end date, the
-- superadmin cancels it, or the superadmin moves its end date into the past (a
-- trigger then marks it expired). Its credits must end in every case, so the
-- expiry lives on the status change itself rather than in one of those paths.

CREATE OR REPLACE FUNCTION app.expire_package_credits(
  p_package_id uuid,
  p_organization_id uuid,
  p_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  balance record;
  unused bigint;
  written integer;
BEGIN
  -- Another package in force keeps the balance for itself.
  IF EXISTS (
    SELECT 1 FROM public.custom_packages AS other
     WHERE other.organization_id = p_organization_id
       AND other.id <> p_package_id
       AND other.status = 'active'
       AND other.starts_at <= p_at
       AND other.ends_at > p_at
  ) THEN
    RETURN;
  END IF;

  SELECT remaining_credits, reserved_credits INTO balance
    FROM public.credit_balances
   WHERE organization_id = p_organization_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Credits reserved by work already running stay, so that work can settle.
  unused := balance.remaining_credits - balance.reserved_credits;
  IF unused <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES (
    p_organization_id, 'expire', -unused, 'custom_package', p_package_id::text,
    'package-expire:' || p_package_id::text,
    pg_catalog.jsonb_build_object('reason', 'package_ended', 'reserved_kept', balance.reserved_credits)
  )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  IF written = 0 THEN
    RETURN;
  END IF;

  UPDATE public.credit_balances
     SET remaining_credits = reserved_credits, updated_at = p_at
   WHERE organization_id = p_organization_id;
END
$function$;
REVOKE ALL ON FUNCTION app.expire_package_credits(uuid, uuid, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.expire_credits_when_package_ends()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.status = 'active' AND NEW.status IN ('expired', 'cancelled') THEN
    PERFORM app.expire_package_credits(NEW.id, NEW.organization_id, pg_catalog.now());
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app.expire_credits_when_package_ends() FROM PUBLIC;

DROP TRIGGER IF EXISTS custom_packages_expire_credits ON public.custom_packages;
CREATE TRIGGER custom_packages_expire_credits
  AFTER UPDATE OF status ON public.custom_packages
  FOR EACH ROW EXECUTE FUNCTION app.expire_credits_when_package_ends();

-- The worker's expiry no longer needs its own credit loop: the trigger above
-- handles every status change, including the ones it makes.
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
     RETURNING id, organization_id
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

-- Packages that ended after the credit rule was introduced, before this
-- trigger existed, still hold their credits; end them now.
SELECT app.expire_package_credits(package.id, package.organization_id, pg_catalog.now())
  FROM public.custom_packages AS package
 WHERE package.status IN ('expired', 'cancelled')
   AND package.updated_at >= '2026-10-15T06:42:38Z';
