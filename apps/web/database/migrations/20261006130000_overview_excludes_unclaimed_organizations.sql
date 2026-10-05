-- The rule for "this organization is not a customer yet" now lives in one
-- place. An organization opened by an invitation is a placeholder until its
-- client signs in, because acceptance is what creates the business row; until
-- then it belongs to the invitations card, not to the organization list and not
-- to the counters on the overview.
--
-- Only invitation placeholders are excluded. An organization that never had an
-- invitation stays visible exactly as before, business row or not.
CREATE OR REPLACE VIEW public.claimed_organizations AS
  SELECT organization.*
  FROM public.organizations AS organization
  WHERE NOT (
    EXISTS (
      SELECT 1 FROM public.organization_invitations AS invitation
      WHERE invitation.organization_id = organization.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.businesses AS business
      WHERE business.id = organization.id
    )
  );

REVOKE ALL ON public.claimed_organizations FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_overview_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  WITH month_start AS (
    SELECT pg_catalog.date_trunc('month', pg_catalog.now()) AS value
  ),
  week_start AS (
    SELECT pg_catalog.date_trunc('week', pg_catalog.now()) AS value
  ),
  organization_states AS (
    SELECT
      organization.id,
      latest_subscription.status
    FROM public.claimed_organizations AS organization
    LEFT JOIN LATERAL (
      SELECT subscription.status
      FROM public.subscriptions AS subscription
      WHERE subscription.organization_id = organization.id
      ORDER BY subscription.created_at DESC, subscription.id DESC
      LIMIT 1
    ) AS latest_subscription ON true
  )
  SELECT pg_catalog.jsonb_build_object(
    'organizations', pg_catalog.jsonb_build_object(
      'total', (SELECT pg_catalog.count(*) FROM public.claimed_organizations),
      'active', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'active'),
      'trialing', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'trialing'),
      'paused', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'paused'),
      'cancelled', (SELECT pg_catalog.count(*) FROM organization_states WHERE status = 'cancelled')
    ),
    'subscriptions', pg_catalog.jsonb_build_object(
      'mrr_cents', (
        SELECT COALESCE(pg_catalog.sum(subscription.price_cents), 0)::bigint
        FROM public.subscriptions AS subscription
        WHERE subscription.status = 'active'
          AND (
            subscription.billing_interval = 'monthly'
            OR subscription.current_period_start >= (SELECT value FROM month_start)
          )
      ),
      'active', (SELECT pg_catalog.count(*) FROM public.subscriptions WHERE status = 'active'),
      'trialing', (SELECT pg_catalog.count(*) FROM public.subscriptions WHERE status = 'trialing')
    ),
    'revenue', pg_catalog.jsonb_build_object(
      'total_cents', (
        SELECT COALESCE(pg_catalog.sum(invoice.total_cents), 0::bigint)
        FROM public.invoices AS invoice
        WHERE invoice.kind = 'invoice'
      ),
      'this_month_cents', (
        SELECT COALESCE(pg_catalog.sum(invoice.total_cents), 0::bigint)
        FROM public.invoices AS invoice
        WHERE invoice.kind = 'invoice'
          AND invoice.issued_at >= (SELECT value FROM month_start)
      )
    ),
    'ai', pg_catalog.jsonb_build_object(
      'cost_micro_eur_this_month', (
        SELECT COALESCE(pg_catalog.sum(cost.actual_cost_micro_eur), 0::bigint)
        FROM public.ai_cost_ledger AS cost
        WHERE cost.settled_at >= (SELECT value FROM month_start)
      ),
      'cost_micro_eur_total', (
        SELECT COALESCE(pg_catalog.sum(cost.actual_cost_micro_eur), 0::bigint)
        FROM public.ai_cost_ledger AS cost
        WHERE cost.settled_at IS NOT NULL
      )
    ),
    'users', pg_catalog.jsonb_build_object(
      'total', (SELECT pg_catalog.count(*) FROM auth.users)
    ),
    'signups', pg_catalog.jsonb_build_object(
      'this_week', (
        SELECT pg_catalog.count(*)
        FROM public.claimed_organizations AS organization
        WHERE organization.created_at >= (SELECT value FROM week_start)
      ),
      'this_month', (
        SELECT pg_catalog.count(*)
        FROM public.claimed_organizations AS organization
        WHERE organization.created_at >= (SELECT value FROM month_start)
      )
    ),
    'new_organizations', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', recent.id,
        'name', recent.name,
        'plan_name', recent.plan_name,
        'created_at', recent.created_at
      ) ORDER BY recent.created_at DESC, recent.id DESC)
      FROM (
        SELECT organization.id, organization.name, organization.created_at, plan.name AS plan_name
        FROM public.claimed_organizations AS organization
        LEFT JOIN LATERAL (
          SELECT subscription.plan_code
          FROM public.subscriptions AS subscription
          WHERE subscription.organization_id = organization.id
          ORDER BY subscription.created_at DESC, subscription.id DESC
          LIMIT 1
        ) AS latest_subscription ON true
        LEFT JOIN public.plans AS plan ON plan.code = latest_subscription.plan_code
        WHERE organization.created_at >= (SELECT value FROM week_start)
        ORDER BY organization.created_at DESC, organization.id DESC
      ) AS recent
    ), '[]'::jsonb)
  );
$function$;

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
      public.organization_state(organization.id) AS state,
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
    FROM public.claimed_organizations AS organization
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
    WHERE (p_status IS NULL OR public.organization_state(organization.id) = p_status)
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
          'state', row.state,
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

REVOKE ALL ON FUNCTION public.admin_overview_kpis() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_organizations(integer, integer, text, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.claimed_organizations TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_overview_kpis() TO service_role;
    GRANT EXECUTE ON FUNCTION public.admin_list_organizations(integer, integer, text, text) TO service_role;
  END IF;
END
$$;
