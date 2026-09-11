-- S1-B03: optimistic concurrency for canonical brand settings.
ALTER TABLE brands
  ADD COLUMN revision integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT brands_revision_positive CHECK (revision >= 1);
