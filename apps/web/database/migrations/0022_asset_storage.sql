ALTER TABLE assets
  ALTER COLUMN bytes DROP NOT NULL;

ALTER TABLE assets
  ADD COLUMN storage_path text,
  ADD COLUMN size_bytes bigint;

UPDATE assets
SET size_bytes = octet_length(bytes)
WHERE size_bytes IS NULL;

ALTER TABLE assets
  ALTER COLUMN size_bytes SET NOT NULL;

ALTER TABLE assets
  ADD CONSTRAINT assets_storage_source_check CHECK (
    (bytes IS NOT NULL AND storage_path IS NULL)
    OR (bytes IS NULL AND storage_path IS NOT NULL AND size_bytes > 0)
  );

CREATE UNIQUE INDEX assets_storage_path_unique
  ON assets (storage_path)
  WHERE storage_path IS NOT NULL;
