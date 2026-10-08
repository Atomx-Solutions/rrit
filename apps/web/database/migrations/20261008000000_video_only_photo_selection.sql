-- A batch may now be videos alone, so a business choosing its photographs by
-- hand may reserve photographs for video without choosing any for the feed.
-- The selection still has to name at least one photograph across the two
-- lists; only the requirement that the feed list itself be non-empty goes.
ALTER TABLE public.monthly_planner_settings
  DROP CONSTRAINT IF EXISTS monthly_planner_settings_selected_assets_check;
ALTER TABLE public.monthly_planner_settings
  ADD CONSTRAINT monthly_planner_settings_selected_assets_check CHECK (
    (photo_mode = 'auto' AND cardinality(preferred_asset_ids) = 0)
    OR (
      photo_mode = 'selected'
      AND cardinality(preferred_asset_ids) <= 100
      AND cardinality(preferred_asset_ids) + cardinality(preferred_video_asset_ids) >= 1
    )
  );
