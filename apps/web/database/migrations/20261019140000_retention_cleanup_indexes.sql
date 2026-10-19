-- Retention deletes filter on these timestamp/date columns directly. The
-- older tenant-oriented indexes cannot efficiently find expired rows across
-- all tenants, which makes the worker hit its statement timeout.
CREATE INDEX IF NOT EXISTS ai_generations_retention_created
  ON ai_generations(created_at);
CREATE INDEX IF NOT EXISTS ai_daily_usage_retention_day
  ON ai_daily_usage(usage_day);
CREATE INDEX IF NOT EXISTS trial_claims_retention_claimed
  ON trial_claims(claimed_at);
CREATE INDEX IF NOT EXISTS post_validations_retention_created
  ON post_validations(created_at);
CREATE INDEX IF NOT EXISTS social_posts_retention_published
  ON social_posts(published_at);
