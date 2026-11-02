-- The music the business chose for the videos of its next planner request:
-- AI music, one library track, or none. It is chosen with the request, like
-- the photographs, and every video that request makes starts with it.
ALTER TABLE monthly_planner_settings
  ADD COLUMN IF NOT EXISTS video_music jsonb;
