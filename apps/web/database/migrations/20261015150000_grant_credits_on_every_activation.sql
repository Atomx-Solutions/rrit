-- The balance is one per business, but 20261015130000 counted grants and
-- expiries per package. When one package ended it took the whole balance,
-- including credits granted under another package, so that other package
-- looked "still funded" and was not funded again when reactivated.
--
-- The trigger only fires when a package becomes active, so every such change
-- starts a new cycle and is funded. The "still funded" check stays only for
-- the reconciliation call, which runs over packages that are already active.

CREATE OR REPLACE FUNCTION app.grant_package_credits(p_package_id uuid, p_activation boolean DEFAULT false)
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
  IF NOT p_activation AND cycles.grants > cycles.expiries THEN
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

  -- The first cycle keeps the key the client's acceptance also writes, so an
  -- accepted offer is still funded exactly once.
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
REVOKE ALL ON FUNCTION app.grant_package_credits(uuid, boolean) FROM PUBLIC;
DROP FUNCTION IF EXISTS app.grant_package_credits(uuid);

CREATE OR REPLACE FUNCTION app.grant_credits_when_package_activates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status <> 'active') THEN
    PERFORM app.grant_package_credits(NEW.id, true);
  END IF;
  RETURN NEW;
END
$function$;

-- Active packages whose credits were taken by another package's end after
-- they were last funded: fund them again.
SELECT app.grant_package_credits(package.id, true)
  FROM public.custom_packages AS package
 WHERE package.status = 'active'
   AND package.starts_at <= pg_catalog.now()
   AND package.ends_at > pg_catalog.now()
   AND EXISTS (
     SELECT 1 FROM public.credit_ledger AS ended
      WHERE ended.organization_id = package.organization_id
        AND ended.event_type = 'expire'
        AND ended.created_at > COALESCE((
          SELECT pg_catalog.max(grant_entry.created_at) FROM public.credit_ledger AS grant_entry
           WHERE grant_entry.reference_type = 'custom_package'
             AND grant_entry.reference_id = package.id::text
             AND grant_entry.event_type = 'grant'
        ), '-infinity')
   );
