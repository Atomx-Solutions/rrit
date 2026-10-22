-- A video may be made from more than one photograph of the same subject. The
-- main photograph of each video stays in preferred_video_asset_ids, so every
-- existing rule about it is unchanged; the further angles of that subject are
-- kept here, keyed by the main photograph's id. Nothing already stored is
-- touched: every existing row starts with no extra photographs.
ALTER TABLE public.monthly_planner_settings
  ADD COLUMN IF NOT EXISTS preferred_video_extra_asset_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.monthly_planner_settings
  DROP CONSTRAINT IF EXISTS monthly_planner_settings_video_extras;
ALTER TABLE public.monthly_planner_settings
  ADD CONSTRAINT monthly_planner_settings_video_extras CHECK (
    jsonb_typeof(preferred_video_extra_asset_ids) = 'object'
    AND (photo_mode = 'selected' OR preferred_video_extra_asset_ids = '{}'::jsonb)
  );
