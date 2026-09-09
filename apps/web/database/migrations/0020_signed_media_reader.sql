-- Signed publication media is served without a browser session. Keep the
-- endpoint behind the application signature check and expose only the small
-- read operation it needs, instead of giving the runtime role a tenant bypass.
CREATE OR REPLACE FUNCTION app.read_signed_asset(asset_id uuid)
RETURNS TABLE(bytes bytea, mime text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.bytes, a.mime
  FROM public.assets AS a
  WHERE a.id = $1 AND a.rights = true
$$;

REVOKE ALL ON FUNCTION app.read_signed_asset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_asset(uuid) TO app_runtime;
