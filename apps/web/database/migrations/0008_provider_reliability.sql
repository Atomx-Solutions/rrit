-- Bind imported history to the selected provider account and measure Instagram
-- processing from container creation, not from the earlier schedule creation.
ALTER TABLE publication_jobs ADD COLUMN container_started_at timestamptz;
UPDATE publication_jobs
SET container_started_at = created_at
WHERE provider_container_id IS NOT NULL AND container_started_at IS NULL;

ALTER TABLE social_posts ADD COLUMN source_account_id text;
UPDATE social_posts sp
SET source_account_id = CASE
  WHEN sp.channel = 'Facebook' THEN mc.page_id
  ELSE mc.instagram_id
END
FROM meta_connections mc
WHERE mc.business_id = sp.business_id AND sp.source_account_id IS NULL;
-- Rows without a surviving connection stay distinguishable but do not enter
-- current-account queries. New imports always provide the provider account ID.
UPDATE social_posts
SET source_account_id = 'legacy:' || lower(channel)
WHERE source_account_id IS NULL;
ALTER TABLE social_posts ALTER COLUMN source_account_id SET NOT NULL;
ALTER TABLE social_posts DROP CONSTRAINT social_posts_business_id_channel_provider_id_key;
ALTER TABLE social_posts
  ADD CONSTRAINT social_posts_source_identity_unique
  UNIQUE (business_id, channel, source_account_id, provider_id);
CREATE INDEX social_posts_current_source
  ON social_posts (business_id, source_account_id, published_at DESC, id DESC);
