-- Apply a verified Paddle payment without requiring an end-user tenant context.
-- The webhook is authenticated by Paddle's signature in the HTTP handler.
ALTER TABLE public.custom_packages
  DROP CONSTRAINT IF EXISTS custom_packages_status_check;

ALTER TABLE public.custom_packages
  ADD CONSTRAINT custom_packages_status_check
  CHECK (status IN ('draft', 'active', 'merged', 'expired', 'cancelled'));

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

  UPDATE public.paddle_payment_orders
     SET status = 'paid',
         paddle_transaction_id = COALESCE(paddle_transaction_id, p_transaction_id),
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
    -- A paid add-on is folded into the currently active package. The child
    -- remains as an audit record, while the active package receives the new
    -- posts/videos/credits and its credit grant is recalculated idempotently.
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
     WHERE id = payment_order.package_id AND status = 'draft';

    PERFORM app.grant_package_credits(active_package.id, true);
  ELSE
    UPDATE public.custom_packages
       SET status = 'active', updated_at = pg_catalog.now()
     WHERE id = payment_order.package_id
       AND organization_id = payment_order.organization_id
       AND status = 'draft';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION app.process_paddle_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.process_paddle_payment(uuid, text, text) TO app_runtime;
