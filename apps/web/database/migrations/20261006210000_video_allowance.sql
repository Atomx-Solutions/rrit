-- Videos become a package allowance measured exactly like posts: a per-plan
-- monthly limit, a counted usage row and a quota month on every render. Until a
-- plan is given a number, the allowance is zero, so no business silently gains
-- videos from this migration alone.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS videos_per_month integer NOT NULL DEFAULT 0
    CHECK (videos_per_month >= 0 AND videos_per_month <= 10000);

-- The limits object is what entitlements copy and the application parses, so the
-- key has to exist on every row that predates this change.
UPDATE public.plan_catalog
   SET limits = limits || jsonb_build_object('videos_per_month', 0)
 WHERE NOT (limits ? 'videos_per_month');
UPDATE public.entitlements
   SET limits = limits || jsonb_build_object('videos_per_month', 0)
 WHERE NOT (limits ? 'videos_per_month');

-- Renders are counted against the month they were charged to, the same way
-- posts are, so a package period that straddles two calendar months counts
-- each render exactly once.
ALTER TABLE public.tiktok_video_renders
  ADD COLUMN IF NOT EXISTS quota_month date;
UPDATE public.tiktok_video_renders
   SET quota_month = date_trunc('month', created_at AT TIME ZONE 'UTC')::date
 WHERE quota_month IS NULL;
CREATE INDEX IF NOT EXISTS tiktok_video_renders_quota
  ON public.tiktok_video_renders(business_id, quota_month);

CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_code text,
  p_actor_id uuid,
  p_actor_email text,
  p_changes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  before_row public.plans%ROWTYPE;
  after_row public.plans%ROWTYPE;
BEGIN
  SELECT * INTO before_row FROM public.plans WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    UPDATE public.plans SET
      name = COALESCE(p_changes->>'name', name),
      monthly_cents = COALESCE((p_changes->>'monthly_cents')::integer, monthly_cents),
      posts_per_month = COALESCE((p_changes->>'posts_per_month')::integer, posts_per_month),
      videos_per_month = COALESCE((p_changes->>'videos_per_month')::integer, videos_per_month),
      monthly_credits = COALESCE((p_changes->>'monthly_credits')::integer, monthly_credits),
      style_fetch_post_count = COALESCE((p_changes->>'style_fetch_post_count')::integer, style_fetch_post_count),
      active = COALESCE((p_changes->>'active')::boolean, active),
      sort_order = COALESCE((p_changes->>'sort_order')::integer, sort_order),
      updated_at = pg_catalog.now()
    WHERE code = p_code
    RETURNING * INTO after_row;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'PLAN_CONFLICT' USING ERRCODE = 'P0001';
    WHEN check_violation THEN
      RAISE EXCEPTION 'PLAN_INVALID' USING ERRCODE = 'P0001';
  END;

  PERFORM public.admin_record_platform_change(
    p_actor_id, p_actor_email, 'plan', p_code, pg_catalog.to_jsonb(before_row), pg_catalog.to_jsonb(after_row), p_changes
  );
  RETURN pg_catalog.to_jsonb(after_row);
END
$function$;
