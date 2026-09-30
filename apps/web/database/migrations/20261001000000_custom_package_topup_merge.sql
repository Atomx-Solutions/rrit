-- Allow a client to accept a custom-package proposal while an active package
-- already exists: instead of failing with PACKAGE_ACTIVE_EXISTS, the proposal
-- is merged into the active package (posts_included and price_cents are added
-- together), and the proposal itself is marked 'merged' with a pointer back to
-- the active package so the history reads as parent + top-ups.
--
-- The invoice is still issued against the proposal id: it carries the delta
-- (top-up amount), never the full price of the parent package.

ALTER TABLE public.custom_packages
  ADD COLUMN IF NOT EXISTS parent_package_id uuid
    REFERENCES public.custom_packages(id) ON DELETE SET NULL;

ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_status_check;
ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_status_check
  CHECK (status IN ('draft', 'active', 'expired', 'cancelled', 'merged'));

CREATE INDEX IF NOT EXISTS custom_packages_parent_package_idx
  ON public.custom_packages (parent_package_id)
  WHERE parent_package_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.client_decide_custom_package_proposal(p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  proposal public.custom_packages%ROWTYPE;
  active public.custom_packages%ROWTYPE;
  invoice_id uuid;
BEGIN
  SELECT * INTO proposal
    FROM public.custom_packages
   WHERE organization_id = app.current_organization_id()
     AND status = 'draft'
   ORDER BY created_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_PROPOSAL_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_accept THEN
    UPDATE public.custom_packages
       SET status = 'cancelled', updated_at = pg_catalog.now()
     WHERE id = proposal.id
     RETURNING * INTO proposal;
    UPDATE public.package_requests
       SET status = 'lost', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = proposal.package_request_id;
    RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
  END IF;

  -- Accepting. If an active package already exists, merge the proposal into it
  -- rather than swapping the active for the new one.
  SELECT * INTO active
    FROM public.custom_packages
   WHERE organization_id = proposal.organization_id
     AND status = 'active'
     AND id <> proposal.id
   ORDER BY ends_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.custom_packages
       SET posts_included = active.posts_included + proposal.posts_included,
           price_cents = active.price_cents + proposal.price_cents,
           suggested_price_cents = active.suggested_price_cents + proposal.suggested_price_cents,
           ends_at = GREATEST(active.ends_at, proposal.ends_at),
           updated_at = pg_catalog.now()
     WHERE id = active.id;

    UPDATE public.custom_packages
       SET status = 'merged',
           parent_package_id = active.id,
           updated_at = pg_catalog.now()
     WHERE id = proposal.id
     RETURNING * INTO proposal;
  ELSE
    BEGIN
      UPDATE public.custom_packages
         SET status = 'active', updated_at = pg_catalog.now()
       WHERE id = proposal.id
       RETURNING * INTO proposal;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    END;
  END IF;

  -- Invoice always tied to the proposal row: for a first activation it holds
  -- the full agreed price, for a merge it holds the top-up delta only.
  invoice_id := public.admin_issue_custom_package_invoice(proposal.id);

  UPDATE public.package_requests
     SET status = 'won', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = proposal.package_request_id;

  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END $function$;

REVOKE ALL ON FUNCTION public.client_decide_custom_package_proposal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decide_custom_package_proposal(boolean) TO app_runtime;
