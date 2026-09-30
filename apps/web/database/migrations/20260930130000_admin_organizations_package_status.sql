-- The status an organization is read by is now the state of its package, since
-- that is what decides whether it can generate anything. One filter replaces the
-- pair that asked about a subscription status and about holding a package,
-- because "no package" is simply one of the states.

DROP FUNCTION IF EXISTS public.admin_list_organizations(integer, integer, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_list_organizations(
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 25,
  p_status text DEFAULT NULL,
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
      latest.price_cents,
      package.id AS package_id,
      package.name AS package_name,
      package.posts_included,
      package.price_cents AS package_price_cents,
      package.starts_at AS package_starts_at,
      package.ends_at AS package_ends_at,
      package.status AS package_status,
      package.in_force
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
    -- The package in force decides what the organization may generate, so an
    -- active one wins over a draft or an expired one.
    LEFT JOIN LATERAL (
      SELECT custom.id, custom.name, custom.posts_included, custom.price_cents,
             custom.starts_at, custom.ends_at, custom.status,
             (custom.status = 'active' AND custom.starts_at <= pg_catalog.now()
              AND custom.ends_at > pg_catalog.now()) AS in_force
      FROM public.custom_packages AS custom
      WHERE custom.organization_id = organization.id
      ORDER BY (custom.status = 'active' AND custom.starts_at <= pg_catalog.now() AND custom.ends_at > pg_catalog.now()) DESC,
               custom.ends_at DESC, custom.id DESC
      LIMIT 1
    ) AS package ON true
    CROSS JOIN params
    WHERE (
        p_status IS NULL
        OR (p_status = 'none' AND package.id IS NULL)
        OR (p_status = 'active' AND package.in_force)
        -- An active package outside its period reads as expired here, because
        -- that is what it is until the expiry is written.
        OR (p_status = 'expired' AND package.id IS NOT NULL
            AND (package.status = 'expired' OR (package.status = 'active' AND NOT package.in_force)))
        OR (p_status IN ('draft', 'cancelled') AND package.status = p_status)
      )
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
          'custom_package', CASE WHEN row.package_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'id', row.package_id,
            'name', row.package_name,
            'posts_included', row.posts_included,
            'price_cents', row.package_price_cents,
            'starts_at', row.package_starts_at,
            'ends_at', row.package_ends_at,
            'status', row.package_status,
            'in_force', row.in_force
          ) END,
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

REVOKE ALL ON FUNCTION public.admin_list_organizations(integer, integer, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.admin_list_organizations(integer, integer, text, text) TO service_role;
  END IF;
END
$$;
