ALTER TABLE assets
  ADD COLUMN kind text NOT NULL DEFAULT 'photo';

ALTER TABLE assets
  ADD CONSTRAINT assets_kind_check CHECK (kind IN ('photo', 'brand'));

CREATE INDEX assets_business_kind ON assets (business_id, kind);
