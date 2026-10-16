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
  package_row public.custom_packages%ROWTYPE;
BEGIN
  SELECT * INTO package_row
  FROM public.custom_packages
  WHERE id = p_package_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Remove unused credits belonging to this package before deleting its row.
  -- Reserved credits remain available for work already in progress.
  PERFORM app.expire_package_credits(
    package_row.id,
    package_row.organization_id,
    pg_catalog.now()
  );

  DELETE FROM public.custom_packages WHERE id = package_row.id;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    package_row.organization_id, package_row.organization_id, p_actor_id,
    'admin_custom_package.delete', 'custom_package', package_row.id::text, 'succeeded',
    pg_catalog.jsonb_build_object(
      'event_type', 'admin_custom_package_deleted',
      'actor_email', p_actor_email,
      'before', pg_catalog.to_jsonb(package_row)
    ),
    0
  );
  RETURN pg_catalog.jsonb_build_object('deleted', true, 'id', package_row.id);
END
$function$;
