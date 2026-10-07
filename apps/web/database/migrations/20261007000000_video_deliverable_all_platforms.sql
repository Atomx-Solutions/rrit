-- A video stopped being a TikTok-only deliverable: it is now planned, rendered
-- and published for whichever channel the brief chose, Instagram and Facebook
-- included. The storage carried the old assumption in its names, so the table,
-- the pricing column, the ledger references and the post payload are renamed to
-- say "video" and nothing about where it is published.
--
-- Every rename below is a rename, never a copy: the rows, the foreign keys and
-- the row-level security policy are the same ones, so no history is rewritten
-- and no render is counted twice against an allowance.

ALTER TABLE public.tiktok_video_renders RENAME TO video_renders;
ALTER INDEX IF EXISTS tiktok_video_renders_post RENAME TO video_renders_post;
ALTER INDEX IF EXISTS tiktok_video_renders_quota RENAME TO video_renders_quota;
ALTER POLICY tiktok_video_renders_tenant_access ON public.video_renders
  RENAME TO video_renders_tenant_access;

ALTER TABLE public.credit_pricing RENAME COLUMN tiktok_video_credits TO video_credits;
ALTER TABLE public.credit_pricing
  DROP CONSTRAINT IF EXISTS credit_pricing_tiktok_video_credits_check;
ALTER TABLE public.credit_pricing
  ADD CONSTRAINT credit_pricing_video_credits_check
    CHECK (video_credits > 0 AND video_credits <= 100000);

-- The ledger is the audit trail of real money, so the old rows are relabelled
-- rather than left behind under a name the code no longer writes. The
-- idempotency keys move with them: a settle that retries after this migration
-- must still collide with the reservation it belongs to, which it could not do
-- if the key kept a prefix the new code never produces.
UPDATE public.credit_ledger
   SET reference_type = 'video'
 WHERE reference_type = 'tiktok_video';
UPDATE public.credit_ledger
   SET idempotency_key = 'video-' || substring(idempotency_key from length('tiktok-video-') + 1)
 WHERE idempotency_key LIKE 'tiktok-video-%';

-- The brief lives inside the post payload, so the key is renamed in place for
-- every post that already carries one. Posts without a video are untouched.
UPDATE public.posts
   SET payload = (payload - 'tiktokVideo')
       || jsonb_build_object('video', payload->'tiktokVideo')
 WHERE payload ? 'tiktokVideo';

CREATE OR REPLACE FUNCTION public.admin_update_credit_pricing(
  p_actor_id uuid, p_actor_email text, p_changes jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE before_row public.credit_pricing%ROWTYPE; after_row public.credit_pricing%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.credit_pricing WHERE singleton FOR UPDATE;
  BEGIN
    UPDATE public.credit_pricing SET
      credit_price_cents = COALESCE((p_changes->>'credit_price_cents')::integer, credit_price_cents),
      provider_cost_per_credit_micro_eur = COALESCE((p_changes->>'provider_cost_per_credit_micro_eur')::integer, provider_cost_per_credit_micro_eur),
      low_credit_threshold = COALESCE((p_changes->>'low_credit_threshold')::integer, low_credit_threshold),
      video_credits = COALESCE((p_changes->>'video_credits')::integer, video_credits),
      updated_at = pg_catalog.now()
    WHERE singleton RETURNING * INTO after_row;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'SETTINGS_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'credit_pricing', 'credit_pricing', pg_catalog.to_jsonb(before_row) - 'singleton', pg_catalog.to_jsonb(after_row) - 'singleton', p_changes);
  RETURN pg_catalog.to_jsonb(after_row) - 'singleton';
END $function$;

CREATE OR REPLACE FUNCTION public.admin_organization_packages(target_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'post_price_cents', (SELECT custom_package_post_price_cents FROM public.platform_settings),
    'video_price_cents', (SELECT custom_package_video_price_cents FROM public.platform_settings),
    'credit_price_cents', (SELECT credit_price_cents FROM public.credit_pricing WHERE singleton = true),
    'packages', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(package) || pg_catalog.jsonb_build_object(
          'used_posts', usage.used_posts,
          'remaining_posts', GREATEST(0, package.posts_included - usage.used_posts),
          'used_videos', usage.used_videos,
          'remaining_videos', GREATEST(0, package.videos_included - usage.used_videos),
          'remaining_days', CASE
            WHEN package.status = 'active'
              AND package.starts_at <= pg_catalog.now()
              AND package.ends_at > pg_catalog.now()
            THEN GREATEST(0, pg_catalog.ceil(EXTRACT(epoch FROM (package.ends_at - pg_catalog.now())) / 86400))::integer
            ELSE 0
          END
        )
        ORDER BY package.starts_at DESC, package.id DESC
      )
      FROM public.custom_packages AS package
      CROSS JOIN LATERAL (
        SELECT
          (SELECT pg_catalog.count(*)::integer
             FROM public.posts
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_posts,
          (SELECT pg_catalog.count(*)::integer
             FROM public.video_renders
            WHERE business_id = package.organization_id
              AND created_at >= package.starts_at
              AND created_at < package.ends_at) AS used_videos
      ) AS usage
      WHERE package.organization_id = target_organization_id
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_organization_packages(uuid) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_organization_packages(uuid) TO service_role;
  END IF;
END $do$;

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
  SELECT video_credits INTO credits_per_video
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
