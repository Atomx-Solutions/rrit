-- An organization may be opened by the superadmin before its client has an
-- account, so the agreed package and invoice are waiting at the first sign in.
-- The organization row is created here with the superadmin as created_by; the
-- client is bound to it only when the invitation is accepted, and the business
-- row is then created with the organization's own id, because every tenant
-- policy keys on business_id = app.current_organization_id().
CREATE TABLE public.organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  package_request_id uuid REFERENCES public.package_requests(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (length(trim(email)) BETWEEN 3 AND 320),
  role text NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'admin', 'marketer', 'approver', 'analyst', 'billing')),
  -- Only the hash is stored. The token itself is returned once, when the
  -- invitation is created, and never again.
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)),
  CHECK ((status = 'accepted') = (accepted_by IS NOT NULL))
);

-- One open invitation per organization; resending replaces the previous token.
CREATE UNIQUE INDEX organization_invitations_pending_organization
  ON public.organization_invitations (organization_id)
  WHERE status = 'pending';
CREATE INDEX organization_invitations_pending_expiry
  ON public.organization_invitations (expires_at)
  WHERE status = 'pending';
CREATE INDEX organization_invitations_package_request
  ON public.organization_invitations (package_request_id)
  WHERE package_request_id IS NOT NULL;

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_invitations FROM PUBLIC;

-- The superadmin opens the organization and its invitation in one transaction.
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

-- Revoking closes the open invitation and the token stops working at once.
CREATE OR REPLACE FUNCTION public.admin_revoke_organization_invitation(
  p_invitation_id uuid, p_actor_id uuid, p_actor_email text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  before_row public.organization_invitations%ROWTYPE;
  after_row public.organization_invitations%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.organization_invitations
  WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF before_row.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.organization_invitations
  SET status = 'revoked', updated_at = pg_catalog.now()
  WHERE id = p_invitation_id
  RETURNING * INTO after_row;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'organization_invitation', p_invitation_id::text,
    pg_catalog.to_jsonb(before_row) - 'token_hash',
    pg_catalog.to_jsonb(after_row) - 'token_hash',
    pg_catalog.jsonb_build_object('status', 'revoked')
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'token_hash';
END $function$;

-- A resend issues a fresh token and invalidates the previous one.
CREATE OR REPLACE FUNCTION public.admin_resend_organization_invitation(
  p_invitation_id uuid, p_actor_id uuid, p_actor_email text,
  p_token_hash text, p_expires_days integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE
  before_row public.organization_invitations%ROWTYPE;
  after_row public.organization_invitations%ROWTYPE;
BEGIN
  IF p_expires_days < 1 OR p_expires_days > 30 THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO before_row FROM public.organization_invitations
  WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITATION_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF before_row.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'INVITATION_CLOSED' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.organization_invitations
    SET token_hash = p_token_hash,
        status = 'pending',
        expires_at = pg_catalog.now() + pg_catalog.make_interval(days => p_expires_days),
        updated_at = pg_catalog.now()
    WHERE id = p_invitation_id
    RETURNING * INTO after_row;
  EXCEPTION WHEN check_violation OR unique_violation THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'P0001';
  END;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'organization_invitation', p_invitation_id::text,
    pg_catalog.to_jsonb(before_row) - 'token_hash',
    pg_catalog.to_jsonb(after_row) - 'token_hash',
    pg_catalog.jsonb_build_object('status', 'resent')
  );
  RETURN pg_catalog.to_jsonb(after_row) - 'token_hash';
END $function$;

CREATE OR REPLACE FUNCTION public.admin_organization_invitations(p_organization_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(entry ORDER BY entry->>'created_at' DESC), '[]'::jsonb)
  FROM (
    SELECT pg_catalog.to_jsonb(invitation) - 'token_hash'
             || pg_catalog.jsonb_build_object(
                  'organization_name', organization.name,
                  'organization_slug', organization.slug
                ) AS entry
    FROM public.organization_invitations AS invitation
    JOIN public.organizations AS organization ON organization.id = invitation.organization_id
    WHERE p_organization_id IS NULL OR invitation.organization_id = p_organization_id
  ) AS invitations;
$function$;

-- What the invited client may see before signing up: enough to recognise the
-- invitation, and never the organization id.
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
    'organizationName', organization_name,
    'email', invitation.email,
    'profile', invitation.profile,
    'expiresAt', invitation.expires_at
  );
END $function$;

-- Acceptance binds the signed-in user to the waiting organization. The business
-- row takes the organization's id so the tenant context resolves to the same
-- row the superadmin already attached the package and invoice to.
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
  ON CONFLICT (organization_id, user_id) DO NOTHING;

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

-- Invitations left open past their expiry are closed by maintenance so the
-- superadmin list never shows a token that would be refused anyway.
CREATE OR REPLACE FUNCTION public.expire_organization_invitations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE closed integer;
BEGIN
  UPDATE public.organization_invitations
  SET status = 'expired', updated_at = pg_catalog.now()
  WHERE status = 'pending' AND expires_at <= pg_catalog.now();
  GET DIAGNOSTICS closed = ROW_COUNT;
  RETURN closed;
END $function$;

-- An organization opened for an invitation that was never accepted has no
-- member, no business and no package. Left alone it would accumulate in every
-- superadmin list, so maintenance removes it once its invitation has been
-- closed and nothing was ever attached to it.
CREATE OR REPLACE FUNCTION public.remove_abandoned_invited_organizations()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $function$
DECLARE removed integer;
BEGIN
  DELETE FROM public.organizations AS organization
  WHERE NOT EXISTS (SELECT 1 FROM public.organization_memberships AS member
                     WHERE member.organization_id = organization.id)
    AND NOT EXISTS (SELECT 1 FROM public.businesses AS business
                     WHERE business.id = organization.id)
    AND NOT EXISTS (SELECT 1 FROM public.custom_packages AS package
                     WHERE package.organization_id = organization.id)
    AND EXISTS (SELECT 1 FROM public.organization_invitations AS invitation
                 WHERE invitation.organization_id = organization.id)
    AND NOT EXISTS (SELECT 1 FROM public.organization_invitations AS invitation
                     WHERE invitation.organization_id = organization.id
                       AND invitation.status = 'pending')
    AND organization.created_at < pg_catalog.now() - pg_catalog.make_interval(days => 30);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $function$;

REVOKE ALL ON FUNCTION public.admin_create_organization_invitation(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_organization_invitation(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resend_organization_invitation(uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_organization_invitations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organization_invitation_preview(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_organization_invitation(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_organization_invitations() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_abandoned_invited_organizations() FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_create_organization_invitation(uuid, text, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_revoke_organization_invitation(uuid, uuid, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_resend_organization_invitation(uuid, uuid, text, text, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_organization_invitations(uuid) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.organization_invitation_preview(text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION public.accept_organization_invitation(text, text, jsonb) TO app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rrit_worker') THEN
    GRANT EXECUTE ON FUNCTION public.expire_organization_invitations() TO rrit_worker;
    GRANT EXECUTE ON FUNCTION public.remove_abandoned_invited_organizations() TO rrit_worker;
  END IF;
END $$;
