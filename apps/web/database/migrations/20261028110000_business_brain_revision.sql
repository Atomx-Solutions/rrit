-- Keep Business Brain edits isolated from unrelated brand profile updates.
ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS business_brain_revision integer NOT NULL DEFAULT 1;

ALTER TABLE brands
  ADD CONSTRAINT brands_business_brain_revision_positive
  CHECK (business_brain_revision >= 1);
