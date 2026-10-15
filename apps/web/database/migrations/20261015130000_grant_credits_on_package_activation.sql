-- A package became active in three ways, but only the client accepting an
-- offer granted its credits; a package the superadmin created as active, or
-- reactivated, delivered posts and videos with no credits to make them. The
-- grant now lives on the status change, like the expiry, so every activation
-- funds the package and every end takes the unused part back.
--
-- Activations and ends are counted per package. A grant is only written when
-- every earlier grant of that package has already been ended, so an active
-- package is never funded twice, and a reactivated one is funded again.

CREATE OR REPLACE FUNCTION app.package_credit_cycles(p_package_id uuid)
RETURNS TABLE (grants bigint, expiries bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    pg_catalog.count(*) FILTER (WHERE event_type = 'grant'),
    pg_catalog.count(*) FILTER (WHERE event_type = 'expire')
  FROM public.credit_ledger
  WHERE reference_type = 'custom_package'
    AND reference_id = p_package_id::text
    AND event_type IN ('grant', 'expire');
$function$;
REVOKE ALL ON FUNCTION app.package_credit_cycles(uuid) FROM PUBLIC;

-- The first cycle keeps the keys already in use, so history stays continuous.
CREATE OR REPLACE FUNCTION app.package_credit_key(p_prefix text, p_package_id uuid, p_cycle bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_prefix || p_package_id::text || CASE WHEN p_cycle > 1 THEN ':' || p_cycle::text ELSE '' END;
$function$;

CREATE OR REPLACE FUNCTION app.grant_package_credits(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  package public.custom_packages%ROWTYPE;
  cycles record;
  credits_per_post integer;
  credits_per_video integer;
  granted bigint;
  written integer;
BEGIN
  SELECT * INTO package FROM public.custom_packages WHERE id = p_package_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO cycles FROM app.package_credit_cycles(p_package_id);
  -- Still funded from an earlier activation.
  IF cycles.grants > cycles.expiries THEN
    RETURN;
  END IF;

  SELECT custom_package_credits_per_post INTO credits_per_post FROM public.platform_settings WHERE singleton;
  SELECT video_credits INTO credits_per_video FROM public.credit_pricing WHERE singleton;
  -- Each deliverable funds the credits it will spend: posts at the per-post
  -- rate, videos at what a render costs, plus any credits sold outright.
  granted := package.posts_included * COALESCE(credits_per_post, 0)
    + package.videos_included * COALESCE(credits_per_video, 0)
    + package.credits_included;
  IF granted <= 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.credit_balances (organization_id)
  VALUES (package.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES (
    package.organization_id, 'grant', granted, 'custom_package', package.id::text,
    app.package_credit_key('custom-package-credit-grant:', package.id, cycles.grants + 1),
    pg_catalog.jsonb_build_object(
      'posts_included', package.posts_included,
      'credits_per_post', credits_per_post,
      'videos_included', package.videos_included,
      'credits_per_video', credits_per_video,
      'credits_included', package.credits_included
    )
  )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  IF written = 0 THEN
    RETURN;
  END IF;

  UPDATE public.credit_balances
     SET remaining_credits = remaining_credits + granted, updated_at = pg_catalog.now()
   WHERE organization_id = package.organization_id;
END
$function$;
REVOKE ALL ON FUNCTION app.grant_package_credits(uuid) FROM PUBLIC;

-- The expiry from 20261015120000, keyed per cycle so a reactivated package's
-- credits can end again.
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
  cycles record;
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

  SELECT * INTO cycles FROM app.package_credit_cycles(p_package_id);
  -- Nothing of this cycle left to end.
  IF cycles.expiries >= GREATEST(cycles.grants, 1) THEN
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
    app.package_credit_key('package-expire:', p_package_id, cycles.expiries + 1),
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

CREATE OR REPLACE FUNCTION app.grant_credits_when_package_activates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM app.grant_package_credits(NEW.id);
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app.grant_credits_when_package_activates() FROM PUBLIC;

DROP TRIGGER IF EXISTS custom_packages_grant_credits ON public.custom_packages;
CREATE TRIGGER custom_packages_grant_credits
  AFTER INSERT OR UPDATE OF status ON public.custom_packages
  FOR EACH ROW EXECUTE FUNCTION app.grant_credits_when_package_activates();

-- Active packages the superadmin created or reactivated before this trigger
-- existed were never funded; fund them now.
SELECT app.grant_package_credits(package.id)
  FROM public.custom_packages AS package
 WHERE package.status = 'active';
