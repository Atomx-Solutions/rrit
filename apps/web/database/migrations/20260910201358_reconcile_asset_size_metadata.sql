-- Keep asset byte accounting correct for both inline and object-backed media.
-- The live project already carries this metadata; fresh databases must have
-- the same invariant, and legacy INSERT statements must derive it centrally.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS size_bytes bigint;
ALTER TABLE assets ALTER COLUMN bytes DROP NOT NULL;

UPDATE assets
SET size_bytes = octet_length(bytes)
WHERE size_bytes IS NULL AND bytes IS NOT NULL;

CREATE OR REPLACE FUNCTION app.set_asset_size_bytes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.bytes IS NOT NULL THEN
    NEW.size_bytes := octet_length(NEW.bytes);
  ELSIF NEW.size_bytes IS NULL THEN
    RAISE EXCEPTION 'Object-backed assets require size metadata.' USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS assets_set_size_bytes ON assets;
CREATE TRIGGER assets_set_size_bytes
BEFORE INSERT OR UPDATE OF bytes,size_bytes ON assets
FOR EACH ROW EXECUTE FUNCTION app.set_asset_size_bytes();

ALTER TABLE assets ALTER COLUMN size_bytes SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'assets'::regclass AND conname = 'assets_media_location_check'
  ) THEN
    ALTER TABLE assets ADD CONSTRAINT assets_media_location_check
      CHECK (bytes IS NOT NULL OR NULLIF(btrim(storage_path),'') IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'assets'::regclass AND conname = 'assets_size_bytes_check'
  ) THEN
    ALTER TABLE assets ADD CONSTRAINT assets_size_bytes_check
      CHECK (size_bytes BETWEEN 1 AND 2097152);
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION app.set_asset_size_bytes() FROM PUBLIC;
