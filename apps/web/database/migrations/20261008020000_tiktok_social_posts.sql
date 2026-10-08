-- Allow TikTok as a channel in social_posts
ALTER TABLE social_posts DROP CONSTRAINT IF EXISTS social_posts_channel_check;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_channel_check
  CHECK (channel IN ('Facebook','Instagram','TikTok'));
