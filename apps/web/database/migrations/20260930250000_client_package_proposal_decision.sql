ALTER TABLE public.custom_packages ADD COLUMN IF NOT EXISTS package_request_id uuid REFERENCES public.package_requests(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.client_decide_custom_package_proposal(p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE proposal public.custom_packages%ROWTYPE; invoice_id uuid;
BEGIN
  SELECT * INTO proposal FROM public.custom_packages WHERE organization_id=app.current_organization_id() AND status='draft' ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_PROPOSAL_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF p_accept THEN
    BEGIN UPDATE public.custom_packages SET status='active',updated_at=pg_catalog.now() WHERE id=proposal.id RETURNING * INTO proposal;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE='P0001'; END;
    invoice_id := public.admin_issue_custom_package_invoice(proposal.id);
    UPDATE public.package_requests SET status='won',handled_at=pg_catalog.now(),updated_at=pg_catalog.now() WHERE id=proposal.package_request_id;
  ELSE
    UPDATE public.custom_packages SET status='cancelled',updated_at=pg_catalog.now() WHERE id=proposal.id RETURNING * INTO proposal;
    UPDATE public.package_requests SET status='lost',handled_at=pg_catalog.now(),updated_at=pg_catalog.now() WHERE id=proposal.package_request_id;
  END IF;
  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id',invoice_id);
END $function$;
REVOKE ALL ON FUNCTION public.client_decide_custom_package_proposal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decide_custom_package_proposal(boolean) TO app_runtime;
