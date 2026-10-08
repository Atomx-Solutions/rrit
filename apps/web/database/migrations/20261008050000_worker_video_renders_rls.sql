-- The publishing worker connects as rrit_worker and needs to read
-- video_renders to verify the composed MP4 exists before posting to Meta.
-- The existing RLS policy only covers app_runtime, so rrit_worker sees zero
-- rows despite having SELECT granted.
CREATE POLICY video_renders_worker_read ON public.video_renders
  FOR SELECT TO rrit_worker USING (true);
