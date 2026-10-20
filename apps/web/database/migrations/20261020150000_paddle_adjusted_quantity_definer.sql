CREATE OR REPLACE FUNCTION app.sync_paddle_adjusted_quantity(
  p_order_id uuid,
  p_quantity integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  payment_order public.paddle_payment_orders%ROWTYPE;
  package_row public.custom_packages%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid Paddle quantity: %', p_quantity;
  END IF;
  SELECT * INTO payment_order FROM public.paddle_payment_orders
   WHERE id = p_order_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO package_row FROM public.custom_packages
   WHERE id = payment_order.package_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF payment_order.posts_included = 0 AND payment_order.videos_included = 0
     AND payment_order.credits_included > 0 THEN
    UPDATE public.paddle_payment_orders SET credits_included=p_quantity, updated_at=now() WHERE id=p_order_id;
    UPDATE public.custom_packages SET credits_included=p_quantity, updated_at=now() WHERE id=package_row.id;
    UPDATE public.package_requests SET credits_requested=p_quantity, updated_at=now() WHERE id=package_row.package_request_id;
  ELSIF payment_order.posts_included > 0 AND payment_order.videos_included = 0
        AND payment_order.credits_included = 0 THEN
    UPDATE public.paddle_payment_orders SET posts_included=p_quantity, updated_at=now() WHERE id=p_order_id;
    UPDATE public.custom_packages SET posts_included=p_quantity, updated_at=now() WHERE id=package_row.id;
    UPDATE public.package_requests SET posts_requested=p_quantity, updated_at=now() WHERE id=package_row.package_request_id;
  ELSIF payment_order.posts_included = 0 AND payment_order.videos_included > 0
        AND payment_order.credits_included = 0 THEN
    UPDATE public.paddle_payment_orders SET videos_included=p_quantity, updated_at=now() WHERE id=p_order_id;
    UPDATE public.custom_packages SET videos_included=p_quantity, updated_at=now() WHERE id=package_row.id;
    UPDATE public.package_requests SET videos_requested=p_quantity, updated_at=now() WHERE id=package_row.package_request_id;
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION app.sync_paddle_adjusted_quantity(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sync_paddle_adjusted_quantity(uuid, integer) TO app_runtime;
