-- An invitation used to open its organization straight away, with the
-- superadmin as caretaker owner, so the agreed package could be attached
-- before the client signed up. A deleted or never-accepted invitation then left
-- an empty organization behind in every superadmin list.
--
-- From now on an invitation holds the organization's name and slug, and the
-- proposed package, itself. The organization, its business and that package
-- are created together only when the client accepts. Invitations made before
-- this change keep their organization and are accepted exactly as before.
ALTER TABLE public.organization_invitations
  ALTER COLUMN organization_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS organization_name text,
  ADD COLUMN IF NOT EXISTS organization_slug text,
  ADD COLUMN IF NOT EXISTS proposed_package jsonb;

-- Older invitations show the name and slug of the organization they opened.
UPDATE public.organization_invitations AS invitation
   SET organization_name = organization.name, organization_slug = organization.slug
  FROM public.organizations AS organization
 WHERE organization.id = invitation.organization_id
   AND invitation.organization_name IS NULL;

ALTER TABLE public.organization_invitations
  ADD CONSTRAINT organization_invitations_names_organization
  CHECK (organization_id IS NOT NULL OR (organization_name IS NOT NULL AND organization_slug IS NOT NULL));

-- Two open invitations cannot promise the same address.
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_pending_slug
  ON public.organization_invitations (organization_slug)
  WHERE status = 'pending' AND organization_id IS NULL;

CREATE OR REPLACE FUNCTION public.admin_create_organization_invitation(p_actor_id uuid, p_actor_email text, p_invitation jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  v_invitation public.organization_invitations%ROWTYPE;
  v_expires_minutes integer;
  v_name text := pg_catalog.btrim(p_invitation->>'name');
  v_slug text := p_invitation->>'slug';
BEGIN
  v_expires_minutes := COALESCE((p_invitation->>'expires_minutes')::integer, 60);
  IF v_expires_minutes < 1 OR v_expires_minutes > 1440 THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  -- The same rules the organization itself will be held to when it opens.
  IF v_name IS NULL OR pg_catalog.length(v_name) NOT BETWEEN 2 AND 120
     OR v_slug IS NULL OR v_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO public.organization_invitations
      (organization_id, organization_name, organization_slug, proposed_package, package_request_id,
       email, role, token_hash, profile, invited_by, expires_at)
    VALUES (NULL, v_name, v_slug, NULLIF(p_invitation->'package', 'null'::jsonb),
      NULLIF(p_invitation->>'package_request_id', '')::uuid,
      pg_catalog.lower(pg_catalog.btrim(p_invitation->>'email')), COALESCE(p_invitation->>'role', 'owner'),
      p_invitation->>'token_hash', COALESCE(p_invitation->'profile', '{}'::jsonb), p_actor_id,
      pg_catalog.now() + pg_catalog.make_interval(mins => v_expires_minutes))
    RETURNING * INTO v_invitation;
  EXCEPTION
    WHEN unique_violation THEN RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'P0001';
    WHEN check_violation OR not_null_violation THEN RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;
  PERFORM public.admin_record_platform_change(p_actor_id, p_actor_email, 'organization_invitation', v_invitation.id::text,
    NULL, pg_catalog.to_jsonb(v_invitation) - 'token_hash', p_invitation - 'token_hash');
  -- No organization exists yet; the name and slug it will open with stand in.
  RETURN pg_catalog.jsonb_build_object(
    'organization', pg_catalog.jsonb_build_object('id', NULL, 'name', v_name, 'slug', v_slug),
    'invitation', pg_catalog.to_jsonb(v_invitation) - 'token_hash');
END $function$;

CREATE OR REPLACE FUNCTION public.accept_organization_invitation(p_token_hash text, p_slug text, p_state jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  invitation public.organization_invitations%ROWTYPE;
  v_user uuid;
  v_email text;
  v_organization_id uuid;
  v_inviter_email text;
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

  v_organization_id := invitation.organization_id;
  IF v_organization_id IS NULL THEN
    -- The organization opens now, owned by the client from the start.
    BEGIN
      INSERT INTO public.organizations (name, slug, created_by)
      VALUES (invitation.organization_name, invitation.organization_slug, v_user)
      RETURNING id INTO v_organization_id;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ORGANIZATION_SLUG_TAKEN' USING ERRCODE = 'P0001';
    END;
  END IF;

  INSERT INTO public.businesses (id, owner_id, slug, state)
  VALUES (v_organization_id, v_user, p_slug, p_state);

  INSERT INTO public.organization_memberships (organization_id, user_id, role, brand_scope, status)
  VALUES (v_organization_id, v_user,
    CASE WHEN invitation.organization_id IS NULL THEN 'owner' ELSE invitation.role END, 'ALL_BRANDS', 'active')
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active', updated_at = pg_catalog.now();

  -- An organization opened earlier by the invitation is handed over: created_by
  -- follows the new owner and the caretaker membership goes away.
  IF invitation.organization_id IS NOT NULL AND invitation.role = 'owner'
     AND invitation.invited_by IS DISTINCT FROM v_user THEN
    UPDATE public.organizations
    SET created_by = v_user, updated_at = pg_catalog.now()
    WHERE id = v_organization_id;

    DELETE FROM public.organization_memberships
    WHERE organization_id = v_organization_id
      AND user_id = invitation.invited_by;
  END IF;

  UPDATE public.organization_invitations
  SET status = 'accepted', accepted_at = pg_catalog.now(), accepted_by = v_user,
      organization_id = v_organization_id, updated_at = pg_catalog.now()
  WHERE id = invitation.id;

  -- The package proposed with the invitation waits for the client, as if the
  -- superadmin had attached it to the organization themselves.
  IF invitation.proposed_package IS NOT NULL THEN
    SELECT email INTO v_inviter_email FROM auth.users WHERE id = invitation.invited_by;
    PERFORM public.admin_create_custom_package(v_organization_id, invitation.invited_by,
      COALESCE(v_inviter_email, ''), invitation.proposed_package);
  END IF;

  -- The lead that produced this invitation is now a converted organization.
  IF invitation.package_request_id IS NOT NULL THEN
    UPDATE public.package_requests
    SET status = 'won',
        organization_id = COALESCE(organization_id, v_organization_id),
        handled_at = COALESCE(handled_at, pg_catalog.now()),
        converted_at = COALESCE(converted_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE id = invitation.package_request_id AND status <> 'won';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'organizationId', v_organization_id,
    'role', CASE WHEN invitation.organization_id IS NULL THEN 'owner' ELSE invitation.role END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.organization_invitation_preview(p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  invitation public.organization_invitations%ROWTYPE;
  organization_name text;
BEGIN
  SELECT * INTO invitation FROM public.organization_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND OR invitation.status <> 'pending' OR invitation.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('valid', false);
  END IF;
  SELECT name INTO organization_name FROM public.organizations WHERE id = invitation.organization_id;
  RETURN pg_catalog.jsonb_build_object(
    'valid', true,
    'organizationName', COALESCE(organization_name, invitation.organization_name),
    'email', invitation.email,
    'profile', invitation.profile,
    'expiresAt', invitation.expires_at
  );
END $function$;

CREATE OR REPLACE FUNCTION public.admin_organization_invitations(p_organization_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(entry ORDER BY entry->>'created_at' DESC), '[]'::jsonb)
  FROM (
    SELECT pg_catalog.to_jsonb(invitation) - 'token_hash'
             || pg_catalog.jsonb_build_object(
                  'organization_name', COALESCE(organization.name, invitation.organization_name),
                  'organization_slug', COALESCE(organization.slug, invitation.organization_slug)
                ) AS entry
    FROM public.organization_invitations AS invitation
    LEFT JOIN public.organizations AS organization ON organization.id = invitation.organization_id
    WHERE p_organization_id IS NULL OR invitation.organization_id = p_organization_id
  ) AS invitations;
$function$;
