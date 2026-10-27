-- Paddle orders are financial records and must remain referentially intact.
-- Therefore "delete" means immediate cancellation for a package that has
-- ever been paid through Paddle.  The customer loses the package entitlement
-- and all unreserved credits funded by that package tree, while the order and
-- its audit history remain available for reconciliation/refunds.

CREATE INDEX IF NOT EXISTS paddle_payment_orders_package_id
  ON public.paddle_payment_orders(package_id);

CREATE OR REPLACE FUNCTION public.admin_delete_custom_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_row public.custom_packages%ROWTYPE;
  package_row public.custom_packages%ROWTYPE;
  has_paddle_payment boolean;
BEGIN
  SELECT * INTO selected_row
    FROM public.custom_packages
   WHERE id = p_package_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Add-ons are retained as children of the package that is actually in
  -- force. Operate on that parent so cancelling either row removes the whole
  -- paid entitlement, rather than leaving posts, videos or credits behind.
  SELECT * INTO package_row
    FROM public.custom_packages
   WHERE id = COALESCE(selected_row.parent_package_id, selected_row.id)
   FOR UPDATE;

  SELECT EXISTS(
    SELECT 1
      FROM public.paddle_payment_orders payment
     WHERE payment.package_id = package_row.id
        OR payment.package_id = selected_row.id
        OR payment.package_id IN (
          SELECT id FROM public.custom_packages WHERE parent_package_id = package_row.id
        )
  ) INTO has_paddle_payment;

  IF has_paddle_payment THEN
    -- This writes an expiry entry for all still-usable credits before statuses
    -- change. Reserved credits are intentionally retained so work already in
    -- progress can settle safely, but no new generation can begin afterwards.
    PERFORM app.remove_package_tree_credits(package_row.id, pg_catalog.now());

    UPDATE public.custom_packages
       SET status = 'cancelled', updated_at = pg_catalog.now()
     WHERE id = package_row.id OR parent_package_id = package_row.id;

    INSERT INTO public.audit_events
      (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
    VALUES (
      package_row.organization_id, package_row.organization_id, p_actor_id,
      'admin_custom_package.cancel_paid', 'custom_package', package_row.id::text, 'succeeded',
      pg_catalog.jsonb_build_object(
        'event_type', 'admin_paid_custom_package_cancelled',
        'actor_email', p_actor_email,
        'selected_package_id', selected_row.id,
        'before', pg_catalog.to_jsonb(package_row)
      ),
      0
    );
    RETURN pg_catalog.jsonb_build_object('deleted', false, 'cancelled', true, 'id', package_row.id);
  END IF;

  -- A proposal never paid through Paddle has no financial history to retain.
  DELETE FROM public.custom_packages WHERE id = selected_row.id;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    selected_row.organization_id, selected_row.organization_id, p_actor_id,
    'admin_custom_package.delete', 'custom_package', selected_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_deleted',
      'actor_email', p_actor_email,
      'before', pg_catalog.to_jsonb(selected_row)
    ),
    0
  );
  RETURN pg_catalog.jsonb_build_object('deleted', true, 'id', selected_row.id);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) TO service_role;
  END IF;
END $$;
