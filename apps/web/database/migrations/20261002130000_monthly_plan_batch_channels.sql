-- A request now says which platforms it is for, not only how many posts. The
-- choice belongs to the batch rather than to the business, because the same
-- package may be drawn on for an Instagram-only week and a Facebook-only one.
-- Planning can run on a later worker tick, so the choice has to be persisted
-- with the plan rather than held in the request.
--
-- An empty array means "no restriction", which is how every plan created
-- before this migration behaved.

ALTER TABLE public.monthly_plans
  ADD COLUMN IF NOT EXISTS batch_channels text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_batch_channels_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_batch_channels_check
    CHECK (
      pg_catalog.array_length(batch_channels, 1) IS NULL
      OR (
        pg_catalog.array_length(batch_channels, 1) <= 2
        AND batch_channels <@ ARRAY['Instagram','Facebook']::text[]
      )
    );
