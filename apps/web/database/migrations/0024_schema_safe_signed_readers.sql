-- Keep signed asset readers compatible with schema-isolated integration tests.
-- Production uses public; the test harness uses a validated rrit_test_* schema.
CREATE OR REPLACE FUNCTION app.read_signed_asset(asset_id uuid)
RETURNS TABLE(bytes bytea, mime text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  asset_schema text := pg_catalog.current_schema();
BEGIN
  IF asset_schema IS NULL OR (
    asset_schema <> 'public'
    AND asset_schema !~ '^rrit_test_[a-f0-9]{32}$'
  ) THEN
    RAISE EXCEPTION 'Unsupported asset schema';
  END IF;

  RETURN QUERY EXECUTE pg_catalog.format(
    'SELECT a.bytes, a.mime FROM %I.assets AS a WHERE a.id = $1 AND a.rights = true',
    asset_schema
  ) USING asset_id;
END
$function$;

CREATE OR REPLACE FUNCTION app.read_signed_asset_location(asset_id uuid)
RETURNS TABLE(storage_path text, bytes bytea, mime text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  asset_schema text := pg_catalog.current_schema();
BEGIN
  IF asset_schema IS NULL OR (
    asset_schema <> 'public'
    AND asset_schema !~ '^rrit_test_[a-f0-9]{32}$'
  ) THEN
    RAISE EXCEPTION 'Unsupported asset schema';
  END IF;

  RETURN QUERY EXECUTE pg_catalog.format(
    'SELECT a.storage_path, a.bytes, a.mime FROM %I.assets AS a WHERE a.id = $1 AND a.rights = true',
    asset_schema
  ) USING asset_id;
END
$function$;

REVOKE ALL ON FUNCTION app.read_signed_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_signed_asset_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_signed_asset(uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.read_signed_asset_location(uuid) TO app_runtime;
