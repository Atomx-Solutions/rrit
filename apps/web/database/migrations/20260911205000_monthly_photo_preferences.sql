ALTER TABLE monthly_planner_settings
  ADD COLUMN IF NOT EXISTS photo_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS preferred_asset_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS configured_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname = 'monthly_planner_settings_photo_mode_check'
  ) THEN
    ALTER TABLE monthly_planner_settings
      ADD CONSTRAINT monthly_planner_settings_photo_mode_check
      CHECK (photo_mode IN ('auto', 'selected'));
  END IF;
END $$;

ALTER TABLE monthly_planner_settings
  ADD CONSTRAINT monthly_planner_settings_selected_assets_check
  CHECK (
    (photo_mode = 'auto' AND cardinality(preferred_asset_ids) = 0)
    OR
    (photo_mode = 'selected' AND cardinality(preferred_asset_ids) BETWEEN 1 AND 100)
  ) NOT VALID;

ALTER TABLE monthly_planner_settings
  VALIDATE CONSTRAINT monthly_planner_settings_selected_assets_check;
