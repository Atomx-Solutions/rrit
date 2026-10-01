-- A negotiated package grants a fixed credit budget for each promised post.
-- The budget covers the initial AI workflow and one redesign allowance. It is
-- intentionally tied to the accepted package row (including a top-up merge),
-- so it is granted exactly once and can be audited independently of invoices.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS custom_package_credits_per_post integer NOT NULL DEFAULT 80
    CHECK (custom_package_credits_per_post > 0 AND custom_package_credits_per_post <= 100000);

-- Keep the credit allowance alongside the other custom-package settings so a
-- superadmin can adjust it without a deployment. A grant records the setting
-- it used in its ledger metadata, therefore later edits never rewrite history.
CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.platform_settings%ROWTYPE;
  after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.platform_settings SET
      ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
      ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
      ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd),
      custom_package_post_price_cents = COALESCE(
        (p_changes->>'custom_package_post_price_cents')::integer,
        custom_package_post_price_cents
      ),
      custom_package_credits_per_post = COALESCE(
        (p_changes->>'custom_package_credits_per_post')::integer,
        custom_package_credits_per_post
      ),
      package_request_post_options = COALESCE(
        (
          SELECT pg_catalog.array_agg(DISTINCT value::integer ORDER BY value::integer)
          FROM pg_catalog.jsonb_array_elements_text(
            CASE WHEN p_changes ? 'package_request_post_options'
              THEN p_changes->'package_request_post_options' END
          ) AS value
        ),
        package_request_post_options
      ),
      updated_at = pg_catalog.now()
    WHERE singleton
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN check_violation OR invalid_text_representation THEN
      RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'platform_settings', 'platform_settings',
    pg_catalog.to_jsonb(before_row) - 'singleton',
    pg_catalog.to_jsonb(after_row) - 'singleton',
    p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END
$function$;

CREATE OR REPLACE FUNCTION public.client_decide_custom_package_proposal(p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  proposal public.custom_packages%ROWTYPE;
  active public.custom_packages%ROWTYPE;
  invoice_id uuid;
  credit_grant_id uuid;
  credits_per_post integer;
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

  SELECT custom_package_credits_per_post INTO credits_per_post
    FROM public.platform_settings
   WHERE singleton;
  IF credits_per_post IS NULL THEN
    RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END IF;

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

  -- Credit grants are idempotent, so a retry can never fund the same accepted
  -- proposal twice. Credits are added only after the proposal is accepted.
  INSERT INTO public.credit_balances (organization_id)
  VALUES (proposal.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
  VALUES
    (
      proposal.organization_id,
      'grant',
      proposal.posts_included * credits_per_post,
      'custom_package',
      proposal.id::text,
      'custom-package-credit-grant:' || proposal.id::text,
      pg_catalog.jsonb_build_object(
        'posts_included', proposal.posts_included,
        'credits_per_post', credits_per_post
      )
    )
  ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO credit_grant_id;

  IF credit_grant_id IS NOT NULL THEN
    UPDATE public.credit_balances
       SET remaining_credits = remaining_credits + proposal.posts_included * credits_per_post,
           updated_at = pg_catalog.now()
     WHERE organization_id = proposal.organization_id;
  END IF;

  invoice_id := public.admin_issue_custom_package_invoice(proposal.id);

  UPDATE public.package_requests
     SET status = 'won', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = proposal.package_request_id;

  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END $function$;

REVOKE ALL ON FUNCTION public.client_decide_custom_package_proposal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decide_custom_package_proposal(boolean) TO app_runtime;
REVOKE ALL ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
