-- A ready render whose file is not on its channel's canvas is brought to that
-- canvas when it is published, so the channel never receives the wrong shape.
-- The render then points at the conformed file; the file it was made as is
-- kept in storage and remembered here, so nothing is lost. Additive only:
-- existing renders keep their files and read NULL.
ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS original_storage_path text;
