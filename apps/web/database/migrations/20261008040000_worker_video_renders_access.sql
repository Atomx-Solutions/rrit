-- The publishing worker runs as rrit_worker and needs to read video_renders
-- to locate the composed MP4 before posting to Meta.
GRANT SELECT ON public.video_renders TO rrit_worker;
