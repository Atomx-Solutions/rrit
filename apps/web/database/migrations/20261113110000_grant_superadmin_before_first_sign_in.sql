-- A superadmin adds an administrator by email and the role applies at once.
-- The server creates the account first when the address has none, so the
-- role no longer waits for the person's first Microsoft sign-in. That sign-in
-- is still the only way in: the /api/admin guard refuses every session that
-- did not come through the company Microsoft account, and Supabase links the
-- Microsoft identity to this account the first time its owner signs in.

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

-- Replacing a function keeps its privileges; restated so this file alone
-- shows the function stays closed to the public roles.
REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.admin_grant_superadmin(uuid, text, text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_grant_superadmin(uuid, text, text) TO service_role;
  END IF;
END
$$;
