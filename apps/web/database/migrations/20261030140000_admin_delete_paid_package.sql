-- Every package is now bought through Paddle, so a package that was only
-- cancelled stayed in the admin list forever and the delete button seemed to
-- do nothing. Delete now removes the package, paid or not.
--
-- What must outlive it does: the Paddle order keeps the amount and the
-- transaction, and the invoice is keyed by that transaction, so the order only
-- loses its link to the package.
ALTER TABLE public.paddle_payment_orders
  ALTER COLUMN package_id DROP NOT NULL,
  DROP CONSTRAINT paddle_payment_orders_package_id_fkey,
  ADD CONSTRAINT paddle_payment_orders_package_id_fkey
    FOREIGN KEY (package_id) REFERENCES public.custom_packages(id) ON DELETE SET NULL;

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
  -- force. Operate on that parent so deleting either row removes the whole
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
    -- Credits the package still grants expire first. Reserved credits are
    -- retained so work already in progress can settle safely.
    PERFORM app.remove_package_tree_credits(package_row.id, pg_catalog.now());

    -- A checkout left open for this package can no longer be completed.
    UPDATE public.paddle_payment_orders
       SET status = 'canceled', updated_at = pg_catalog.now()
     WHERE status = 'pending'
       AND package_id IN (
         SELECT id FROM public.custom_packages
          WHERE id = package_row.id OR parent_package_id = package_row.id
       );

    -- Children go with their parent (ON DELETE CASCADE).
    DELETE FROM public.custom_packages WHERE id = package_row.id;

    INSERT INTO public.audit_events
      (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
    VALUES (
      package_row.organization_id, package_row.organization_id, p_actor_id,
      'admin_custom_package.delete_paid', 'custom_package', package_row.id::text, 'succeeded',
      pg_catalog.jsonb_build_object(
        'event_type', 'admin_paid_custom_package_deleted',
        'actor_email', p_actor_email,
        'selected_package_id', selected_row.id,
        'before', pg_catalog.to_jsonb(package_row)
      ),
      0
    );
    RETURN pg_catalog.jsonb_build_object('deleted', true, 'id', package_row.id);
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
