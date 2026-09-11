-- S1-B03: optimistic concurrency for canonical brand settings.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS revision integer;

ALTER TABLE brands
  ALTER COLUMN revision SET DEFAULT 1;

UPDATE brands
SET revision = 1
WHERE revision IS NULL;

ALTER TABLE brands
  ALTER COLUMN revision SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'brands'::regclass
      AND conname = 'brands_revision_positive'
  ) THEN
    ALTER TABLE brands
      ADD CONSTRAINT brands_revision_positive CHECK (revision >= 1);
  END IF;
END
$$;
