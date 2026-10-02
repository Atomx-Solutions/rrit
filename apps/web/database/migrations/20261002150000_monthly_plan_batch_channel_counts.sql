-- A request says how many posts go to each platform, not merely which
-- platforms are allowed: three posts may be two for Instagram and one for
-- Facebook. The allow-list added earlier today cannot express that, so it is
-- replaced before anything depended on it.
--
-- An empty object means "no distribution asked for", which is how the planner
-- behaved before the choice existed.

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_batch_channels_check;
ALTER TABLE public.monthly_plans
  DROP COLUMN IF EXISTS batch_channels;

ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS batch_channel_counts jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_batch_channel_counts_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_batch_channel_counts_check
    CHECK (
      pg_catalog.jsonb_typeof(batch_channel_counts) = 'object'
      AND NOT pg_catalog.jsonb_path_exists(
        batch_channel_counts,
        '$.keyvalue() ? (@.key != "Instagram" && @.key != "Facebook")'
      )
    );
