-- RRIT-SA-06: paginated, filterable organization list for the superadmin.
-- Like admin_overview_kpis, it runs server-side and is callable only by the
-- service role, never by tenant sessions.
--
-- "Subscription" is the organization's most recent subscription, the same
-- definition the overview KPIs use; the status and plan filters apply to it.
CREATE OR REPLACE FUNCTION public.admin_list_organizations(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_status text DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_q text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH params AS (
    SELECT
      GREATEST(COALESCE(p_page, 1), 1) AS page,
      LEAST(GREATEST(COALESCE(p_per_page, 25), 1), 100) AS per_page,
      NULLIF(pg_catalog.btrim(p_q), '') AS q
  ),
  filtered AS (
    SELECT
      organization.id,
      organization.slug,
      organization.name,
      organization.status,
      organization.created_at,
      latest.plan_code,
      latest.plan_name,
      latest.status AS subscription_status,
      latest.current_period_end,
      latest.price_cents
    FROM public.organizations AS organization
    LEFT JOIN LATERAL (
      SELECT
        subscription.plan_code,
        plan.name AS plan_name,
        subscription.status,
        subscription.current_period_end,
        subscription.price_cents
      FROM public.subscriptions AS subscription
      JOIN public.plans AS plan ON plan.code = subscription.plan_code
      WHERE subscription.organization_id = organization.id
      ORDER BY subscription.created_at DESC, subscription.id DESC
      LIMIT 1
    ) AS latest ON true
    CROSS JOIN params
    WHERE (p_status IS NULL OR latest.status = p_status)
      AND (p_plan IS NULL OR latest.plan_code = p_plan)
      -- Case-insensitive name search; % and _ typed by the admin are literal.
      AND (
        params.q IS NULL
        OR organization.name ILIKE
          '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(params.q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          ESCAPE '\'
      )
  ),
  page_rows AS (
    SELECT filtered.*
    FROM filtered, params
    ORDER BY filtered.created_at DESC, filtered.id DESC
    LIMIT (SELECT per_page FROM params)
    OFFSET ((SELECT page FROM params) - 1) * (SELECT per_page FROM params)
  )
  SELECT pg_catalog.jsonb_build_object(
    'page', (SELECT page FROM params),
    'per_page', (SELECT per_page FROM params),
    'total', (SELECT pg_catalog.count(*) FROM filtered),
    'items', COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', row.id,
          'slug', row.slug,
          'name', row.name,
          'status', row.status,
          'created_at', row.created_at,
          'subscription', CASE WHEN row.plan_code IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'plan_code', row.plan_code,
            'plan_name', row.plan_name,
            'status', row.subscription_status,
            'current_period_end', row.current_period_end,
            'price_cents', row.price_cents
          ) END,
          'credit_balance', (
            SELECT pg_catalog.jsonb_build_object(
              'remaining_credits', balance.remaining_credits,
              'reserved_credits', balance.reserved_credits
            )
            FROM public.credit_balances AS balance
            WHERE balance.organization_id = row.id
          ),
          'brand_count', (
            SELECT pg_catalog.count(*) FROM public.brands AS brand WHERE brand.organization_id = row.id
          ),
          'member_count', (
            SELECT pg_catalog.count(*)
            FROM public.organization_memberships AS membership
            WHERE membership.organization_id = row.id AND membership.status = 'active'
          )
        )
        ORDER BY row.created_at DESC, row.id DESC
      )
      FROM page_rows AS row
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_list_organizations(integer, integer, text, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_organizations(integer, integer, text, text, text) TO service_role;
  END IF;
END
$$;
