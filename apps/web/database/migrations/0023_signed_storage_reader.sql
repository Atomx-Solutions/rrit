CREATE OR REPLACE FUNCTION app.read_signed_asset_location(asset_id uuid)
RETURNS TABLE(storage_path text, bytes bytea, mime text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.storage_path, a.bytes, a.mime
  FROM public.assets AS a
  WHERE a.id = $1 AND a.rights = true
$$;

REVOKE ALL ON FUNCTION app.read_signed_asset_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_asset_location(uuid) TO app_runtime;
