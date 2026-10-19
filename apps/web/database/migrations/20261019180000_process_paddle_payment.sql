-- Apply a verified Paddle payment without requiring an end-user tenant context.
-- The webhook is authenticated by Paddle's signature in the HTTP handler.
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

  UPDATE public.custom_packages
     SET status = 'active', updated_at = pg_catalog.now()
   WHERE id = payment_order.package_id
     AND organization_id = payment_order.organization_id
     AND status = 'draft';
END
$function$;

REVOKE ALL ON FUNCTION app.process_paddle_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.process_paddle_payment(uuid, text, text) TO app_runtime;
