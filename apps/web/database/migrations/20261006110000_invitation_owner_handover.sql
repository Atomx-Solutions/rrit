-- Every organization must have an active owner membership for its created_by;
-- the constraint triggers from 0026 enforce it and must stay enforced.
--
-- An invitation opens an organization before its client has an account, so
-- there is nobody to own it yet. Rather than weakening the invariant, the
-- superadmin who opened the organization owns it while the invitation is
-- pending, and ownership moves to the client when the invitation is accepted.
-- Both triggers are DEFERRABLE INITIALLY DEFERRED, so the handover only has to
-- hold at commit, not between statements.

CREATE OR REPLACE FUNCTION public.admin_create_organization_invitation(
  p_actor_id uuid, p_actor_email text, p_invitation jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_organization public.organizations%ROWTYPE;
  v_invitation public.organization_invitations%ROWTYPE;
  v_expires_days integer;
BEGIN
  v_expires_days := COALESCE((p_invitation->>'expires_days')::integer, 7);
  IF v_expires_days < 1 OR v_expires_days > 30 THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (p_invitation->>'name', p_invitation->>'slug', p_actor_id)
    RETURNING * INTO v_organization;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'P0001';
    WHEN check_violation THEN RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;

  -- The caretaker owner. It is replaced by the client on acceptance and removed
  -- with the organization if the invitation is never accepted.
  INSERT INTO public.organization_memberships
    (organization_id, user_id, role, brand_scope, status)
  VALUES (v_organization.id, p_actor_id, 'owner', 'ALL_BRANDS', 'active');

  BEGIN
    INSERT INTO public.organization_invitations
      (organization_id, package_request_id, email, role, token_hash, profile, invited_by, expires_at)
    VALUES (
      v_organization.id,
      NULLIF(p_invitation->>'package_request_id', '')::uuid,
      pg_catalog.lower(pg_catalog.btrim(p_invitation->>'email')),
      COALESCE(p_invitation->>'role', 'owner'),
      p_invitation->>'token_hash',
      COALESCE(p_invitation->'profile', '{}'::jsonb),
      p_actor_id,
      pg_catalog.now() + pg_catalog.make_interval(days => v_expires_days)
    )
    RETURNING * INTO v_invitation;
  EXCEPTION
    WHEN check_violation OR not_null_violation THEN
      RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'organization_invitation', v_invitation.id::text,
    NULL, pg_catalog.to_jsonb(v_invitation) - 'token_hash', p_invitation - 'token_hash'
  );

  RETURN pg_catalog.jsonb_build_object(
    'organization', pg_catalog.to_jsonb(v_organization),
    'invitation', pg_catalog.to_jsonb(v_invitation) - 'token_hash'
  );
END $function$;

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(
  p_token_hash text, p_slug text, p_state jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  invitation public.organization_invitations%ROWTYPE;
  v_user uuid;
  v_email text;
BEGIN
  v_user := app.current_user_id();
  IF v_user IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO invitation FROM public.organization_invitations
  WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  IF invitation.status = 'pending' AND invitation.expires_at <= pg_catalog.now() THEN
    UPDATE public.organization_invitations
    SET status = 'expired', updated_at = pg_catalog.now()
    WHERE id = invitation.id;
    RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  IF invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.lower(email) INTO v_email FROM auth.users WHERE id = v_user;
  IF v_email IS DISTINCT FROM invitation.email THEN
    RAISE EXCEPTION 'INVITATION_EMAIL_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- businesses.owner_id is unique, so a user who already owns a workspace
  -- cannot take over a second one through an invitation.
  IF EXISTS (SELECT 1 FROM public.businesses WHERE owner_id = v_user) THEN
    RAISE EXCEPTION 'BUSINESS_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.businesses (id, owner_id, slug, state)
  VALUES (invitation.organization_id, v_user, p_slug, p_state);

  INSERT INTO public.organization_memberships (organization_id, user_id, role, brand_scope, status)
  VALUES (invitation.organization_id, v_user, invitation.role, 'ALL_BRANDS', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', updated_at = pg_catalog.now();

  -- Hand the organization over: created_by follows the new owner, and the
  -- caretaker membership goes away. Anything other than an owner invitation
  -- leaves the superadmin in place, because the organization would otherwise
  -- be left without one.
  IF invitation.role = 'owner' AND invitation.invited_by IS DISTINCT FROM v_user THEN
    UPDATE public.organizations
    SET created_by = v_user, updated_at = pg_catalog.now()
    WHERE id = invitation.organization_id;

    DELETE FROM public.organization_memberships
    WHERE organization_id = invitation.organization_id
      AND user_id = invitation.invited_by;
  END IF;

  UPDATE public.organization_invitations
  SET status = 'accepted', accepted_at = pg_catalog.now(), accepted_by = v_user,
      updated_at = pg_catalog.now()
  WHERE id = invitation.id;

  -- The lead that produced this invitation is now a converted organization.
  IF invitation.package_request_id IS NOT NULL THEN
    UPDATE public.package_requests
    SET status = 'won',
        handled_at = COALESCE(handled_at, pg_catalog.now()),
        converted_at = COALESCE(converted_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE id = invitation.package_request_id AND status <> 'won';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', invitation.organization_id,
    'role', invitation.role
  );
END $function$;

-- The caretaker membership means an abandoned organization is no longer
-- memberless, so the cleanup now ignores the inviter's own membership.
CREATE OR REPLACE FUNCTION public.remove_abandoned_invited_organizations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE removed integer;
BEGIN
  DELETE FROM public.organizations AS organization
  WHERE NOT EXISTS (SELECT 1 FROM public.businesses AS business
                     WHERE business.id = organization.id)
    AND NOT EXISTS (SELECT 1 FROM public.custom_packages AS package
                     WHERE package.organization_id = organization.id)
    AND EXISTS (SELECT 1 FROM public.organization_invitations AS invitation
                 WHERE invitation.organization_id = organization.id)
    AND NOT EXISTS (SELECT 1 FROM public.organization_invitations AS invitation
                     WHERE invitation.organization_id = organization.id
                       AND invitation.status IN ('pending', 'accepted'))
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships AS member
      WHERE member.organization_id = organization.id
        AND member.user_id <> organization.created_by
    )
    AND organization.created_at < pg_catalog.now() - pg_catalog.make_interval(days => 30);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $function$;
