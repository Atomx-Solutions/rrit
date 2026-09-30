-- Removing a request from the inbox. Deleting a lead is a judgement the
-- superadmin makes about clutter, not about history: the audit row written here
-- keeps the whole request, so what was asked for is still recoverable after the
-- row itself is gone.

CREATE OR REPLACE FUNCTION public.admin_delete_package_request(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.package_requests%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.package_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- The audit row is written before the delete, so a failure to record it
  -- leaves the request in place rather than losing it silently.
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'package_request', p_request_id::text,
    pg_catalog.to_jsonb(before_row) - 'submitter_hash',
    'null'::jsonb,
    pg_catalog.jsonb_build_object('action', 'delete')
  );

  DELETE FROM public.package_requests WHERE id = p_request_id;
  RETURN pg_catalog.to_jsonb(before_row) - 'submitter_hash';
END
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_package_request(uuid, uuid, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_delete_package_request(uuid, uuid, text) TO service_role;
  END IF;
END
$$;
