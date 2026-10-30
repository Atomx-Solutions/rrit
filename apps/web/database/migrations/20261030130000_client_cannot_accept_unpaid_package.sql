-- A client could accept a draft offer through client_decide_custom_package_proposal(true)
-- and receive its posts, videos and credits without paying. Offers are now
-- paid through Paddle, whose webhook activates them, and superadmins change
-- packages from their own functions, so the client keeps only the decline.
DROP FUNCTION IF EXISTS public.client_decide_custom_package_proposal(boolean);

CREATE OR REPLACE FUNCTION public.client_decline_custom_package_proposal()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  proposal public.custom_packages%ROWTYPE;
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

  UPDATE public.custom_packages
     SET status = 'cancelled', updated_at = pg_catalog.now()
   WHERE id = proposal.id
   RETURNING * INTO proposal;
  UPDATE public.package_requests
     SET status = 'lost', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = proposal.package_request_id;
  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.client_decline_custom_package_proposal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decline_custom_package_proposal() TO app_runtime;
