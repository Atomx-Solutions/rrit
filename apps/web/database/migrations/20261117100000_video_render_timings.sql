-- How long each step of a render took (direction, scene dressing, every shot's
-- generation and subject check, composition, quality review), kept with the
-- render so a slow one can be traced from the database instead of the logs.
-- A step that ran twice, such as a second take, appears twice in order.
-- Every storyboard the director wrote is kept beside them, so the camera plan
-- behind a render can be read back.
ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS timings jsonb;
