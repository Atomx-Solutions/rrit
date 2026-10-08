-- How many of this batch's posts the business asked to be animated. It is a
-- request, not an allowance: the brand's own video share and the package limit
-- still cap it when the batch is planned. Plans that predate the counter asked
-- for nothing, which is why it defaults to zero rather than to a share.
ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS batch_video_count integer NOT NULL DEFAULT 0
    CHECK (batch_video_count >= 0 AND batch_video_count <= 100);
