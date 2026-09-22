-- RRIT-SA-14: platform-wide subscription list for the superadmin.
-- Supports filtering by status, plan and expiry window; returns days_until_expiry.

CREATE OR REPLACE FUNCTION admin_list_subscriptions(
  p_page         integer   DEFAULT 1,
  p_per_page     integer   DEFAULT 50,
  p_status       text      DEFAULT NULL,
  p_plan         text      DEFAULT NULL,
  p_expiring_days integer  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page    integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit   integer := LEAST(GREATEST(COALESCE(p_per_page, 50), 1), 100);
  v_offset  integer := (v_page - 1) * v_limit;
  v_rows    jsonb;
  v_total   bigint;
BEGIN
  SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      s.id,
      s.organization_id,
      o.name                                          AS organization_name,
      s.plan_code,
      p.name                                          AS plan_name,
      s.billing_interval,
      s.status,
      s.current_period_start,
      s.current_period_end,
      s.price_cents,
      s.cancel_at_period_end,
      s.paused_at,
      s.paused_by,
      GREATEST(0, EXTRACT(DAY FROM (s.current_period_end - now()))::integer) AS days_until_expiry
    FROM subscriptions s
    JOIN organizations o ON o.id = s.organization_id
    JOIN plans         p ON p.code = s.plan_code
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (p_plan   IS NULL OR s.plan_code = p_plan)
      AND (p_expiring_days IS NULL
           OR (s.current_period_end >= now()
               AND s.current_period_end < now() + make_interval(days => p_expiring_days)))
    ORDER BY s.current_period_end ASC, s.id ASC
    LIMIT  v_limit
    OFFSET v_offset
  ) r;

  SELECT COUNT(*)
  INTO v_total
  FROM subscriptions s
  WHERE (p_status IS NULL OR s.status = p_status)
    AND (p_plan   IS NULL OR s.plan_code = p_plan)
    AND (p_expiring_days IS NULL
         OR (s.current_period_end >= now()
             AND s.current_period_end < now() + make_interval(days => p_expiring_days)));

  RETURN jsonb_build_object(
    'items',  v_rows,
    'total',  v_total,
    'page',   v_page
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_list_subscriptions(integer, integer, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_subscriptions(integer, integer, text, text, integer) TO service_role;
