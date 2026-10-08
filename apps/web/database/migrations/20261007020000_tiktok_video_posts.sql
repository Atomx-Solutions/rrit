-- TikTok is a valid channel only for posts carrying a video brief. Keep the
-- original Instagram/Facebook allowance for static feed posts.
ALTER TABLE public.posts
  DROP CONSTRAINT posts_payload_check1;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_payload_check1 CHECK (
    payload->>'channel' IN ('Instagram', 'Facebook')
    OR (
      payload->>'channel' = 'TikTok'
      AND jsonb_typeof(payload->'video') = 'object'
    )
  );
