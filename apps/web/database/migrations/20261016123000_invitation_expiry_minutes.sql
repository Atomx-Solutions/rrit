-- Invitation expiry is configured in minutes: 1 minute through 24 hours.
CREATE OR REPLACE FUNCTION public.admin_create_organization_invitation(
  p_actor_id uuid, p_actor_email text, p_invitation jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_invitation public.organization_invitations%ROWTYPE;
  v_expires_minutes integer;
BEGIN
  v_expires_minutes := COALESCE((p_invitation->>'expires_minutes')::integer, 60);
  IF v_expires_minutes < 1 OR v_expires_minutes > 1440 THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (p_invitation->>'name', p_invitation->>'slug', p_actor_id)
    RETURNING * INTO v_organization;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'P0001';
    WHEN check_violation THEN RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;
  INSERT INTO public.organization_memberships (organization_id, user_id, role, brand_scope, status)
  VALUES (v_organization.id, p_actor_id, 'owner', 'ALL_BRANDS', 'active');
  BEGIN
    INSERT INTO public.organization_invitations
      (organization_id, package_request_id, email, role, token_hash, profile, invited_by, expires_at)
    VALUES (v_organization.id, NULLIF(p_invitation->>'package_request_id', '')::uuid,
      pg_catalog.lower(pg_catalog.btrim(p_invitation->>'email')), COALESCE(p_invitation->>'role', 'owner'),
      p_invitation->>'token_hash', COALESCE(p_invitation->'profile', '{}'::jsonb), p_actor_id,
      pg_catalog.now() + pg_catalog.make_interval(mins => v_expires_minutes))
    RETURNING * INTO v_invitation;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'organization_invitation', v_invitation.id::text,
    NULL, pg_catalog.to_jsonb(v_invitation) - 'token_hash', p_invitation - 'token_hash');
  RETURN pg_catalog.jsonb_build_object('organization', pg_catalog.to_jsonb(v_organization),
    'invitation', pg_catalog.to_jsonb(v_invitation) - 'token_hash');
END $function$;

DROP FUNCTION IF EXISTS public.admin_resend_organization_invitation(uuid, uuid, text, text, integer);
CREATE OR REPLACE FUNCTION public.admin_resend_organization_invitation(
  p_invitation_id uuid, p_actor_id uuid, p_actor_email text, p_token_hash text, p_expires_minutes integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE before_row public.organization_invitations%ROWTYPE; after_row public.organization_invitations%ROWTYPE;
BEGIN
  IF p_expires_minutes < 1 OR p_expires_minutes > 1440 THEN RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO before_row FROM public.organization_invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF before_row.status NOT IN ('pending', 'expired') THEN RAISE EXCEPTION 'INVITATION_CLOSED' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.organization_invitations SET token_hash = p_token_hash, status = 'pending',
    expires_at = pg_catalog.now() + pg_catalog.make_interval(mins => p_expires_minutes), updated_at = pg_catalog.now()
    WHERE id = p_invitation_id RETURNING * INTO after_row;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'organization_invitation', p_invitation_id::text,
    pg_catalog.to_jsonb(before_row) - 'token_hash', pg_catalog.to_jsonb(after_row) - 'token_hash', pg_catalog.jsonb_build_object('status', 'resent'));
  RETURN pg_catalog.to_jsonb(after_row) - 'token_hash';
END $function$;

GRANT EXECUTE ON FUNCTION public.admin_create_organization_invitation(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_resend_organization_invitation(uuid, uuid, text, text, integer) TO service_role;
