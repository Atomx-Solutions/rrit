-- Allow admins to remove only invitations that can no longer be used.
CREATE OR REPLACE FUNCTION public.admin_delete_organization_invitation(
  p_invitation_id uuid, p_actor_id uuid, p_actor_email text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  before_row public.organization_invitations%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.organization_invitations
  WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF before_row.status = 'pending' THEN
    RAISE EXCEPTION 'INVITATION_OPEN' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'organization_invitation', p_invitation_id::text,
    pg_catalog.to_jsonb(before_row) - 'token_hash', NULL,
    pg_catalog.jsonb_build_object('status', 'deleted')
  );
  DELETE FROM public.organization_invitations WHERE id = p_invitation_id;
  RETURN pg_catalog.to_jsonb(before_row) - 'token_hash';
END $function$;

REVOKE ALL ON FUNCTION public.admin_delete_organization_invitation(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_organization_invitation(uuid, uuid, text) TO service_role;
