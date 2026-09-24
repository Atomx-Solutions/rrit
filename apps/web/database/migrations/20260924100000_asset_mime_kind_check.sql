ALTER TABLE assets
  DROP CONSTRAINT IF EXISTS assets_mime_check;

ALTER TABLE assets
  ADD CONSTRAINT assets_mime_check CHECK (
    (kind = 'photo' AND mime = 'image/jpeg')
    OR (kind = 'brand' AND mime IN ('image/png', 'image/jpeg', 'image/webp'))
  );
