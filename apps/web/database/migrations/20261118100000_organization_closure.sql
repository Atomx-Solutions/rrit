-- A superadmin can close an organization. Closing never deletes it: invoices,
-- payments, the credit ledger and audit events are kept as proof of what was
-- bought and paid, and the database refuses to delete them anyway. A closed
-- organization loses access at once, its unused credits are forfeited without
-- a refund, and it can be reopened until purge_after; its content is removed
-- after that by the retention clean-up.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS close_reason text,
  ADD COLUMN IF NOT EXISTS purge_after timestamptz;

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
     SET status = 'cancelled', updated_at = pg_catalog.now()
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
    p_organization_id, p_organization_id, p_actor_id, 'admin_organization.closed', 'organization',
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

-- Reopening restores access only: forfeited credits, ended packages and
-- cancelled publications stay as they are.
CREATE OR REPLACE FUNCTION public.admin_reopen_organization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  organization public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO organization FROM public.organizations WHERE id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF organization.status <> 'archived' OR organization.closed_at IS NULL THEN
    RAISE EXCEPTION 'ORGANIZATION_NOT_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  IF organization.purge_after <= pg_catalog.now() THEN
    RAISE EXCEPTION 'ORGANIZATION_REOPEN_EXPIRED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.organizations
     SET status = 'active', closed_at = NULL, closed_by = NULL, close_reason = NULL, purge_after = NULL,
         updated_at = pg_catalog.now()
   WHERE id = p_organization_id
  RETURNING * INTO organization;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    p_organization_id, p_organization_id, p_actor_id, 'admin_organization.reopened', 'organization',
    p_organization_id::text, 'succeeded',
    pg_catalog.jsonb_build_object('event_type', 'admin_organization_closure', 'actor_email', p_actor_email),
    0
  );

  RETURN pg_catalog.jsonb_build_object('id', organization.id, 'status', organization.status);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_close_organization(uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reopen_organization(uuid, uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_close_organization(uuid, uuid, text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_reopen_organization(uuid, uuid, text) TO service_role;
  END IF;
END
$$;
