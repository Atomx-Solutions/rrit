-- Keep imported posts for historical analysis while hiding posts the provider
-- no longer returns from the connected-account list.
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS network_removed_at timestamptz;

CREATE INDEX IF NOT EXISTS social_posts_available_feed
  ON public.social_posts (business_id, channel, source_account_id, published_at DESC)
  WHERE network_removed_at IS NULL;
