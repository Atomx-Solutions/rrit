-- A social account can be connected to one business only. Tenant RLS hides the
-- business that holds it, so the connect flows cannot say where it is. This
-- returns that business's name, but only to a caller who is an active member
-- of it; anyone else learns nothing beyond "taken".
CREATE OR REPLACE FUNCTION app.social_account_owner_name(p_network text, p_account_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_business uuid;
  v_name text;
BEGIN
  IF p_network = 'instagram' THEN
    SELECT business_id INTO v_business FROM public.instagram_connections WHERE instagram_user_id = p_account_id;
    IF v_business IS NULL THEN
      SELECT business_id INTO v_business FROM public.meta_connections
       WHERE instagram_id = p_account_id AND status = 'connected' LIMIT 1;
    END IF;
  ELSIF p_network = 'facebook' THEN
    SELECT business_id INTO v_business FROM public.meta_connections
     WHERE page_id = p_account_id AND status = 'connected';
  ELSIF p_network = 'tiktok' THEN
    SELECT business_id INTO v_business FROM public.tiktok_connections WHERE open_id = p_account_id;
  END IF;
  IF v_business IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.name INTO v_name
    FROM public.organizations o
    JOIN public.organization_memberships m ON m.organization_id = o.id
   WHERE o.id = v_business
     AND m.user_id = app.current_user_id()
     AND m.status = 'active';
  RETURN v_name;
END
$function$;

REVOKE ALL ON FUNCTION app.social_account_owner_name(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.social_account_owner_name(text, text) TO app_runtime;
