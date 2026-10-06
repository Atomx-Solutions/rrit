-- Two settings described the same video: one granted credits when a video was
-- bought, the other charged credits when it was rendered. Nothing kept them in
-- step, so a package could fund 150 credits for a render that costs 23, or far
-- less than one render.
--
-- There is only one honest number here: what a render costs. A bought video
-- funds exactly the render it was bought for, so the grant is derived from
-- credit_pricing.tiktok_video_credits and the separate setting is removed.
--
-- Posts keep their own per-post setting, because a post has no single charge to
-- derive one from.
ALTER TABLE public.platform_settings
  DROP COLUMN IF EXISTS custom_package_credits_per_video;

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(
  p_actor_id uuid, p_actor_email text, p_changes jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE before_row public.platform_settings%ROWTYPE; after_row public.platform_settings%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.platform_settings WHERE singleton FOR UPDATE;
  UPDATE public.platform_settings SET
    custom_package_post_price_cents = COALESCE((p_changes->>'custom_package_post_price_cents')::integer, custom_package_post_price_cents),
    custom_package_video_price_cents = COALESCE((p_changes->>'custom_package_video_price_cents')::integer, custom_package_video_price_cents),
    custom_package_credits_per_post = COALESCE((p_changes->>'custom_package_credits_per_post')::integer, custom_package_credits_per_post),
    package_expiry_reminder_days = COALESCE((p_changes->>'package_expiry_reminder_days')::integer, package_expiry_reminder_days),
    package_request_post_options = COALESCE((SELECT array_agg(DISTINCT value::integer ORDER BY value::integer) FROM jsonb_array_elements_text(CASE WHEN p_changes ? 'package_request_post_options' THEN p_changes->'package_request_post_options' END) AS value), package_request_post_options),
    ai_top_up_url = COALESCE(p_changes->>'ai_top_up_url', ai_top_up_url),
    ai_warn_balance_usd = COALESCE((p_changes->>'ai_warn_balance_usd')::numeric, ai_warn_balance_usd),
    ai_low_balance_usd = COALESCE((p_changes->>'ai_low_balance_usd')::numeric, ai_low_balance_usd), updated_at = now()
  WHERE singleton RETURNING * INTO after_row;
  PERFORM public.admin_record_platform_change(p_actor_id,p_actor_email,'platform_settings','platform_settings',to_jsonb(before_row)-'singleton',to_jsonb(after_row)-'singleton',p_changes);
  RETURN to_jsonb(after_row)-'singleton';
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.client_decide_custom_package_proposal(p_accept boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  proposal public.custom_packages%ROWTYPE;
  active public.custom_packages%ROWTYPE;
  invoice_id uuid;
  credit_grant_id uuid;
  credits_per_post integer;
  credits_per_video integer;
  granted_credits integer;
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
  -- A bought video funds exactly the render it was bought for, so the grant is
  -- the render charge itself rather than a second setting that can drift.
  SELECT tiktok_video_credits INTO credits_per_video
    FROM public.credit_pricing
   WHERE singleton = true;
  IF credits_per_post IS NULL OR credits_per_video IS NULL THEN
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
           videos_included = active.videos_included + proposal.videos_included,
           credits_included = active.credits_included + proposal.credits_included,
           price_cents = active.price_cents + proposal.price_cents,
           suggested_price_cents = active.suggested_price_cents + proposal.suggested_price_cents,
           -- Only posts buy time. A top-up of credits or videos joins the
           -- package that is already running and never pushes its end date out.
           ends_at = CASE
             WHEN proposal.posts_included = 0 THEN active.ends_at
             ELSE GREATEST(active.ends_at, proposal.ends_at)
           END,
           updated_at = pg_catalog.now()
     WHERE id = active.id;

    UPDATE public.custom_packages
       SET status = 'merged',
           parent_package_id = active.id,
           updated_at = pg_catalog.now()
     WHERE id = proposal.id
     RETURNING * INTO proposal;
  ELSE
    -- Credits belong to a package: without one there is nothing to join, and a
    -- package of pure credits would grant AI with no posts to spend it on. A
    -- video package is not in that position, because it carries its own
    -- allowance and its own period, so it may stand on its own.
    IF proposal.posts_included = 0 AND proposal.videos_included = 0 THEN
      RAISE EXCEPTION 'ACTIVE_PACKAGE_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      UPDATE public.custom_packages
         SET status = 'active', updated_at = pg_catalog.now()
       WHERE id = proposal.id
       RETURNING * INTO proposal;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    END;
  END IF;

  -- Each deliverable funds the credits it will spend: posts at the per-post
  -- rate, videos at what a render costs, plus any credits sold outright.
  granted_credits := proposal.posts_included * credits_per_post
    + proposal.videos_included * credits_per_video
    + proposal.credits_included;

  -- The ledger records movements only, so nothing is written when a proposal
  -- grants nothing.
  IF granted_credits > 0 THEN
    INSERT INTO public.credit_balances (organization_id)
    VALUES (proposal.organization_id)
    ON CONFLICT (organization_id) DO NOTHING;

    INSERT INTO public.credit_ledger
      (organization_id, event_type, credit_delta, reference_type, reference_id, idempotency_key, metadata)
    VALUES
      (
        proposal.organization_id,
        'grant',
        granted_credits,
        'custom_package',
        proposal.id::text,
        'custom-package-credit-grant:' || proposal.id::text,
        pg_catalog.jsonb_build_object(
          'posts_included', proposal.posts_included,
          'credits_per_post', credits_per_post,
          'videos_included', proposal.videos_included,
          'credits_per_video', credits_per_video,
          'credits_included', proposal.credits_included
        )
      )
    ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id INTO credit_grant_id;

    IF credit_grant_id IS NOT NULL THEN
      UPDATE public.credit_balances
         SET remaining_credits = remaining_credits + granted_credits,
             updated_at = pg_catalog.now()
       WHERE organization_id = proposal.organization_id;
    END IF;
  END IF;

  invoice_id := public.admin_issue_custom_package_invoice(proposal.id);

  UPDATE public.package_requests
     SET status = 'won', handled_at = pg_catalog.now(), updated_at = pg_catalog.now()
   WHERE id = proposal.package_request_id;

  RETURN pg_catalog.to_jsonb(proposal) || pg_catalog.jsonb_build_object('invoice_id', invoice_id);
END $function$;

REVOKE ALL ON FUNCTION public.client_decide_custom_package_proposal(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_decide_custom_package_proposal(boolean) TO app_runtime;
