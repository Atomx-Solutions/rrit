-- Fund only the paid add-on. Re-granting the merged parent package duplicates
-- all of its previously funded posts, videos and purchased credits.
CREATE OR REPLACE FUNCTION app.grant_paddle_addon_credits(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  payment_order public.paddle_payment_orders%ROWTYPE;
  credits_per_post integer;
  credits_per_video integer;
  granted bigint;
  written integer;
BEGIN
  SELECT * INTO payment_order
    FROM public.paddle_payment_orders
   WHERE id = p_order_id AND status = 'paid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paid Paddle order not found: %', p_order_id;
  END IF;

  SELECT custom_package_credits_per_post INTO credits_per_post
    FROM public.platform_settings WHERE singleton;
  SELECT video_credits INTO credits_per_video
    FROM public.credit_pricing WHERE singleton;
  granted := payment_order.posts_included * COALESCE(credits_per_post, 0)
    + payment_order.videos_included * COALESCE(credits_per_video, 0)
    + payment_order.credits_included;
  IF granted <= 0 THEN RETURN; END IF;

  INSERT INTO public.credit_balances (organization_id)
  VALUES (payment_order.organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  INSERT INTO public.credit_ledger
    (organization_id, event_type, credit_delta, reference_type, reference_id,
     idempotency_key, metadata)
  VALUES (
    payment_order.organization_id, 'grant', granted, 'custom_package',
    payment_order.package_id::text, 'paddle-addon-credit-grant:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'paddle_order_id', p_order_id,
      'posts_included', payment_order.posts_included,
      'credits_per_post', credits_per_post,
      'videos_included', payment_order.videos_included,
      'credits_per_video', credits_per_video,
      'credits_included', payment_order.credits_included
    )
  )
  ON CONFLICT (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS written = ROW_COUNT;
  IF written = 0 THEN RETURN; END IF;

  UPDATE public.credit_balances
     SET remaining_credits = remaining_credits + granted,
         updated_at = pg_catalog.now()
   WHERE organization_id = payment_order.organization_id;
END
$function$;

REVOKE ALL ON FUNCTION app.grant_paddle_addon_credits(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.process_paddle_payment(
  p_order_id uuid,
  p_transaction_id text,
  p_event_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  payment_order public.paddle_payment_orders%ROWTYPE;
  active_package public.custom_packages%ROWTYPE;
  proposal public.custom_packages%ROWTYPE;
BEGIN
  SELECT * INTO payment_order
    FROM public.paddle_payment_orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paddle payment order not found: %', p_order_id;
  END IF;
  IF payment_order.status = 'paid' THEN RETURN; END IF;
  IF payment_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Paddle payment order is not pending: %', p_order_id;
  END IF;

  SELECT * INTO proposal
    FROM public.custom_packages
   WHERE id = payment_order.package_id
     AND organization_id = payment_order.organization_id
   FOR UPDATE;
  IF NOT FOUND OR proposal.status <> 'draft' THEN
    RAISE EXCEPTION 'Paddle package proposal is not pending: %', payment_order.package_id;
  END IF;
  IF payment_order.paddle_transaction_id IS DISTINCT FROM p_transaction_id THEN
    RAISE EXCEPTION 'Paddle transaction does not match order: %', p_order_id;
  END IF;

  UPDATE public.paddle_payment_orders
     SET status = 'paid', paddle_event_id = p_event_id,
         paid_at = COALESCE(paid_at, pg_catalog.now()), updated_at = pg_catalog.now()
   WHERE id = p_order_id;

  SELECT * INTO active_package
    FROM public.custom_packages
   WHERE organization_id = payment_order.organization_id
     AND status = 'active'
     AND id <> payment_order.package_id
   ORDER BY ends_at DESC, id DESC
   LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.custom_packages
       SET posts_included = active_package.posts_included + payment_order.posts_included,
           videos_included = active_package.videos_included + payment_order.videos_included,
           credits_included = active_package.credits_included + payment_order.credits_included,
           price_cents = active_package.price_cents + payment_order.amount_cents,
           ends_at = CASE WHEN payment_order.posts_included = 0
                          THEN active_package.ends_at
                          ELSE GREATEST(active_package.ends_at, ends_at) END,
           updated_at = pg_catalog.now()
     WHERE id = active_package.id;
    UPDATE public.custom_packages
       SET status = 'merged', parent_package_id = active_package.id,
           updated_at = pg_catalog.now()
     WHERE id = payment_order.package_id;
    PERFORM app.grant_paddle_addon_credits(p_order_id);
  ELSE
    UPDATE public.custom_packages
       SET status = 'active', updated_at = pg_catalog.now()
     WHERE id = payment_order.package_id;
  END IF;

  IF proposal.package_request_id IS NOT NULL THEN
    UPDATE public.package_requests
       SET status = 'won', handled_at = COALESCE(handled_at, pg_catalog.now()),
           converted_at = COALESCE(converted_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE id = proposal.package_request_id
       AND organization_id = payment_order.organization_id
       AND status = 'proposal_sent';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION app.process_paddle_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.process_paddle_payment(uuid, text, text) TO app_runtime;
