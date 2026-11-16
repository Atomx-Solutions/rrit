-- Superadmins manage who else is a superadmin from the console instead of SQL.
-- An administrator signs in only through the company Microsoft account, so a
-- role is granted only to an account that already holds that identity: the
-- person signs in once at /admin/login, then an existing superadmin adds them.
-- The console never loses its last superadmin, and nobody removes themselves.

CREATE OR REPLACE FUNCTION public.admin_list_platform_admins()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(pg_catalog.jsonb_agg(row_data ORDER BY granted_at), '[]'::jsonb)
  FROM (
    SELECT r.created_at AS granted_at,
      pg_catalog.jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'name', COALESCE(NULLIF(pg_catalog.btrim(u.raw_user_meta_data->>'name'), ''), u.email),
        'granted_at', r.created_at,
        'granted_by_email', granter.email,
        'last_sign_in_at', u.last_sign_in_at,
        'microsoft', EXISTS (
          SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'azure'
        )
      ) AS row_data
    FROM public.platform_user_roles r
    JOIN auth.users u ON u.id = r.user_id
    LEFT JOIN auth.users granter ON granter.id = r.created_by
    WHERE r.role = 'superadmin'
  ) admins;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_superadmin(
  p_actor_id uuid,
  p_actor_email text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_user auth.users%ROWTYPE;
BEGIN
  -- The API checks the role too; the function does not trust that alone.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_user_roles WHERE user_id = p_actor_id AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'SUPERADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user FROM auth.users
   WHERE pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_email))
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_ACCOUNT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  -- Only the company tenant's single-tenant app can create this identity.
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_user.id AND provider = 'azure') THEN
    RAISE EXCEPTION 'ADMIN_MICROSOFT_ACCOUNT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.platform_user_roles (user_id, role, created_by)
  VALUES (v_user.id, 'superadmin', p_actor_id)
  ON CONFLICT (user_id, role) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_ALREADY_EXISTS' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'platform_admin', v_user.id::text,
    NULL,
    pg_catalog.jsonb_build_object('email', v_user.email, 'role', 'superadmin'),
    pg_catalog.jsonb_build_object('granted', true)
  );
  RETURN pg_catalog.jsonb_build_object('user_id', v_user.id, 'email', v_user.email);
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_superadmin(
  p_actor_id uuid,
  p_actor_email text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_remaining integer;
  v_email text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_user_roles WHERE user_id = p_actor_id AND role = 'superadmin'
  ) THEN
    RAISE EXCEPTION 'SUPERADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id = p_actor_id THEN
    RAISE EXCEPTION 'ADMIN_CANNOT_REMOVE_SELF' USING ERRCODE = 'P0001';
  END IF;

  -- Locking every superadmin row serialises concurrent removals, so two
  -- admins removing each other cannot leave the console without one.
  PERFORM 1 FROM public.platform_user_roles WHERE role = 'superadmin' FOR UPDATE;
  SELECT pg_catalog.count(*) INTO v_remaining FROM public.platform_user_roles WHERE role = 'superadmin';
  IF v_remaining <= 1 THEN
    RAISE EXCEPTION 'ADMIN_LAST_REMAINING' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.platform_user_roles WHERE user_id = p_user_id AND role = 'superadmin';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;
  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'platform_admin', p_user_id::text,
    pg_catalog.jsonb_build_object('email', v_email, 'role', 'superadmin'),
    NULL,
    pg_catalog.jsonb_build_object('revoked', true)
  );
  RETURN pg_catalog.jsonb_build_object('user_id', p_user_id, 'email', v_email);
END
$function$;

ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_scope_check;
ALTER TABLE public.audit_events
  ADD CONSTRAINT audit_events_scope_check CHECK (
    (organization_id IS NOT NULL AND business_id IS NOT NULL)
    OR (organization_id IS NULL AND business_id IS NULL
        AND resource_type IN (
          'plan',
          'credit_pricing',
          'invoice_settings',
          'platform_settings',
          'package_request',
          'custom_package',
          'organization_invitation',
          'invoice_payment',
          'client_feedback',
          'music_track',
          'music_mood',
          'platform_admin'
        ))
  );

-- Only the service role behind /api/admin/** may call these; PostgREST must
-- not offer them to the public anon or authenticated roles.
REVOKE ALL ON FUNCTION public.admin_list_platform_admins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_superadmin(uuid, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  -- Supabase's default privileges may grant new functions to these roles.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_list_platform_admins() FROM anon;
    REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM anon;
    REVOKE ALL ON FUNCTION public.admin_revoke_superadmin(uuid, text, uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.admin_list_platform_admins() FROM authenticated;
    REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.admin_revoke_superadmin(uuid, text, uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_platform_admins() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_grant_superadmin(uuid, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_revoke_superadmin(uuid, text, uuid) TO service_role;
  END IF;
END
$$;
