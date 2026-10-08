-- A TikTok video is a deliverable of its own with its own photograph, so a
-- business choosing its photographs by hand has to be able to say which ones
-- are for the feed and which are for motion. Photographs reserved for video are
-- held apart from the feed selection rather than drawn from it.
ALTER TABLE public.monthly_planner_settings
  ADD COLUMN IF NOT EXISTS preferred_video_asset_ids uuid[] NOT NULL DEFAULT '{}';

-- Automatic selection lets the strategy choose, so no photograph is reserved,
-- and a reserved photograph must never also be promised to the feed.
ALTER TABLE public.monthly_planner_settings
  DROP CONSTRAINT IF EXISTS monthly_planner_settings_video_selection;
ALTER TABLE public.monthly_planner_settings
  ADD CONSTRAINT monthly_planner_settings_video_selection CHECK (
    (photo_mode = 'auto' AND cardinality(preferred_video_asset_ids) = 0)
    OR (
      photo_mode = 'selected'
      AND cardinality(preferred_video_asset_ids) <= 100
      AND NOT (preferred_video_asset_ids && preferred_asset_ids)
    )
  );
