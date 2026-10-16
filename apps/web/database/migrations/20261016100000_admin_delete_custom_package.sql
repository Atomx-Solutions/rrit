CREATE OR REPLACE FUNCTION public.admin_delete_custom_package(
  p_package_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  deleted_row public.custom_packages%ROWTYPE;
BEGIN
  DELETE FROM public.custom_packages
  WHERE id = p_package_id
  RETURNING * INTO deleted_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.audit_events
    (business_id, organization_id, actor_id, action, resource_type, resource_id, result, metadata, revision)
  VALUES (
    deleted_row.organization_id, deleted_row.organization_id, p_actor_id,
    'admin_custom_package.delete', 'custom_package', p_package_id::text, 'succeeded',
    pg_catalog.jsonb_build_object('event_type', 'admin_custom_package_deleted', 'actor_email', p_actor_email, 'before', pg_catalog.to_jsonb(deleted_row)),
    0
  );
  RETURN pg_catalog.jsonb_build_object('deleted', true, 'id', p_package_id);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_delete_custom_package(uuid, uuid, text) TO service_role;
  END IF;
END $$;
