-- A render is publishable when it is the composed MP4 (the designed overlay
-- and, when the strategy wants one, the branded end-card) rather than a raw
-- provider clip. That used to be read off the duration, motion plus the
-- end-card's seconds, which stops working once the end-card is optional, so it
-- is recorded instead. Existing composed renders are exactly those whose
-- duration carries the end-card.
ALTER TABLE public.video_renders
  ADD COLUMN IF NOT EXISTS composed boolean NOT NULL DEFAULT false;

UPDATE public.video_renders r
   SET composed = true
  FROM public.posts p
 WHERE p.id = r.post_id
   AND r.status = 'ready'
   AND r.duration_seconds = NULLIF(p.payload->'video'->>'durationSeconds', '')::integer + 2;
