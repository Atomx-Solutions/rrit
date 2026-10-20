-- A paid Paddle offer must complete the linked admin request just as the
-- legacy client acceptance path does. Keep the package's negotiated admin
-- price as the payment source of truth.
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

  IF payment_order.status = 'paid' THEN
    RETURN;
  END IF;

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
     SET status = 'paid',
         paddle_event_id = p_event_id,
         paid_at = COALESCE(paid_at, pg_catalog.now()),
         updated_at = pg_catalog.now()
   WHERE id = p_order_id;

  SELECT * INTO active_package
    FROM public.custom_packages
   WHERE organization_id = payment_order.organization_id
     AND status = 'active'
     AND id <> payment_order.package_id
   ORDER BY ends_at DESC, id DESC
   LIMIT 1
   FOR UPDATE;

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
       SET status = 'merged', parent_package_id = active_package.id, updated_at = pg_catalog.now()
     WHERE id = payment_order.package_id;

    PERFORM app.grant_package_credits(active_package.id, true);
  ELSE
    UPDATE public.custom_packages
       SET status = 'active', updated_at = pg_catalog.now()
     WHERE id = payment_order.package_id;
  END IF;

  IF proposal.package_request_id IS NOT NULL THEN
    UPDATE public.package_requests
       SET status = 'won',
           handled_at = COALESCE(handled_at, pg_catalog.now()),
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

-- Reconcile only requests linked to packages backed by a completed Paddle
-- order. Never infer a sale from a proposal or a Paddle notification alone.
UPDATE public.package_requests AS request
   SET status = 'won',
       handled_at = COALESCE(request.handled_at, payment.paid_at, pg_catalog.now()),
       converted_at = COALESCE(request.converted_at, payment.paid_at, pg_catalog.now()),
       updated_at = pg_catalog.now()
  FROM public.custom_packages AS package
  JOIN public.paddle_payment_orders AS payment
    ON payment.package_id = package.id
 WHERE request.id = package.package_request_id
   AND request.organization_id = payment.organization_id
   AND request.status = 'proposal_sent'
   AND package.status IN ('active', 'merged')
   AND payment.status = 'paid';
