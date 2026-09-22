-- RRIT-SA-14 follow-up: admin_list_subscriptions
--   * days_until_expiry counts started days: 23 hours left is 1 day, and only
--     an ended period is 0 (the first version rounded down to 0 early);
--   * returns per_page like the other admin lists;
--   * pins search_path to pg_catalog with qualified names, like the other
--     SECURITY DEFINER admin functions.
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 50,
  p_status text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_expiring_days integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit integer := LEAST(GREATEST(COALESCE(p_per_page, 50), 1), 100);
  v_rows jsonb;
  v_total bigint;
BEGIN
  WITH filtered AS (
    SELECT subscription.*
    FROM public.subscriptions AS subscription
    WHERE (p_status IS NULL OR subscription.status = p_status)
      AND (p_plan IS NULL OR subscription.plan_code = p_plan)
      AND (p_expiring_days IS NULL OR (
        subscription.current_period_end >= pg_catalog.now()
        AND subscription.current_period_end < pg_catalog.now() + pg_catalog.make_interval(days => p_expiring_days)
      ))
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM filtered),
    COALESCE((
      SELECT pg_catalog.jsonb_agg(row_data ORDER BY period_end, row_id)
      FROM (
        SELECT
          filtered.current_period_end AS period_end,
          filtered.id AS row_id,
          pg_catalog.jsonb_build_object(
            'id', filtered.id,
            'organization_id', filtered.organization_id,
            'organization_name', organization.name,
            'plan_code', filtered.plan_code,
            'plan_name', plan.name,
            'billing_interval', filtered.billing_interval,
            'status', filtered.status,
            'current_period_start', filtered.current_period_start,
            'current_period_end', filtered.current_period_end,
            'price_cents', filtered.price_cents,
            'cancel_at_period_end', filtered.cancel_at_period_end,
            'paused_at', filtered.paused_at,
            'paused_by', filtered.paused_by,
            'days_until_expiry', GREATEST(0, pg_catalog.ceil(
              EXTRACT(EPOCH FROM (filtered.current_period_end - pg_catalog.now())) / 86400.0
            ))::integer
          ) AS row_data
        FROM filtered
        JOIN public.organizations AS organization ON organization.id = filtered.organization_id
        JOIN public.plans AS plan ON plan.code = filtered.plan_code
        ORDER BY filtered.current_period_end, filtered.id
        LIMIT v_limit OFFSET (v_page - 1) * v_limit
      ) AS page_rows
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN pg_catalog.jsonb_build_object('items', v_rows, 'total', v_total, 'page', v_page, 'per_page', v_limit);
END
$function$;
