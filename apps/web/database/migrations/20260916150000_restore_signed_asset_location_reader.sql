-- The publishing-media endpoint needs the signed asset source so it can
-- serve both database-backed bytes and storage-backed assets without a
-- tenant session. Keep the reader SECURITY DEFINER and grant only execution.
CREATE OR REPLACE FUNCTION app.read_signed_asset_location(asset_id uuid)
RETURNS TABLE(storage_path text, bytes bytea, mime text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.storage_path, a.bytes, a.mime
  FROM public.assets AS a
  WHERE a.id = $1 AND a.rights = true
$$;

REVOKE ALL ON FUNCTION app.read_signed_asset_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_asset_location(uuid) TO app_runtime;
