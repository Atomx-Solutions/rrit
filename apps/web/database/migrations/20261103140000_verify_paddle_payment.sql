-- A paid Paddle transaction grants what its order says, so the order must be
-- the one that was charged: the latest transaction created for it, in its
-- currency, for its amount. The subtotal is before discounts and tax, so a
-- discount code still passes. Anything else is raised, nothing is granted, and
-- Paddle retries the webhook while the team looks at it.
CREATE OR REPLACE FUNCTION app.verify_paddle_payment(
  p_order_id uuid,
  p_transaction_id text,
  p_currency text,
  p_subtotal_cents bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  payment_order public.paddle_payment_orders%ROWTYPE;
BEGIN
  SELECT * INTO payment_order FROM public.paddle_payment_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paddle payment for unknown order %', p_order_id;
  END IF;
  -- A repeated event for an order already paid is left to process_paddle_payment.
  IF payment_order.status = 'paid' THEN RETURN; END IF;
  IF payment_order.paddle_transaction_id IS DISTINCT FROM p_transaction_id THEN
    RAISE EXCEPTION 'Paddle order % was paid with transaction %, expected %',
      p_order_id, p_transaction_id, payment_order.paddle_transaction_id;
  END IF;
  IF pg_catalog.upper(payment_order.currency) <> pg_catalog.upper(COALESCE(p_currency, '')) THEN
    RAISE EXCEPTION 'Paddle order % was paid in %, expected %', p_order_id, p_currency, payment_order.currency;
  END IF;
  IF p_subtotal_cents IS DISTINCT FROM payment_order.amount_cents::bigint THEN
    RAISE EXCEPTION 'Paddle order % was charged % before tax and discounts, expected %',
      p_order_id, p_subtotal_cents, payment_order.amount_cents;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION app.verify_paddle_payment(uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.verify_paddle_payment(uuid, text, text, bigint) TO app_runtime;
