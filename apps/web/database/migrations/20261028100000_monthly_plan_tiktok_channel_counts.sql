-- TikTok became a planner channel for static posts as well as videos, but the
-- per-platform split still only admitted Instagram and Facebook, so every
-- request that gave TikTok a share was rejected when the plan was saved. The
-- check now admits each publishing channel and nothing else.

ALTER TABLE public.monthly_plans
  DROP CONSTRAINT IF EXISTS monthly_plans_batch_channel_counts_check;
ALTER TABLE public.monthly_plans
  ADD CONSTRAINT monthly_plans_batch_channel_counts_check
    CHECK (
      pg_catalog.jsonb_typeof(batch_channel_counts) = 'object'
      AND NOT pg_catalog.jsonb_path_exists(
        batch_channel_counts,
        '$.keyvalue() ? (@.key != "Instagram" && @.key != "Facebook" && @.key != "TikTok")'
      )
    );
