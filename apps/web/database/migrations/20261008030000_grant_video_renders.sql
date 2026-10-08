-- The publishing worker reads video_renders to find the composed MP4 for a
-- post, but the table was never granted to app_runtime, causing
-- "permission denied for table video_renders" on every video publish.
GRANT SELECT ON public.video_renders TO app_runtime;
