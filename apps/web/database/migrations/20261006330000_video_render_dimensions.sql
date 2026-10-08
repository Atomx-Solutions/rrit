-- The canvas and the length of a render come from the brief it was made for, so
-- the columns no longer carry a figure of their own. Rows written before this
-- kept whatever the defaults said, which is why the existing values are left
-- alone rather than rewritten from a brief that may since have changed.
ALTER TABLE public.tiktok_video_renders
  ALTER COLUMN width DROP DEFAULT,
  ALTER COLUMN height DROP DEFAULT,
  ALTER COLUMN duration_seconds DROP DEFAULT;
