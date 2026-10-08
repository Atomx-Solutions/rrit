-- A photograph may now be chosen for a feed post and for a TikTok video at the
-- same time, producing one of each from the same source. The two lists are
-- therefore independent rather than disjoint; each still names at most one
-- deliverable's worth of photographs.
ALTER TABLE public.monthly_planner_settings
  DROP CONSTRAINT IF EXISTS monthly_planner_settings_video_selection;
ALTER TABLE public.monthly_planner_settings
  ADD CONSTRAINT monthly_planner_settings_video_selection CHECK (
    (photo_mode = 'auto' AND cardinality(preferred_video_asset_ids) = 0)
    OR (photo_mode = 'selected' AND cardinality(preferred_video_asset_ids) <= 100)
  );
