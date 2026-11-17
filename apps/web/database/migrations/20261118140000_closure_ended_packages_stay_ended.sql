-- Closing an organization ends its active package and forfeits the unused
-- credits. Reactivating that package afterwards funded it in full again,
-- because every activation grants a package's credits, so a reopened
-- organization could get back far more than it lost. A package ended by a
-- closure is now marked, and it can no longer be made active: the agreed
-- terms of a reopened organization are a new package.
ALTER TABLE public.custom_packages
  ADD COLUMN IF NOT EXISTS ended_by_closure boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app.refuse_reactivating_closure_package()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $function$
BEGIN
  IF OLD.ended_by_closure AND NEW.status = 'active' AND OLD.status <> 'active' THEN
    RAISE EXCEPTION 'PACKAGE_ENDED_BY_CLOSURE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app.refuse_reactivating_closure_package() FROM PUBLIC;

DROP TRIGGER IF EXISTS custom_packages_refuse_closure_reactivation ON public.custom_packages;
CREATE TRIGGER custom_packages_refuse_closure_reactivation
  BEFORE UPDATE OF status ON public.custom_packages
  FOR EACH ROW EXECUTE FUNCTION app.refuse_reactivating_closure_package();

CREATE OR REPLACE FUNCTION public.admin_close_organization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text,
  p_reason text,
  p_grace_days integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  organization public.organizations%ROWTYPE;
  reason text := NULLIF(pg_catalog.btrim(p_reason), '');
  balance record;
  unused bigint;
  packages_ended integer;
  publications_cancelled integer;
  spendable_before bigint;
BEGIN
  IF reason IS NULL OR pg_catalog.length(reason) > 500 THEN
    RAISE EXCEPTION 'CLOSE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_grace_days IS NULL OR p_grace_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'INVALID_ACTION' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO organization FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF organization.status <> 'active' THEN
    RAISE EXCEPTION 'ORGANIZATION_ALREADY_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  -- Work already running would be cut off half way, with its credits still
  -- reserved; the organization is closed once it has settled.
  IF EXISTS (SELECT 1 FROM public.video_renders WHERE business_id = p_organization_id AND status IN ('queued', 'rendering'))
     OR EXISTS (SELECT 1 FROM public.image_edits WHERE business_id = p_organization_id AND status IN ('queued', 'editing'))
     OR EXISTS (SELECT 1 FROM public.publication_jobs WHERE business_id = p_organization_id AND status = 'processing') THEN
    RAISE EXCEPTION 'ORGANIZATION_WORK_IN_FLIGHT' USING ERRCODE = 'P0001';
  END IF;

  -- Nothing is published or planned for a closed organization.
  UPDATE public.publication_jobs
     SET status = 'cancelled', failure_code = 'organization_closed', updated_at = pg_catalog.now()
   WHERE business_id = p_organization_id AND status = 'pending';
  GET DIAGNOSTICS publications_cancelled = ROW_COUNT;
  UPDATE public.monthly_planner_settings SET enabled = false WHERE business_id = p_organization_id;

  -- What was spendable before closing, for the audit record.
  SELECT GREATEST(remaining_credits - reserved_credits, 0) INTO spendable_before
    FROM public.credit_balances WHERE organization_id = p_organization_id;

  -- Ending the packages takes their unused credits back (the package trigger
  -- writes the expiry); anything left from elsewhere is forfeited here.
  UPDATE public.custom_packages
     SET status = 'cancelled', ended_by_closure = true, updated_at = pg_catalog.now()
   WHERE organization_id = p_organization_id AND status = 'active';
  GET DIAGNOSTICS packages_ended = ROW_COUNT;

  SELECT remaining_credits, reserved_credits INTO balance
    FROM public.credit_balances WHERE organization_id = p_organization_id FOR UPDATE;
  unused := COALESCE(balance.remaining_credits - balance.reserved_credits, 0);
  IF unused > 0 THEN
    INSERT INTO public.credit_ledger
      (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
    VALUES (
      p_organization_id, 'expire', -unused, 'organization_closure', p_organization_id::text,
      'organization-closure:' || p_organization_id::text || ':' || pg_catalog.date_part('epoch', pg_catalog.now())::bigint::text,
      pg_catalog.jsonb_build_object('reason', 'organization_closed', 'actor_email', p_actor_email)
    );
    UPDATE public.credit_balances
       SET remaining_credits = reserved_credits, updated_at = pg_catalog.now()
     WHERE organization_id = p_organization_id;
  END IF;

  UPDATE public.organizations
     SET status = 'archived', closed_at = pg_catalog.now(), closed_by = p_actor_id, close_reason = reason,
         purge_after = pg_catalog.now() + pg_catalog.make_interval(days => p_grace_days),
         updated_at = pg_catalog.now()
   WHERE id = p_organization_id
  RETURNING * INTO organization;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    (SELECT id FROM public.businesses WHERE id = p_organization_id),
    CASE WHEN EXISTS (SELECT 1 FROM public.businesses WHERE id = p_organization_id) THEN p_organization_id END,
    p_actor_id, 'admin_organization.closed', 'organization',
    p_organization_id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_organization_closure', 'actor_email', p_actor_email, 'reason', reason,
      'purge_after', organization.purge_after, 'packages_ended', packages_ended,
      'credits_forfeited', COALESCE(spendable_before, 0), 'publications_cancelled', publications_cancelled
    ),
    0
  );

  RETURN pg_catalog.jsonb_build_object(
    'id', organization.id, 'status', organization.status, 'closed_at', organization.closed_at,
    'purge_after', organization.purge_after, 'close_reason', organization.close_reason
  );
END
$function$;

