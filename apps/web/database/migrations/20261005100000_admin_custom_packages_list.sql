-- Admin subscriptions are custom packages in the current commercial model.
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
  p_page integer DEFAULT 1, p_per_page integer DEFAULT 50,
  p_status text DEFAULT NULL, p_plan text DEFAULT NULL,
  p_expiring_days integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_limit integer := LEAST(GREATEST(COALESCE(p_per_page, 50), 1), 100);
  v_rows jsonb;
  v_total bigint;
BEGIN
  WITH package_rows AS (
    SELECT package.*, organization.name AS organization_name,
      CASE WHEN package.status = 'active' AND package.starts_at <= pg_catalog.now()
        AND package.ends_at > pg_catalog.now() THEN 'active'
        WHEN package.status = 'active' THEN 'expired' ELSE package.status END AS effective_status
    FROM public.custom_packages package
    JOIN public.organizations organization ON organization.id = package.organization_id
    WHERE (p_status IS NULL OR (CASE WHEN package.status = 'active'
      AND package.starts_at <= pg_catalog.now() AND package.ends_at > pg_catalog.now()
      THEN 'active' WHEN package.status = 'active' THEN 'expired' ELSE package.status END) = p_status)
      AND (p_plan IS NULL OR p_plan = 'custom_package')
      AND (p_expiring_days IS NULL OR (package.ends_at >= pg_catalog.now()
        AND package.ends_at < pg_catalog.now() + pg_catalog.make_interval(days => p_expiring_days)))
  )
  SELECT (SELECT pg_catalog.count(*) FROM package_rows), COALESCE((
    SELECT pg_catalog.jsonb_agg(row_data ORDER BY period_end, row_id) FROM (
      SELECT package_rows.ends_at period_end, package_rows.id row_id,
        pg_catalog.jsonb_build_object(
          'id', package_rows.id, 'organization_id', package_rows.organization_id,
          'organization_name', package_rows.organization_name, 'plan_code', 'custom_package',
          'plan_name', package_rows.name, 'billing_interval', 'monthly',
          'status', package_rows.effective_status,
          'current_period_start', package_rows.starts_at, 'current_period_end', package_rows.ends_at,
          'price_cents', package_rows.price_cents, 'cancel_at_period_end', false,
          'paused_at', NULL, 'paused_by', NULL,
          'days_until_expiry', GREATEST(0, pg_catalog.ceil(EXTRACT(EPOCH FROM
            (package_rows.ends_at - pg_catalog.now())) / 86400.0))::integer
        ) row_data
      FROM package_rows ORDER BY package_rows.ends_at, package_rows.id
      LIMIT v_limit OFFSET (v_page - 1) * v_limit
    ) page_rows
  ), '[]'::jsonb) INTO v_total, v_rows;
  RETURN pg_catalog.jsonb_build_object('items', v_rows, 'total', v_total, 'page', v_page, 'per_page', v_limit);
END
$function$;

REVOKE ALL ON FUNCTION public.admin_list_subscriptions(integer, integer, text, text, integer) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_subscriptions(integer, integer, text, text, integer) TO service_role;
  END IF;
END $$;
