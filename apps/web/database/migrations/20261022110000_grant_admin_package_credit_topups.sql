-- Editing an already active package used to change credits_included without
-- funding the business. Package activation is funded by its own trigger, but
-- an admin top-up must credit only the newly added amount.
CREATE OR REPLACE FUNCTION app.grant_admin_package_credit_topup(
  p_package_id uuid,
  p_credit_delta integer,
  p_credits_included integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  package public.custom_packages%ROWTYPE;
  written integer;
BEGIN
  IF p_credit_delta <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO package
    FROM public.custom_packages
   WHERE id = p_package_id
     AND status = 'active';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.credit_balances (organization_id)
  VALUES (package.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- The total is part of the key. A retried save cannot fund the same top-up
  -- twice, while each higher total funds only its incremental difference.
  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id,
     idempotency_key, metadata)
  VALUES (
    package.organization_id, 'grant', p_credit_delta, 'custom_package', package.id::text,
    'admin-custom-package-credit-topup:' || package.id::text || ':' || p_credits_included::text,
    pg_catalog.jsonb_build_object(
      'reason', 'admin_extra_credits_topup',
      'credit_delta', p_credit_delta,
      'credits_included', p_credits_included
    )
  )
  ON CONFLICT (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  IF written = 0 THEN
    RETURN;
  END IF;

  UPDATE public.credit_balances
     SET remaining_credits = remaining_credits + p_credit_delta,
         updated_at = pg_catalog.now()
   WHERE organization_id = package.organization_id;
END
$function$;

REVOKE ALL ON FUNCTION app.grant_admin_package_credit_topup(uuid, integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_update_custom_package(
  p_package_id uuid, p_actor_id uuid, p_actor_email text, p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.custom_packages%ROWTYPE;
  after_row public.custom_packages%ROWTYPE;
  next_posts integer;
  next_videos integer;
  next_credits integer;
  next_post_rate integer;
  next_video_rate integer;
  credit_rate integer;
  previous_suggested integer;
  next_suggested integer;
  selected_currency text;
BEGIN
  SELECT * INTO before_row FROM public.custom_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  SELECT CASE WHEN package_currency = 'EUR' THEN 'EUR' ELSE 'CHF' END
    INTO selected_currency FROM public.platform_settings WHERE singleton;
  next_posts := COALESCE((p_changes->>'posts_included')::integer, before_row.posts_included);
  next_videos := COALESCE((p_changes->>'videos_included')::integer, before_row.videos_included);
  next_credits := COALESCE((p_changes->>'credits_included')::integer, before_row.credits_included);
  next_post_rate := COALESCE((p_changes->>'post_price_cents')::integer, before_row.post_price_cents);
  next_video_rate := COALESCE((p_changes->>'video_price_cents')::integer, before_row.video_price_cents);
  SELECT COALESCE(credit_price_cents, 0) INTO credit_rate FROM public.credit_pricing WHERE singleton;
  previous_suggested := before_row.posts_included * before_row.post_price_cents
    + before_row.videos_included * before_row.video_price_cents
    + before_row.credits_included * COALESCE(credit_rate, 0);
  next_suggested := next_posts * next_post_rate + next_videos * next_video_rate
    + next_credits * COALESCE(credit_rate, 0);

  BEGIN
    UPDATE public.custom_packages SET
      name = COALESCE(p_changes->>'name', name),
      posts_included = next_posts,
      videos_included = next_videos,
      credits_included = next_credits,
      post_price_cents = next_post_rate,
      video_price_cents = next_video_rate,
      suggested_price_cents = next_suggested,
      price_cents = COALESCE((p_changes->>'price_cents')::integer,
        CASE WHEN before_row.price_cents = previous_suggested THEN next_suggested ELSE price_cents END),
      currency = COALESCE(selected_currency, 'CHF'),
      starts_at = COALESCE((p_changes->>'starts_at')::timestamptz, starts_at),
      ends_at = COALESCE((p_changes->>'ends_at')::timestamptz, ends_at),
      status = COALESCE(p_changes->>'status', status),
      notes = CASE WHEN p_changes ? 'notes' THEN p_changes->>'notes' ELSE notes END,
      updated_at = pg_catalog.now()
    WHERE id = p_package_id
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'PACKAGE_ACTIVE_EXISTS' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation OR invalid_text_representation
      THEN RAISE EXCEPTION 'PACKAGE_INVALID' USING ERRCODE = 'P0001';
  END;

  IF before_row.status = 'active'
     AND after_row.status = 'active'
     AND after_row.credits_included > before_row.credits_included THEN
    PERFORM app.grant_admin_package_credit_topup(
      after_row.id,
      after_row.credits_included - before_row.credits_included,
      after_row.credits_included
    );
  END IF;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES
    (before_row.organization_id, before_row.organization_id, p_actor_id, 'admin_custom_package.update',
     'custom_package', p_package_id::text, 'succeeded', pg_catalog.jsonb_build_object(
     'event_type', 'admin_custom_package_change', 'actor_email', p_actor_email,
     'changes', p_changes, 'before', pg_catalog.to_jsonb(before_row), 'after', pg_catalog.to_jsonb(after_row)), 0);
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_update_custom_package(uuid, uuid, text, jsonb) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_update_custom_package(uuid, uuid, text, jsonb) TO service_role;
  END IF;
END
$$;
